// Self-test for the token radar model (Node 22, standard library only).
//
// Re-runs buildBoard from lib/model.ts over the sealed snapshot and asserts the
// invariants the gate depends on. Each invariant prints PASS or FAIL; the process
// exits 1 the moment any check fails. Runs:
//
//   node lib/selftest.ts --input ../token-radar-01-kit/input/snapshot.json

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildBoard, parseSnapshot } from './model.ts';

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
  process.stderr.write(`selftest: no snapshot at ${inputFile}: pass --input <snapshot.json|directory>\n`);
  process.exit(2);
}

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const board = buildBoard(snapshot);

let failed = 0;

function invariant(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (${detail})`}`);
  if (!ok) failed += 1;
}

// (a) The board covers every watchlist protocol.
{
  const covered = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !covered.has(s));
  invariant(
    'a: board covers all watchlist protocols',
    missing.length === 0,
    `missing ${missing.length}: ${missing.slice(0, 5).join(', ')}`,
  );
}

// (b) Rows are ordered descending by implied value.
{
  let ordered = true;
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      ordered = false;
      break;
    }
  }
  invariant('b: rows sorted descending by implied value', ordered);
}

// (c) Every multiplier lies within the sane band 0 < x <= 5.
{
  let inBand = true;
  let bad: string[] = [];
  const mults = (r: (typeof board)[number]) => [
    ['growth', r.model.growth_multiplier],
    ['maturity', r.model.maturity_multiplier],
    ['airdrop', r.model.airdrop_multiplier],
  ] as const;
  for (const r of board) {
    for (const [name, v] of mults(r)) {
      if (!(v > 0 && v <= 5)) {
        inBand = false;
        bad = [...bad, `${r.slug}.${name}=${v}`];
        break;
      }
    }
    if (!inBand) break;
  }
  invariant('c: all multipliers in 0 < x <= 5', inBand, bad.slice(0, 5).join(', '));
}

// (d) Exactly 200 ranked rows.
{
  invariant('d: board has 200 rows', board.length === 200, `got ${board.length}`);
}

if (failed > 0) {
  process.stderr.write(`selftest: ${failed} invariant${failed === 1 ? '' : 's'} failed\n`);
  process.exit(1);
}
console.log('selftest: all invariants PASS');
