# makefun-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/shi-hao-dev/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/shi-hao-dev/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Launch Radar — ranks 198 pre-token protocols by implied value from a least-squares fit on the 128 live-token comparables in the same sealed DefiLlama snapshot (ln(market cap) on ln(TVL), 7-day growth and age; R² 0.2114), validated by 5-fold cross-validation and walk-forward splits against the old median-multiple baseline (fitted wins every split), with a concrete costed farm plan for each, on a sealed DefiLlama snapshot. The dashboard is a static, offline page: a sortable, filterable board, a detail view per protocol with the fitted value breakdown, the validation table, the live-token comparables, and a model sandbox that re-ranks the board live.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=ssmh6x4k&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
