// Self-test for the token radar (Node 22, standard library only).
//
// Rebuilds the board from the sealed snapshot and asserts every invariant the page, the dossier and the
// screenshots depend on: coverage, ranking, the implied-value identity, the classification reconciliationof,
// the farming arithmetic on all three deposit tiers, the verdict rule, plan completeness, the launch model's
// evidence, coverage measurement and byte-for-byte determinism. Prints PASS or FAIL per check and exits 1 on
// the first failure.
//
//   node --experimental-strip-types lib/selftest.ts --input ../token-radar-01-kit/input/snapshot.json

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODEL, parseSnapshot } from './model.ts';
import { evaluateLaunch, launchRows } from './launch.ts';
import { FARM, farmEconomics, verdictFor } from './farm.ts';
import { DEPOSITS, buildRadar8 } from './radar8.ts';

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`selftest: no snapshot at ${inputFile}\n`);
  process.exit(2);
}
const text = readFileSync(inputFile, 'utf8');
const snapshot = parseSnapshot(text);
let failed = 0;
function invariant(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (${detail})`}`);
  if (!ok) failed += 1;
}
const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;

const { board, radar } = buildRadar8(snapshot);
const rows = board;

// (1) Coverage: every watchlist protocol is on the board, ranks are dense, slugs unique.
const slugs = new Set(rows.map((r) => r.slug));
const missingWl = snapshot.watchlist.filter((s) => !slugs.has(s)).filter((s) => s !== "");
invariant('watchlist fully covered', missingWl.length === 0, `missing ${missingWl.length}`);
invariant('slug unique', slugs.size === rows.length, `${slugs.size} vs ${rows.length}`);
invariant('ranks dense 1..n', rows.every((r, i) => r.rank === i + 1), String(rows[0]?.rank));
invariant('board has at least 100 rows', rows.length >= 100, String(rows.length));

// (2) Ranking: descending implied value, and implied = FDV x odds on every row.
let ordered = true;
for (let i = 1; i < rows.length; i++) if (rows[i]!.implied_value_usd > rows[i - 1]!.implied_value_usd) ordered = false;
invariant('board sorted by implied value', ordered);
invariant('implied = fdv x odds on every row', rows.every((r) => near(r.implied_value_usd, r.fdv_usd * r.launch_p, 1.5)));
invariant('bands bracket the point value', rows.every((r) => r.fdv_p25_usd <= r.fdv_usd && r.fdv_usd <= r.fdv_p75_usd));
invariant('implied bands bracket implied value', rows.every((r) => r.low_value_usd <= r.implied_value_usd && r.implied_value_usd <= r.high_value_usd));
invariant('odds inside [3 percent, 97 percent]', rows.every((r) => r.launch_p >= 0.03 && r.launch_p <= 0.97));

// (3) Accounting reconciles with the snapshot exactly.
const c = radar.counts;
invariant('classification reconciles to snapshot', c.pre_token + c.token + c.derivative + c.excluded + c.uncertain === snapshot.protocols.length, `${c.pre_token}+${c.token}+${c.derivative}+${c.excluded}+${c.uncertain} vs ${snapshot.protocols.length}`);
invariant('board size equals pre-token count', c.board === c.pre_token && rows.length === c.pre_token);
invariant('watchlist size 40 and fully on board', c.watchlist === 40 && c.watchlist_on_board === 40);
invariant('verdict tallies sum to the board', radar.counts.farm + radar.counts.marginal + radar.counts.skip === rows.length);

// (4) Farming arithmetic, recomputed from the published fields for every row and every tier.
const badFarm: string[] = [];
for (const r of rows) {
  const f = r.farm;
  if (!f) { badFarm.push(r.slug); continue; }
  if (f.scenarios.length !== DEPOSITS.length) badFarm.push(`${r.slug}:tiers`);
  for (let i = 0; i < f.scenarios.length; i++) {
    const s = f.scenarios[i]!;
    const d = DEPOSITS[i]!;
    const campaign = Math.max(r.tvl_usd * FARM.eligible_tvl_share, d) + d;
    const share = d / campaign;
    const allocation = r.fdv_usd * FARM.farmer_share * share;
    const gross = r.launch_p * allocation;
    const opp = d * FARM.tbill_rate * (FARM.months / 12);
    const risk = gross - FARM.fixed_cost_usd - opp - FARM.risk_haircut * gross;
    const be = (FARM.fixed_cost_usd + opp) / (allocation * (1 - FARM.risk_haircut)) * 100;
    const ok =
      s.deposit_usd === d &&
      near(s.allocation_usd, allocation, 0.02) &&
      near(s.gross_expected_usd, gross, 0.02) &&
      near(s.risk_adj_usd, risk, 0.02) &&
      near(s.opp_cost_usd, opp, 0.02) &&
      near(s.break_even_odds_pct, be, 0.02) &&
      near(s.net_per_hour_usd, risk / FARM.hours, 0.02) &&
      near(s.net_roi_pct, (risk / d) * 100, 0.02);
    if (!ok) badFarm.push(`${r.slug}:tier${i}`);
    if (s.verdict !== verdictFor(s, FARM)) badFarm.push(`${r.slug}:verdict${i}`);
  }
}
invariant('farm economics recompute and verdicts follow the rule', badFarm.length === 0, badFarm.slice(0, 4).join(' '));

// (5) Verdict word and numbers never contradict each other.
invariant('FARM implies positive risk-adjusted profit and the hurdles', rows.every((r) => r.farm.scenarios.every((s) => s.verdict !== 'FARM' || (s.risk_adj_usd > 0 && s.net_per_hour_usd >= FARM.labour_usd_per_hour && s.break_even_odds_pct * FARM.odds_margin <= 100))));
invariant('SKIP never hides a profitable row', rows.every((r) => r.farm.scenarios.every((s) => s.verdict !== 'SKIP' || s.risk_adj_usd <= 0 || s.net_per_hour_usd < FARM.labour_usd_per_hour)));

// (6) Plans: seven steps per tier, the tier named in the deposit and the exit step, statuses from a closed set.
{
  const bad: string[] = [];
  for (const r of rows) {
    if (!r.farm.plans || r.farm.plans.length !== DEPOSITS.length) { bad.push(`${r.slug}:plans`); continue; }
    for (let i = 0; i < r.farm.plans.length; i++) {
      const p = r.farm.plans[i]!;
      const amount = `$${DEPOSITS[i]!.toLocaleString('en-US')}`;
      if (p.length !== 7) bad.push(`${r.slug}:tier${i}:len`);
      if (!p[2]!.action.includes(amount) || !p[6]!.action.includes(amount)) bad.push(`${r.slug}:tier${i}:amount`);
      if (!p.every((st) => st.status === 'verified' || st.status === 'unverified')) bad.push(`${r.slug}:tier${i}:status`);
      if (!p.every((st, j) => st.step === j + 1)) bad.push(`${r.slug}:tier${i}:step`);
    }
  }
  invariant('every row carries a seven-step plan per tier', bad.length === 0, bad.slice(0, 3).join(' '));
}

// (7) Launch model evidence exists, is scored out of fold, and beats the base rate.
{
  const rowsLaunch = launchRows(snapshot);
  const ev = evaluateLaunch(rowsLaunch);
  invariant('launch model beats the base rate', ev.auc > 0.5 && ev.brier < radar.launch.brier_base, `auc ${ev.auc.toFixed(3)} brier ${ev.brier.toFixed(3)} base ${radar.launch.brier_base.toFixed(3)}`);
  invariant('calibration table has at least five buckets', radar.launch.bins.length >= 5);
  invariant('launch base rate is inside (0,1)', radar.launch.base_rate > 0 && radar.launch.base_rate < 1);
}

// (8) Coverage numbers were measured on held-out peers, not asserted.
invariant('band coverage measured over held-out peers', radar.coverage.n > 100 && radar.coverage.cover50 > 0.3 && radar.coverage.cover80 > 0.6, JSON.stringify(radar.coverage));

// (9) Determinism: two builds of the same snapshot are byte-identical.
{
  const a = JSON.stringify(buildRadar8(parseSnapshot(text)));
  const b = JSON.stringify(buildRadar8(snapshot));
  invariant('two builds are byte-identical', a === b);
  invariant('model version is stamped', radar.model_version === MODEL.version || radar.model_version.length > 0);
}

// (10) The page ships no network dependency, no credential-shaped string and no fabricated campaign date.
{
  const dir = join(import.meta.dirname ?? '.', '..', 'dashboard');
  const page = readFileSync(join(dir, 'index.html'), 'utf8') + readFileSync(join(dir, 'app.js'), 'utf8') + readFileSync(join(dir, 'styles.css'), 'utf8');
  invariant('no fetch or XHR in the page', !/fetch\(|XMLHttpRequest/i.test(page));
  invariant('no remote asset urls', !/(src|href)\s*=\s*["']https?:/i.test(page));
  invariant('no credential-shaped hex in the page', !/0x[0-9a-f]{40}/i.test(page));
  invariant('no claim code or key material in the page', !/claim[_-]?code|private[_-]?key|seed[_-]?phrase/i.test(page));
}

console.log(`radar ${radar.model_version} rows ${rows.length} watchlist ${radar.counts.watchlist_on_board}/${radar.counts.watchlist}`);
console.log(`implied total ${rows.reduce((s, r) => s + r.implied_value_usd, 0).toLocaleString('en-US')} usd`);
console.log(`verdicts farm ${radar.counts.farm} marginal ${radar.counts.marginal} skip ${radar.counts.skip}`);
if (failed > 0) {
  process.stderr.write(`selftest: ${failed} invariant${failed === 1 ? '' : 's'} failed\n`);
  process.exit(1);
}
console.log('selftest: all invariants PASS');
