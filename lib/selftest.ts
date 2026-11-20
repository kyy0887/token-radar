// Self-test for the token radar model (Node 22, standard library only).
//
// Re-runs buildBoard from lib/model.ts over the sealed snapshot, asserts the invariants the gate depends on,
// then prints a report of what the fit found: the comparables it was scored with, its global multiple, the
// size slope and its t statistic, the leave-one-out calibration, and the five-row ablation. Each invariant prints
// PASS or FAIL; the process exits 1 the moment any check fails and 0 only when every one holds.
//
//   node --experimental-strip-types lib/selftest.ts --input ../token-radar-01-kit/input/snapshot.json

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODEL, buildBoard, fitModel, parseSnapshot } from './model.ts';

/** --input <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`selftest: no snapshot at ${inputFile}: pass an input with --input <snapshot.json|directory>\n`);
  process.exit(2);
}

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const fit = fitModel(snapshot, MODEL);
const board = buildBoard(snapshot, MODEL, fit);

let failed = 0;

function invariant(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (${detail})`}`);
  if (!ok) failed += 1;
}

/** (a) The board covers every watchlist protocol. */
{
  const covered = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !covered.has(s));
  invariant('a: board covers all watchlist protocols', missing.length === 0, `missing ${missing.length}: ${missing.slice(0, 5).join(', ')}`);
}

/** (b) Rows are ordered descending by implied value. */
{
  let ordered = true;
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) ordered = false;
  }
  invariant('b: rows sorted descending by implied value', ordered);
}

/** (d) Exactly 200 ranked rows. */
invariant('d: board has 200 rows', board.length === 200, `got ${board.length}`);

/**
 * (e) Every row sits inside its own band: its multiple is positive and between band_low and band_high, and its
 * implied value is a positive safe integer between low_value_usd and high_value_usd.
 */
{
  const bad: string[] = [];
  for (const r of board) {
    const m = r.model;
    const inside =
      m.multiple > 0 &&
      m.band_low <= m.multiple &&
      m.multiple <= m.band_high &&
      r.low_value_usd <= r.implied_value_usd &&
      r.implied_value_usd <= r.high_value_usd;
    if (!inside || !Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) bad.push(r.slug);
  }
  invariant('e: every row has a positive multiple inside its band and a positive safe-integer implied value', bad.length === 0, bad.slice(0, 5).join(', '));
}

/** Four decimals for multiples; three for dex errors. */
const fm = (n: number): string => (Math.round(n * 1e4) / 1e4).toFixed(4);
const fx = (n: number): string => (Math.round(n * 1e3) / 1e3).toFixed(3);
const share = (n: number): string => `${(Math.round(n * 1000) / 10).toFixed(1)} per cent`;

console.log(`fit n_live ${fit.n_live}`);
console.log(`fit n_categories ${fit.n_categories}`);
console.log(`fit global_multiple ${fm(fit.global_multiple)}`);
console.log(`fit size_slope ${fx(fit.size_slope)}`);
console.log(`fit size_t ${fx(fit.size_t)}`);
console.log(`fit mae_dex ${fx(fit.mae_dex)}`);
console.log(`fit p50_ratio ${fm(fit.p50_ratio)}`);
console.log(`fit within2 ${share(fit.within2)} of peers`);
console.log(`fit within3 ${share(fit.within3)} of peers`);
console.log(`fit within5 ${share(fit.within5)} of peers`);
for (const row of fit.ablation) {
  console.log(`ablate ${row.name} | mae=${fx(row.mae_dex)} delta=${fx(row.delta_dex)} priced=${row.priced}`);
}
console.log(`fit intercept ${fx(fit.intercept)} mean_log_tvl ${fx(fit.mean_log_tvl)} sd_global ${fx(fit.sd_global)}`);
console.log(`fit categories_measured ${fit.categories.filter((c) => c.n > 0).length}`);

if (failed > 0) {
  process.stderr.write(`selftest: ${failed} invariant${failed === 1 ? '' : 's'} failed\n`);
  process.exit(1);
}
console.log('selftest: all invariants PASS');

