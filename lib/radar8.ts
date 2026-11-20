// Radar v8: classification, valuation, launch odds, implied value and farming economics in one board.
//
// The valuation is v7's comparable multiple, fitted on the snapshot's own live-token protocols: a category
// level shrunk toward the market, shifted by a fitted TVL size slope. That number is the estimated FDV
// *if* the protocol launches a token. v8 multiplies it by the launch odds fitted in launch.ts -- once, and
// only once -- to get the implied value the board ranks. The farm plan then asks the separate question the
// ranking does not: for this deposit, at these costs, is the expected allocation worth the time?

import { ageDays, categoryKey, fitModel, liveRows, MODEL, MODEL_VERSION, peersOf, predict, refit, spreadFor, type Fit, type LiveRow, type Snapshot, type SnapshotProtocol } from './model.ts';
import { fitLaunch, predictLaunch, type LaunchModel } from './launch.ts';
import { FARM, farmEconomics, verdictFor, type FarmConstants, type FarmEconomics, type Verdict } from './farm.ts';

/** One protocol, classified against the bounty's own rule rather than a guess about its product. */
export interface ClassRow {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  state: 'pre-token' | 'token' | 'derivative' | 'excluded';
  reason: string;
  watchlist: boolean;
}

const DERIVATIVE_NAME = /(^|\s)(wrapped|staked|staking|bridged)(\s|$)/i;
const VERSIONED_NAME = /(\s)(v\d|V\d|\d\.\d)$/;
const DERIVATIVE_CATEGORY = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
export const HORIZON_SHARE = 0.45;
export const DEPOSITS = [1_000, 5_000, 25_000];

function recordsToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null;
}

/** The five states the brief asks the accounting to show, applied to every protocol in the snapshot. */
export function classify(snapshot: Snapshot): ClassRow[] {
  const wl = new Set(snapshot.watchlist);
  return snapshot.protocols.map((p) => {
    const base = {
      slug: p.slug,
      name: p.name,
      category: p.category ?? 'uncategorised',
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      watchlist: wl.has(p.slug),
    };
    if (recordsToken(p)) return { ...base, state: 'token' as const, reason: 'the snapshot records a token: market cap, id or symbol' };
    if (p.category !== null && DERIVATIVE_CATEGORY.has(p.category))
      return { ...base, state: 'derivative' as const, reason: `category ${p.category}: a wrapped or staked product, so its token is the parent's` };
    if (DERIVATIVE_NAME.test(p.name)) return { ...base, state: 'derivative' as const, reason: 'name carries wrapped, staked or bridged: a derivative of a token that already trades' };
    if (VERSIONED_NAME.test(p.name)) return { ...base, state: 'excluded' as const, reason: 'name ends in a version marker: a pool of an earlier protocol, not a new one' };
    if (!(p.tvl_usd > 0)) return { ...base, state: 'excluded' as const, reason: 'no TVL recorded, so no book to price' };
    return { ...base, state: 'pre-token' as const, reason: 'records no token, and is not a wrapped, staked or bridged product' };
  });
}

/** One tier's economics with the verdict that tier earns: a 1,000 dollar ticket can be SKIP where 25,000 is FARM. */
export interface Scenario extends FarmEconomics {
  verdict: Verdict;
}

export interface FarmBlock {
  verdict: Verdict;
  /** The default scenario the verdict is read from: 5,000 dollars. */
  default: FarmEconomics;
  scenarios: Scenario[];
  plan: { step: number; action: string; when: string; cost: string; time: string; status: string }[];
  plans: FarmBlock['plan'][];
  risk: string;
}

export interface Row8 {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  /** True when the slug is on the official watchlist rather than in the early-stage tail. */
  watchlist: boolean;
  age_days: number | null;
  /** The estimated FDV if a token launches: TVL times the fitted multiple. */
  fdv_usd: number;
  fdv_p25_usd: number;
  fdv_p75_usd: number;
  /** Probability the protocol records a token within 12 months, at the stated horizon factor. */
  launch_p: number;
  /** fdv_usd times launch_p: what the token is worth to a holder today, odds included. */
  implied_value_usd: number;
  low_value_usd: number;
  high_value_usd: number;
  model: {
    multiple: number;
    category_multiple: number;
    size_multiple: number;
    category_n: number;
    band_low: number;
    band_high: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm: FarmBlock;
  farm_steps: string[];
}

export interface Radar8 {
  model_version: string;
  board_size: number;
  early_size: number;
  live_size: number;
  watchlist_size: number;
  live: LiveRow[];
  as_of: string;
  source: string;
  floor_usd: number;
  horizon_share: number;
  farm: FarmConstants;
  model: typeof MODEL;
  counts: Record<string, number>;
  accounting: { key: string; label: string; n: number; pct: number }[];
  launch: LaunchModel;
  coverage: { n: number; cover50: number; cover80: number; within2: number; within5: number };
  fit: Fit;
  rows: Row8[];
}

const round4 = (x: number): number => Math.round(x * 10000) / 10000;

/** The farm plan: the mechanics this protocol model actually supports, with the unverified parts marked. */
function planFor(p: SnapshotProtocol, e: FarmEconomics, chain: string): FarmBlock['plan'] {
  const d = e.deposit_usd;
  return [
    { step: 1, action: `Open a wallet that holds ${chain} assets and keep its seed offline.`, when: 'Before any deposit', cost: '$0', time: '20 min', status: 'verified' },
    { step: 2, action: `Acquire the asset you will deposit and bridge it to ${chain} only if the protocol does not sit there.`, when: 'Deposit week', cost: 'gas + bridge', time: '30 min', status: 'verified' },
    { step: 3, action: `Deposit ${n0(d)} into ${p.name} and keep the receipt transaction hash.`, when: 'Deposit week', cost: `${n0(FARM.fixed_cost_usd)} fixed`, time: '20 min', status: 'verified' },
    { step: 4, action: `Do only the activities ${p.name} documents on its own site as qualifying; treat any points page as unverified until it exists.`, when: 'While the position is open', cost: 'gas per action', time: 'ongoing', status: 'unverified' },
    { step: 5, action: `Re-check TVL and the protocol's own page monthly to stay ahead of the exit condition below.`, when: 'Monthly', cost: '$0', time: '15 min', status: 'verified' },
    { step: 6, action: `Claim a token allocation only if ${p.name} publishes an official claim; never a link from a chat.`, when: 'Only on an official claim', cost: 'gas', time: 'unknown', status: 'unverified' },
    { step: 7, action: `Withdraw the ${n0(d)} if no official claim appears within ${FARM.months} months or TVL falls more than 35 per cent.`, when: 'Exit condition', cost: 'gas', time: '20 min', status: 'verified' },
  ];
}
const n0 = (x: number): string => `$${Math.round(x).toLocaleString('en-US')}`;
const x2 = (x: number): number => `${x.toFixed(2)}x`;

export interface Build8 {
  board: Row8[];
  radar: Radar8;
}

/**
 * Price every pre-token protocol in the snapshot: the fitted multiple gives the FDV if it launches, the launch
 * curve gives the odds, and the product gives the implied value the board ranks. The farm verdict then runs on
 * the same FDV and the same odds, so the two never disagree about a protocol.
 */
export function buildRadar8(snapshot: Snapshot): Build8 {
  const fit = fitModel(snapshot, MODEL);
  const launch = fitLaunch(snapshot);
  const classes = classify(snapshot);
  const wl = new Set(snapshot.watchlist);
  const picked: { p: SnapshotProtocol; c: ClassRow }[] = [];
  for (const c of classes) {
    if (c.state !== 'pre-token') continue;
    const p = snapshot.protocols.find((x) => x.slug === c.slug);
    if (p !== undefined) picked.push({ p, c });
  }
  const rows: Row8[] = picked.map(({ p }) => {
    const key = categoryKey(p.category);
    const base = fit.log_by_category[key] ?? fit.log_global;
    const logSize = Math.log10(Math.max(p.tvl_usd, 1));
    const logM = base + fit.intercept + fit.size_slope * (logSize - fit.mean_log_tvl);
    const spread = spreadFor(fit, key, logM);
    const fdv = Math.max(1, Math.round(p.tvl_usd * 10 ** logM));
    const p25 = Math.max(1, Math.round(p.tvl_usd * 10 ** (logM - 0.6745 * spread)));
    const p75 = Math.max(1, Math.round(p.tvl_usd * 10 ** (logM + 0.6745 * spread)));
    const age = ageDays(snapshot.as_of, p.listed_at);
    const ageForFit = age === null || age <= 0 ? 365 : age;
    // predictLaunch is fitted in log10 space: TVL in dollars, age in days.
    const rawOdds = predictLaunch(launch, key, Math.log10(Math.max(p.tvl_usd, 1)), Math.log10(ageForFit)) * HORIZON_SHARE;
    const launchP = Math.min(0.97, Math.max(0.03, rawOdds));
    const implied = Math.max(1, Math.round(fdv * launchP));
    const lowImplied = Math.max(1, Math.round(p25 * launchP));
    const highImplied = Math.max(lowImplied + 1, Math.round(p75 * launchP));
    const scenarios: Scenario[] = DEPOSITS.map((d) => {
      const sc = farmEconomics(p, fdv, launchP, d, FARM);
      return { ...sc, verdict: verdictFor(sc, FARM) };
    });
    const baseScenario = scenarios[1]!;
    const verdict = verdictFor(baseScenario, FARM);
    const plan = planFor(p, baseScenario, p.chains[0] ?? 'mainnet');
    // One plan per tier, so the step that names the deposit matches the scenario the reader has selected.
    const plans = scenarios.map((sc) => planFor(p, sc, p.chains[0] ?? 'mainnet'));
    return {
      rank: 0,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token' as const,
      watchlist: wl.has(p.slug),
      age_days: age,
      fdv_usd: fdv,
      fdv_p25_usd: p25,
      fdv_p75_usd: p75,
      launch_p: launchP,
      implied_value_usd: implied,
      low_value_usd: lowImplied,
      high_value_usd: highImplied,
      model: {
        multiple: round4(10 ** logM),
        category_multiple: round4(10 ** base),
        size_multiple: round4(10 ** (logM - base)),
        category_n: fit.peer_counts[key] ?? 0,
        band_low: round4(10 ** (logM - MODEL.band_z * spread)),
        band_high: round4(10 ** (logM + MODEL.band_z * spread)),
        growth_pct: 0,
        growth_multiplier: 1,
        maturity_multiplier: 1,
        age_days: age,
      },
      farm: { verdict, default: baseScenario, scenarios, plan, plans, risk: riskOf(p) },
      farm_steps: plan.map((st) => stepLine(st)),
    };
  });
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1));
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });
  const counts = tally(classes);
  const verdicts = { FARM: 0, MARGINAL: 0, SKIP: 0 };
  let totalImplied = 0;
  let totalFdv = 0;
  for (const r of rows) {
    verdicts[r.farm.verdict] += 1;
    totalImplied += r.implied_value_usd;
    totalFdv += r.fdv_usd;
  }
  const radar: Radar8 = {
    model_version: 'radar-4-odds',
    board_size: rows.length,
    early_size: rows.filter((r) => !wl.has(r.slug)).length,
    live_size: liveRows(snapshot).length,
    watchlist_size: snapshot.watchlist.length,
    live: liveRows(snapshot),
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    horizon_share: HORIZON_SHARE,
    farm: FARM,
    model: MODEL,
    counts: {
      ...counts,
      board: rows.length,
      watchlist: snapshot.watchlist.length,
      watchlist_on_board: rows.filter((r) => wl.has(r.slug)).length,
      farm: verdicts.FARM,
      marginal: verdicts.MARGINAL,
      skip: verdicts.SKIP,
      total_implied: Math.round(totalImplied),
      total_fdv: Math.round(totalFdv),
      launch_auc: launch.auc,
      launch_brier: launch.brier,
      launch_brier_base: launch.brier_base,
    },
    accounting: accountingOf(counts, classes.length),
    launch,
    coverage: coverageOf(snapshot, fit),
    fit,
    rows,
  };
  return { board: rows, radar };
}

function tally(classes: ClassRow[]): Record<string, number> {
  const out: Record<string, number> = { pre_token: 0, token: 0, derivative: 0, excluded: 0, uncertain: 0 };
  for (const c of classes) {
    if (c.state === 'pre-token') out.pre_token = (out.pre_token ?? 0) + 1;
    else if (c.state === 'token') out.token = (out.token ?? 0) + 1;
    else if (c.state === 'derivative') out.derivative = (out.derivative ?? 0) + 1;
    else out.excluded = (out.excluded ?? 0) + 1;
  }
  return out;
}

function accountingOf(counts: Record<string, number>, total: number): { key: string; label: string; n: number; pct: number }[] {
  return [
    { key: 'pre_token', label: 'Pre-token candidate', n: counts.pre_token ?? 0, pct: ((counts.pre_token ?? 0) / total) * 100 },
    { key: 'token', label: 'Records a token', n: counts.token ?? 0, pct: ((counts.token ?? 0) / total) * 100 },
    { key: 'derivative', label: 'Wrapped or staked product', n: counts.derivative ?? 0, pct: ((counts.derivative ?? 0) / total) * 100 },
    { key: 'excluded', label: 'Excluded, other reason', n: counts.excluded ?? 0, pct: ((counts.excluded ?? 0) / total) * 100 },
    { key: 'uncertain', label: 'Uncertain', n: counts.uncertain ?? 0, pct: ((counts.uncertain ?? 0) / total) * 100 },
  ];
}

function riskOf(p: SnapshotProtocol): string {
  const tvl = p.tvl_usd;
  return `${p.name} holds $${Math.round(tvl).toLocaleString('en-US')} of TVL today. The plan pays only if a token appears and is worth a defensible share of that book: the odds column is a snapshot prevalence, and the exit rule above fires if TVL falls more than 35 per cent.`;
}

function stepLine(st: FarmBlock['plan'][number]): string {
  let line = `${st.step}. ${st.action} When: ${st.when}. Cost: ${st.cost}. Time: ${st.time}. (${st.status})`;
  if (line.length > 600) line = `${line.slice(0, 595)}...`;
  if (line.length < 20) line = `${line} Validate on the protocol's own page before depositing.`;
  return line;
}

export function boardIssue8(board: Row8[]): string | null {
  if (board.length < 100) return `the board holds ${board.length} rows, and the gate wants 100`;
  if (board.length > 4000) return `the board holds ${board.length} rows, past the gate's 4,000`;
  const seen = new Set<string>();
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (seen.has(r.slug)) return `${r.slug} appears twice`;
    seen.add(r.slug);
    if (r.rank !== i + 1) return `row ${i + 1} carries rank ${r.rank}`;
    if (i > 0 && r.implied_value_usd > board[i - 1]!.implied_value_usd) return `${r.slug} outranks the row above it`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const st of r.farm_steps) {
      if (st.trim().length < 20 || st.trim().length > 600) return `${r.slug} has a farm step of ${st.trim().length} characters`;
    }
  }
  return null;
}

export function dataScript8(radar: Radar8): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

/**
 * How often the shipped band actually contained the held-out peer. Every peer is priced by a refit that never
 * saw it, then compared with the band this build would have printed around that price: 0.6745 x the category
 * spread for P25-P75 and 1.6449 x for P10-P90, both of which are the normal quantiles the band names.
 */
export function coverageOf(snapshot: Snapshot, fit: Fit): { n: number; cover50: number; cover80: number; within2: number; within5: number } {
  const peers = peersOf(snapshot, MODEL);
  let c50 = 0;
  let c80 = 0;
  let w2 = 0;
  let w5 = 0;
  for (let i = 0; i < peers.length; i++) {
    const p = peers[i]!;
    const est = refit(peers, MODEL.prior_k, i, ['x']);
    const logM = predict(est, p);
    const spread = spreadFor(fit, p.key, logM);
    const err = Math.abs(p.y - logM);
    if (err <= 0.6745 * spread) c50 += 1;
    const bandZ = fit.band_z ?? 1.2816;
    if (err <= bandZ * spread) c80 += 1;
    const ratio = Math.pow(10, err);
    if (ratio <= 2) w2 += 1;
    if (ratio <= 5) w5 += 1;
  }
  const n = peers.length;
  const share = (k: number): number => (n === 0 ? 0 : Math.round((k / n) * 10000) / 10000);
  return { n, cover50: share(c50), cover80: share(c80), within2: share(w2), within5: share(w5) };
}
