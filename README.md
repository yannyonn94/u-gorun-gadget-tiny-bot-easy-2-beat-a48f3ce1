[![Tiny Bot](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![Rank](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/yannyonn94/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/rank.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![Reward](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/yannyonn94/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/reward.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)

# Tiny Bot — RSI Mean-Reversion on Solana

Buy fear, sell the bounce: an RSI(14) mean-reversion paper-trading bot for
hourly Solana bars. It buys when RSI(14) drops to 28 or below and exits on
RSI 55, +6% ROI, a -1.8% stop, or a 24-bar timeout — one 25%-of-equity
stake per symbol, long only, sells first, then buys.

## Dev result (kit grade-local, `--driver process`)

- **Net PnL +366.14 USDC** (return +3.66%, 90% interval +210.20 to +528.84)
- **Margin over buy-and-hold: +1,235.48 USDC** (buy-and-hold dev: -869.34)
- 29 trades over 6 symbols, win rate 66.7%, max drawdown 3.7%, 0 rejected
- Best house baseline (RSI-Bollinger): -56.49 USDC — this bot beats it by 422.63
- Deterministic: two executions reproduce byte for byte; still +288.94 at 2x fees
- Guardrails: 29 trades (min 8), max drawdown 3.7% (cap 25%) — met with
  wide margin; 29 fills in 136 dev bars also leaves headroom for the
  8-trade minimum on the 72-bar final window (~15 fills expected)

## Strategy

- Entry: RSI(14) Wilder <= 28 on a symbol's hourly close, when not holding it.
- Exit (whole position): RSI >= 55, or value >= 106% of cost, or value
  <= 98.2% of cost, or held 24 bars since the position first appeared.
- Stake: equity / 4 per entry, capped by the 25% max-weight cap and cash.
- Slippage cap 100 bps per order; at most 16 orders per bar.

## Tuning note

The first candidate (RSI <= 25, +3% / -2.5% / 8 bars) graded -192 USDC,
so the search moved to deeper patience — and was checked against
overfitting: the final parameters sit mid-plateau (entry 27-29, ROI 5-7%,
stop -1.5% to -2%, hold 20-30 bars all stay positive), every 45-bar
segment of the dev window is positive, and the 100-135 holdout slice is
positive (+53.8 USDC in the offline replay that reproduces the grader).

## Files

- `main.ts` — the bot (entrypoint, runs on Node 22.18+ via `node main.ts`)
- `vendor/makefun-bars.ts` — the kit's bars-replay SDK shim, copied verbatim
- `LICENSE` — MIT

## Run it

```sh
node <kit>/cli/makefun.mjs grade-local --kit <kit> --bot . --driver process
```
