[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/kyy0887/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/kyy0887/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Token Radar

A token launch radar for make.fun's `token-radar-01` bounty.

It reads a sealed DefiLlama protocol snapshot, ranks every pre-token protocol by implied
value, and builds a static dashboard that plots which protocol is worth farming next and
how. The ranking is a pure function of the snapshot's own figures — no protocol name is
special-cased — with an airdrop-category model on top of TVL, seven-day growth and age.

## Run

Node 22, standard library only:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` into `out/`.

Use `--quiet` to suppress progress output:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json> --quiet
```

## Model

`implied = round(tvl_usd x 0.25 x (1 + clamp(change_7d,-60,120)/100 x 0.5) x (0.6 + min(age,1095)/1095 x 0.4) x airdropCategoryFactor)`

The airdrop category factor rewards the categories that have historically farmed a token
most often (bridges, restaking, L2 chains, DEXs, lending, launchpads) and trims the ones
that rarely do (CEX, wrappers).

Made for the [make.fun](https://make.fun) `token-radar-01` competition.
