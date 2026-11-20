[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/kyy0887/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/kyy0887/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Token Radar

Pre-token protocol intelligence for make.fun's `token-radar-01` bounty. It reads the sealed DefiLlama
snapshot, decides which protocols have no token of their own, estimates what a token would be worth
**and** how likely one is to appear, then prices a farming position after fees, time and the yield it
displaces.

Three screens, one model: the ranked board, the per-protocol dossier, the validation panel. Every
figure is computed from the snapshot at build time by `main.ts`; nothing is typed in by hand and
nothing is fetched at runtime.

- Snapshot **2026-11-14**: 758 protocols, 199 pre-token candidates, 40/40 watchlist covered.
- Implied value `= FDV if launched × launch probability`, both terms printed on every row.
- Model `radar-4-odds` = comparable multiple (`radar-3-comps-fit`) × calibrated launch curve.

## Run

Node 22.18+, standard library only, no install step, no network:

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json
```

Writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and the vendor-built `dossier.json` into
`out/`. Open `out/dashboard/index.html` over `file://`; it loads `../data.js` and works offline.
`--quiet` silences progress.

Self-test (21 invariants, exit 1 on any failure):

```sh
node --experimental-strip-types lib/selftest.ts --input ../token-radar-01-kit/input/snapshot.json
```

## Classification

A protocol is a **pre-token candidate** when the snapshot records no `mcap_usd`, no `gecko_id` and no
`symbol`, and its name is not a wrapped, staked, bridged or otherwise derived product of something already
tradable. Derivatives are matched on a name vocabulary *and* on the underlying name being present in the
snapshot, so `stETH`-style products leave the board without a genuine protocol that shares a word being
swept out with them.

Reconciliation over all 758 rows: **416** existing token, **133** derivative, **199** pre-token candidate,
**10** excluded (dead or non-protocol), **0** uncertain. The buckets sum to 758, the board is exactly the
candidate bucket, and `selftest` asserts both facts — the audit is a test, not a caption.

## Valuation: what the token would be worth

One comparable multiple, fitted on the snapshot's own tokenised protocols and shrunk by category:

```
multiple(p) = 10^(level(cat) + slope × (log10 TVL(p) − mean log10 TVL))
level(cat)  = (Σ log10(mcap/TVL) + k × μ) / (n + k)      k = 4, μ = global mean
```

`slope = −0.376` dex of multiple per decade of TVL (`t = −4.34`) and `global multiple = 0.224×`.
Peers: **128** priced protocols across **34** categories carrying **$33.8B** TVL. `FDV = TVL × multiple`;
`P25–P75 = 10^(logM ± 0.6745σ)`.

There is no hand-set category premium. Where a category has one peer the level is mostly the global
mean, and the dossier prints the peer count so the reader can see that.

## Launch odds

Ridge logistic on `log10(TVL)`, `log10(age days)` and a shrunk category offset, fitted on the snapshot's
own split — 416 protocols that record a token against 342 that do not — and scored **out of fold**
(5 folds by slug hash), so no protocol is ever predicted by a model that has seen it. The 12-month
number is the eventual one × 0.45.

- AUC **0.751**, Brier **0.204** against **0.248** for the base rate: **17.5%** skill, n = 758.
- Calibration by predicted bucket is on the board, predicted vs observed, and in `dossier.json`.

This is an assumption stated as one: the snapshot is a single cross-section, so "eventually" is read
off the mix of tokenised and untokenised protocols, not off a time series.

## Bands and coverage

`implied = FDV × p`; the P25–P75 range applies the band to both terms. Coverage is measured
leave-one-out on the 128 priced peers with the shipped band: **50.8%** inside P25–P75 and **81.3%**
inside the 80% band. Those are measurements, and they are the ones printed on the board.

## Farming economics

For deposit `D`, farmer share 4.5% of FDV, eligible TVL 12% of protocol TVL:

```
campaign = max(TVL × 0.12, D) + D
share    = D / campaign
alloc    = FDV × 0.045 × share
gross    = p × alloc
opp      = D × 4.3% × 9.5/12
risk_adj = gross − 27 − opp − 0.35 × gross
```

`p` is applied once, in `gross`; the $27 of gas and the opportunity cost are paid whether the token lands
or not; the 35% haircut is on the gross, never on the probability a second time. Then
`net/hour = risk_adj / 5h`, `ROI = risk_adj / D`, break-even odds `= (27 + opp) / (alloc × 0.65)`.

The verdict follows from the arithmetic, not from a target count:

- **FARM** — `risk_adj > 0`, at least **$15/hour** for the farmer's time, and break-even odds at least
  **1.35×** better than the model's odds.
- **MARGINAL** — positive, but fails one of the two hurdles.
- **SKIP** — negative after costs and the haircut.

Because the fixed cost and the opportunity cost do not scale with size, a protocol can be SKIP at
$1,000 and FARM at $25,000. The dossier's three tabs show exactly that, and the board's verdict follows
the tab in focus.

## What this does not claim

- One snapshot, no history: no walk-forward test, no blind temporal holdout. The odds curve is a
  cross-section and is described as one.
- No token-family holdout. Peers sharing a family can flatter a category level.
- Categories with one peer get a wide band, and wide is the honest answer at n = 1.
- Farming inputs are stated assumptions on a template, not a protocol's published campaign terms.
  Any step the protocol does not document is marked `unverified`; no snapshot date, points programme,
  deposit contract or claim page is invented.
- 9.5-month figures ignore the path. A locked 9.5 months is not a liquid 9.5 months.

## Screenshots

- `screenshots/board.png` — the ranked board: accounting bar, filters, all 199 rows, validation column.
- `screenshots/detail.png` — one dossier: decomposition, formula, P25–P75, farm economics and the
  seven-step plan at $25,000.
- `screenshots/filtered.png` — FARM only, sorted by net per hour: 16 rows at $25,000.

Captured from the built dashboard through `file://` with Playwright as development tooling. The
runtime is Node 22 standard library only, and the page needs no browser driver.

## Layout

```
main.ts                 build: snapshot -> board.json, data.js, dashboard, dossier
lib/model.ts            snapshot parsing, classification, comparable multiple
lib/launch.ts           launch-odds model and out-of-fold evaluation
lib/farm.ts             farming economics and the verdict rule
lib/radar8.ts           board assembly, scenarios, plans, coverage
lib/selftest.ts         invariants and arithmetic checks
dashboard/              static page (index.html, app.js, app.css)
vendor/makefun-board.ts official dossier builder
screenshots/            the three captures
```

MIT licensed. No API keys, wallets or credentials in the tree. The snapshot is the bounty's sealed
input; the page reads only `data.js` generated from it.

Made for the [make.fun](https://make.fun) `token-radar-01` competition.
