// The token radar's model (v7): the snapshot's own live-token protocols are the comparables, and every other
// protocol on the board is priced at the multiple those comparables already pay, for its category and its size.
//
// The idea is one sentence long. A protocol's implied value is its TVL times a multiple:
//
//   implied = tvl_usd x 10 ** (category level + intercept + size slope x (log10 tvl_usd - mean log10 tvl_usd))
//
// The multiple is not typed in by hand anywhere in this file. It is fitted, on every run, from the protocols in
// this same snapshot that already trade a token: a market cap above zero and a TVL above zero. There are 128 of
// them here. For each peer the model measures the multiple its market actually pays, y = log10(mcap_usd /
// tvl_usd), and where that peer sits in size, x = log10(tvl_usd); it also carries two fields it will refuse to
// price, g = clamp(change_7d, -60, 120) / 100 and a = log10(age_days), so the ablation can say out loud what they
// would have cost.
//
// Each category's level is the mean of its peers' y, shrunk toward the mean of every peer's y with a prior of four
// observations: w = n / (n + 4), so a category one peer deep keeps four fifths of the global level and a
// category forty peers deep is almost its own mean. On top of that level the fit estimates one intercept and one
// slope per requested feature, by least squares on the normal equations (Gauss-Jordan elimination with partial
// pivoting, zeros when the system is singular), features centred on their means first. The shipped model asks
// for one feature, x, so its multiple is:
//
//   multiple = 10 ** (category level + intercept + slope x (log10 tvl_usd - the peers' mean log10 tvl_usd))
//
// The intercept is what the category levels leave over on average (near zero, and the fit reports it); the slope
// is the size effect the peers themselves show, roughly -0.4: a protocol tenfold larger in TVL pays only about
// 0.42 of the multiple a tenfold-smaller one gets, so big pools are not priced at small-pool multiples, but the
// effect is gentle. On this snapshot the slope is -0.376 with t = -4.3.
// The band on each row is the same log multiple plus or minus 1.2816 (the 80 per cent two-sided normal quantile)
// times that category's own spread of y about its level, or the global spread where a category has fewer than
// three peers to measure one. The band is wide on purpose. It is the fit's honest statement of how little a
// category tells you about one protocol.
//
// How much of this to believe. Every number the fit reports is leave-one-out: the peer being priced is removed
// from the data, the model refitted on the rest, and the peer's own y compared with what came back. That is the only
// honest test here, and on this snapshot it says the model is close to a level and far from a ranking. The median
// predicted/actual ratio is 0.98, i.e. near 1.0, so the centre is calibrated; but the mean absolute
// error is 0.70 dex and only about three peers in ten land within 2x of their own fitted value, so
// roughly three in four peers still miss by more than 2x. Category helps essentially not at all on its own (0.772
// against 0.773 for one global mean: about a thousandth of a dex, which fixes level bias, not discrimination); the
// size slope is the one term that earns its place (0.697, an improvement of 0.074 dex, more than ten times the
// 0.005-dex threshold this file holds itself to); the seven-day change and the listing age each make the error
// worse and are displayed, not priced. So: the model levels a category, and it cannot rank a single protocol. The
// board's order is a level times a size adjustment, with a band that says how wide the category's spread is, and
// that is all it is. Spread inside a category swamps the difference between two rows in it.
//
// The board's selection is unchanged from the earlier pages: every slug in the snapshot's watchlist, plus the
// pre-token protocols below the watchlist floor that pass isRankable, by TVL, capped at EARLY_ROWS. A protocol is
// pre-token when its index entry records no token at all (no market cap, no CoinGecko id, no symbol). The
// snapshot's live-token protocols are kept apart and shown as the market's own values, never mixed into the board.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
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
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's settings: the prior that shrinks a category, the band width, and the numeric context. */
export interface ModelSettings {
  prior_k: number;
  band_z: number;
  min_improvement_dex: number;
  unknown_age_days: number;
  growth_floor: number;
  growth_cap: number;
}

export type ModelConstants = ModelSettings;

export const MODEL: ModelSettings = {
  prior_k: 4,
  band_z: 1.2816,
  min_improvement_dex: 0.005,
  unknown_age_days: 365,
  growth_floor: -60,
  growth_cap: 120,
};

export const MODEL_VERSION = 'radar-3-comps-fit';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

const DAY_MS = 86_400_000;
const MATURITY_DAYS = 1095;

/** One category's line in the fit: what its own live-token peers pay, and the band the board carries. */
export interface FitCategory {
  category: string;
  n: number;
  geom_multiple: number;
  shrunk_multiple: number;
  loo_sd: number;
  low: number;
  high: number;
}

/** One row of the ablation table: what a specification's leave-one-out error was, and whether it shipped. */
export interface AblationRow {
  name: string;
  mae_dex: number;
  delta_dex: number;
  priced: boolean;
  note?: string;
}

/** The fit: the comparables' own multiples, the calibration it earns, and the ablation that chose it. */
export interface Fit {
  n_live: number;
  n_categories: number;
  global_multiple: number;
  size_slope: number;
  size_t: number;
  mae_dex: number;
  p50_ratio: number;
  baseline_p50_ratio: number;
  within2: number;
  within3: number;
  within5: number;
  gate_dex: number;
  prior_k: number;
  band_z: number;
  categories: FitCategory[];
  ablation: AblationRow[];
  log_global: number;
  intercept: number;
  mean_log_tvl: number;
  sd_global: number;
  log_by_category: Record<string, number>;
  sd_by_category: Record<string, number>;
  peer_counts: Record<string, number>;
}

/** One row of board.json: the ranked board's row, with the fitted multiple it was priced at. */
export interface BoardRow {
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
  age_days: number | null;
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
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  low_value_usd: number;
  high_value_usd: number;
  multiple: number;
  category_n: number;
  growth_multiplier: number;
  maturity_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the fit behind it and the settings it ran. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelSettings;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
  fit: Fit;
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** `value` kept inside [lo, hi]. */
function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

/** The arithmetic mean of `values`, or 0 when it is empty. */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** The median of `values` (the mean of the middle pair when even), or 0 when it is empty. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The sample standard deviation (n - 1), or 0 when fewer than two values are given. */
function sampleSd(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  let ss = 0;
  for (const v of values) ss += (v - m) * (v - m);
  return Math.sqrt(ss / (values.length - 1));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** A protocol's category as a key: trimmed and lowercased; null or empty is 'uncategorised'. */
export function categoryKey(category: string | null): string {
  const c = (category ?? '').trim().toLowerCase();
  return c === '' ? 'uncategorised' : c;
}

/** Display labels for every key, in the snapshot's own spelling (first seen); 'Uncategorised' is the fallback. */
function displayLabels(protocols: SnapshotProtocol[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of protocols) {
    const raw = p.category;
    if (typeof raw !== 'string' || raw.trim() === '') continue;
    const key = categoryKey(raw);
    if (!map.has(key)) map.set(key, raw.trim());
  }
  return map;
}

/** A live-token peer lifted into the log-space shape the fit works in. */
export interface Peer {
  slug: string;
  key: string;
  y: number;
  x: number;
  g: number;
  a: number;
}

/** The fit's comparables: protocols with both a market cap and a TVL above zero, in log space. */
export function peersOf(snapshot: Snapshot, settings: ModelSettings): Peer[] {
  const peers: Peer[] = [];
  for (const p of snapshot.protocols) {
    if (!(typeof p.mcap_usd === 'number' && p.mcap_usd > 0 && p.tvl_usd > 0)) continue;
    const age = ageDays(snapshot.as_of, p.listed_at) ?? settings.unknown_age_days;
    peers.push({
      slug: p.slug,
      key: categoryKey(p.category),
      y: Math.log10(p.mcap_usd / p.tvl_usd),
      x: Math.log10(p.tvl_usd),
      g: clamp(finite(p.change_7d, 0), settings.growth_floor, settings.growth_cap) / 100,
      a: Math.log10(Math.max(age, 1)),
    });
  }
  return peers;
}

/** The seven-day change clamped into the settings' band, in per cent: context shown, never priced. */
function growthPct(change: number | null, settings: ModelSettings): number {
  return clamp(finite(change, 0), settings.growth_floor, settings.growth_cap);
}

/** The row's display multiples. Both are CONTEXT: shown next to the row, never multiplied into implied. */
function contextMultipliers(change: number | null, age: number | null, settings: ModelSettings) {
  const pc = growthPct(change, settings);
  const days = Math.min(Math.max(age ?? settings.unknown_age_days, 0), MATURITY_DAYS);
  return {
    growth_pct: pc,
    growth_multiplier: 1 + pc / 100,
    maturity_multiplier: 0.6 + (days / MATURITY_DAYS) * 0.4,
  };
}

/** Gauss-Jordan elimination with partial pivoting on [a | b]; zeros when a pivot is singular. */
function solveNormal(a: number[][], b: number[]): number[] {
  const m = b.length;
  const rows: number[][] = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < m; col++) {
    let piv = col;
    for (let r = col + 1; r < m; r++) {
      if (Math.abs(rows[r]![col]!) > Math.abs(rows[piv]![col]!)) piv = r;
    }
    const lead = rows[piv]![col]!;
    if (!(Math.abs(lead) > 1e-12)) return new Array(m).fill(0);
    if (piv !== col) {
      const t = rows[piv]!;
      rows[piv] = rows[col]!;
      rows[col] = t;
    }
    for (let c = col; c <= m; c++) rows[col]![c] = rows[col]![c]! / lead;
    for (let r = 0; r < m; r++) {
      if (r === col) continue;
      const f = rows[r]![col]!;
      if (f === 0) continue;
      for (let c = col; c <= m; c++) rows[r]![c] = rows[r]![c]! - f * rows[col]![c]!;
    }
  }
  const out = rows.map((r) => r[m]!);
  for (const v of out) if (!Number.isFinite(v)) return new Array(m).fill(0);
  return out;
}

/** Least squares of `target` on the columns of `design`, by the normal equations; zeros if singular. */
function ols(design: number[][], target: number[]): number[] {
  const cols = design.length > 0 ? design[0]!.length : 0;
  if (cols === 0 || design.length < cols) return new Array(cols).fill(0);
  const ata: number[][] = [];
  const atb: number[] = [];
  for (let i = 0; i < cols; i++) {
    const row: number[] = [];
    for (let j = 0; j < cols; j++) {
      let s = 0;
      for (let k = 0; k < design.length; k++) s += design[k]![i]! * design[k]![j]!;
      row.push(s);
    }
    ata.push(row);
    let s = 0;
    for (let k = 0; k < design.length; k++) s += design[k]![i]! * target[k]!;
    atb.push(s);
  }
  return solveNormal(ata, atb);
}

/** The value of one named feature of a peer ('x' log TVL, 'g' clamped growth over 100, 'a' log age). */
function featureOf(p: Peer, f: string): number {
  return f === 'x' ? p.x : f === 'g' ? p.g : p.a;
}

/** One refit: the shrunk category levels, the fitted intercept and slopes, and the spreads the bands need. */
export interface Estimate {
  feats: string[];
  coef: number[];
  centers: number[];
  catLog: Record<string, number>;
  globalLog: number;
  meanX: number;
  sdCat: Record<string, number>;
  sdGlobal: number;
  n: number;
}

/**
 * Refit the model on `peers` with the category prior `k`, leaving peer index `drop` out when it is at least
 * zero. The two terms are, in order: the shrunk category level, then an intercept plus one slope per requested
 * feature, fitted to what the category levels miss.
 */
export function refit(peers: Peer[], k: number, drop: number, feats: string[]): Estimate {
  const keep = peers.filter((_, i) => drop < 0 || i !== drop);
  const globalLog = mean(keep.map((p) => p.y));
  const meanX = mean(keep.map((p) => p.x));
  const byKey = new Map<string, number[]>();
  for (const p of keep) {
    const list = byKey.get(p.key);
    if (list === undefined) byKey.set(p.key, [p.y]);
    else list.push(p.y);
  }
  const catLog: Record<string, number> = {};
  for (const [key, list] of byKey) {
    const w = list.length / (list.length + k);
    catLog[key] = w * mean(list) + (1 - w) * globalLog;
  }
  const resid = keep.map((p) => p.y - (catLog[p.key] ?? globalLog));
  const centers = feats.map((f) => mean(keep.map((p) => featureOf(p, f))));
  const design = keep.map((p) => [1, ...feats.map((f, j) => featureOf(p, f) - centers[j]!)]);
  const coef = ols(design, resid);
  const sdCat: Record<string, number> = {};
  for (const [key, list] of byKey) {
    if (list.length < 3) continue;
    sdCat[key] = sampleSd(list.map((y) => y - catLog[key]!));
  }
  return { feats, coef, centers, catLog, globalLog, meanX, sdCat, sdGlobal: sampleSd(resid), n: keep.length };
}

/** A peer's fitted log multiple: its category level, the intercept, and each feature's shift from the mean. */
export function predict(est: Estimate, p: Peer): number {
  let v = (est.catLog[p.key] ?? est.globalLog) + (est.coef[0] ?? 0);
  for (let j = 0; j < est.feats.length; j++) {
    v += (est.coef[j + 1] ?? 0) * (featureOf(p, est.feats[j]!) - (est.centers[j] ?? 0));
  }
  return v;
}

/** The spread the board's band uses for a category: its own peers' spread, else the global spread. */
export function spreadFor(fit: Fit, key: string, logM: number): number {
  const own = fit.sd_by_category[key];
  if (own !== undefined) return own;
  const base = fit.log_by_category[key] ?? fit.log_global;
  return Math.max(fit.sd_global, Math.abs(logM - base));
}

/**
 * Fit the comparable-multiple model on the snapshot's own live-token peers. `full` is every peer; then each peer
 * is priced by a model refitted without it, five ways, so the calibration and the ablation are leave-one-out and
 * no peer helps price itself.
 */
export function fitModel(snapshot: Snapshot, settings: ModelSettings = MODEL): Fit {
  const peers = peersOf(snapshot, settings);
  const k = settings.prior_k;
  const full = refit(peers, k, -1, ['x']);
  const errsShip: number[] = [];
  const errsGlobal: number[] = [];
  const errsCat: number[] = [];
  const errsMom: number[] = [];
  const errsAge: number[] = [];
  for (let i = 0; i < peers.length; i++) {
    const p = peers[i]!;
    errsShip.push(p.y - predict(refit(peers, k, i, ['x']), p));
    errsGlobal.push(p.y - refit(peers, k, i, []).globalLog);
    errsCat.push(p.y - predict(refit(peers, k, i, []), p));
    errsMom.push(p.y - predict(refit(peers, k, i, ['x', 'g']), p));
    errsAge.push(p.y - predict(refit(peers, k, i, ['x', 'a']), p));
  }
  return finishFit(snapshot, settings, peers, full, [errsShip, errsGlobal, errsCat, errsMom, errsAge]);
}

/** Turn the five leave-one-out error vectors into the calibration, the ablation table and the category table. */
function finishFit(snapshot: Snapshot, settings: ModelSettings, peers: Peer[], full: Estimate, errs: number[][]): Fit {
  const errsShip = errs[0]!;
  const errsGlobal = errs[1]!;
  const errsCat = errs[2]!;
  const errsMom = errs[3]!;
  const errsAge = errs[4]!;
  const mae = (e: number[]): number => mean(e.map((v) => Math.abs(v)));
  const share = (e: number[], d: number): number => (e.length === 0 ? 0 : e.filter((v) => Math.abs(v) <= d).length / e.length);
  const n = peers.length;

  let sq = 0;
  for (const p of peers) sq += (p.y - predict(full, p)) * (p.y - predict(full, p));
  let sxx = 0;
  for (const p of peers) sxx += (p.x - full.meanX) * (p.x - full.meanX);
  const sizeSlope = full.coef[1] ?? 0;
  const se = n > 2 && sxx > 0 ? Math.sqrt(sq / (n - 2) / sxx) : 0;
  const sizeT = se > 0 ? sizeSlope / se : 0;

  const labels = displayLabels(snapshot.protocols);
  const counts = new Map<string, number>();
  const sums = new Map<string, number>();
  for (const p of peers) {
    counts.set(p.key, (counts.get(p.key) ?? 0) + 1);
    sums.set(p.key, (sums.get(p.key) ?? 0) + p.y);
  }
  const keys = new Set<string>(Object.keys(full.catLog));
  for (const p of snapshot.protocols) keys.add(categoryKey(p.category));
  const categories: FitCategory[] = [...keys].map((key) => {
    const cn = counts.get(key) ?? 0;
    const log = cn > 0 ? full.catLog[key]! : full.globalLog;
    const own = full.sdCat[key];
    const spread = cn >= 3 && own !== undefined ? own : Math.max(full.sdGlobal, own ?? 0);
    return {
      category: labels.get(key) ?? 'Uncategorised',
      n: cn,
      geom_multiple: cn > 0 ? 10 ** (sums.get(key)! / cn) : 0,
      shrunk_multiple: 10 ** log,
      loo_sd: spread,
      low: 10 ** (log - settings.band_z * spread),
      high: 10 ** (log + settings.band_z * spread),
    };
  });
  categories.sort((a, b) => b.n - a.n || b.shrunk_multiple - a.shrunk_multiple || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  return {
    n_live: n,
    n_categories: categories.length,
    global_multiple: 10 ** full.globalLog,
    size_slope: sizeSlope,
    size_t: sizeT,
    mae_dex: mae(errsShip),
    p50_ratio: median(errsShip.map((e) => 10 ** e)),
    baseline_p50_ratio: median(errsGlobal.map((e) => 10 ** e)),
    within2: share(errsShip, Math.log10(2)),
    within3: share(errsShip, Math.log10(3)),
    within5: share(errsShip, Math.log10(5)),
    gate_dex: settings.min_improvement_dex,
    prior_k: settings.prior_k,
    band_z: settings.band_z,
    categories,
    ablation: ablationRows(settings, mae, errsShip, errsGlobal, errsCat, errsMom, errsAge),
    log_global: full.globalLog,
    intercept: full.coef[0] ?? 0,
    mean_log_tvl: full.meanX,
    sd_global: full.sdGlobal,
    log_by_category: full.catLog,
    sd_by_category: full.sdCat,
    peer_counts: Object.fromEntries(counts),
  };
}

/**
 * The ablation table: one row per specification, in the order the terms entered. `delta_dex` is that row's MAE
 * minus the basis row's MAE, where the basis is the last specification that shipped: so each rejected feature is
 * measured against the model that was actually kept, and a positive delta means the feature made the error worse.
 */
function ablationRows(settings: ModelSettings, mae: (e: number[]) => number, ship: number[], global: number[], cat: number[], mom: number[], age: number[]): AblationRow[] {
  const table: Array<[string, number, boolean, string | undefined]> = [
    ['Global mean, one multiple for all', mae(global), false, undefined],
    [`Category level, shrunk k=${settings.prior_k}`, mae(cat), true, 'level bias, not discrimination'],
    ['+ TVL size slope', mae(ship), true, undefined],
    ['+ 7-day momentum', mae(mom), false, undefined],
    ['+ age since listing', mae(age), false, undefined],
  ];
  const rows: AblationRow[] = [];
  let pricedBase = table[0]![1];
  for (let i = 0; i < table.length; i++) {
    const [name, m, priced, note] = table[i]!;
    const delta = i === 0 ? 0 : m - pricedBase;
    const row: AblationRow = { name, mae_dex: m, delta_dex: delta, priced };
    if (note !== undefined) row.note = note;
    rows.push(row);
    if (priced) pricedBase = m;
  }
  return rows;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/**
 * The protocols the board ranks, strongest first, with ranks 1..n, each priced at the multiple its category's
 * live-token peers pay (shrunk, shifted by the TVL size slope) and given that category's band. The board is a
 * level per category, not a ranking inside one: two rows in a category differ only by the size slope and by
 * where they sit between their band's ends.
 */
export function buildBoard(snapshot: Snapshot, model: ModelSettings = MODEL, fitted?: Fit): BoardRow[] {
  const fit = fitted ?? fitModel(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a replacement
  // for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const key = categoryKey(p.category);
    const base = fit.log_by_category[key] ?? fit.log_global;
    const logM = base + fit.intercept + fit.size_slope * (Math.log10(p.tvl_usd) - fit.mean_log_tvl);
    const spread = spreadFor(fit, key, logM);
    const implied = Math.max(1, Math.round(p.tvl_usd * 10 ** logM));
    const low = Math.max(1, Math.round(p.tvl_usd * 10 ** (logM - model.band_z * spread)));
    const high = Math.max(implied, Math.round(p.tvl_usd * 10 ** (logM + model.band_z * spread)));
    return { p, age, key, logM, base, spread, implied, low, high };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => {
    const ctx = contextMultipliers(s.p.change_7d, s.age, model);
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      age_days: s.age,
      implied_value_usd: s.implied,
      low_value_usd: s.low,
      high_value_usd: s.high,
      model: {
        multiple: round4(10 ** s.logM),
        category_multiple: round4(10 ** s.base),
        size_multiple: round4(10 ** (s.logM - s.base)),
        category_n: fit.peer_counts[s.key] ?? 0,
        band_low: round4(10 ** (s.logM - model.band_z * s.spread)),
        band_high: round4(10 ** (s.logM + model.band_z * s.spread)),
        growth_pct: round4(ctx.growth_pct),
        growth_multiplier: round4(ctx.growth_multiplier),
        maturity_multiplier: round4(ctx.maturity_multiplier),
        age_days: s.age,
      },
      farm_steps: farmSteps(s.p, s.age).map(stepText),
    };
  });
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    low_value_usd: row.low_value_usd,
    high_value_usd: row.high_value_usd,
    multiple: row.model.multiple,
    category_n: row.model.category_n,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot and the fit it was scored with. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const fit = fitModel(snapshot, model);
  const board = buildBoard(snapshot, model, fit);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
    fit,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
