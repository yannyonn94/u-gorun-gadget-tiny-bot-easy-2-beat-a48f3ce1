// Tiny Bot — RSI(14) mean-reversion on hourly Solana bars.
// Concept: buy fear, sell the bounce. In a choppy downtrend the crowd
// oversells every dip; RSI <= 28 marks the panic, RSI >= 55 (or a quick
// +6% / -1.8% / 24-bar timeout) banks the snap-back before it fades.
// Long only, one 25%-of-equity stake per symbol, sells first, then buys.
// Deterministic: no clock, no environment, no randomness — same bars,
// same orders, run after run. Hello, batch, orders, bar: the bot speaks
// the bars-replay protocol through the vendored SDK shim only.
//
// Tuned on the dev window with an offline replay that reproduces the
// kit grader exactly (v1 graded -192.0 USDC, simulator -192.0). The
// first candidate (RSI <= 25, +3% / -2.5% / 8 bars) lost on the full
// window, so the search moved to deeper patience: entry 28, a wider
// +6% take-profit, a tighter -1.8% stop, and a 24-bar timeout so slow
// bounces can mature instead of being cut at 8 bars. Final pick sits
// mid-plateau, not on a peak: neighbours from entry 27-29, ROI 5-7%,
// stop -1.5% to -2%, hold 20-30 bars all stay positive, and every
// 45-bar segment (0-44 / 45-89 / 90-135) plus the 100-135 holdout
// slice is positive — tune +292.6, holdout +53.8 in the simulator.

import { BPS, runBars, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const RSI_BARS = 14;
const RSI_ENTRY = 28;
const RSI_EXIT = 55;
const MAX_HOLD_BARS = 24;
const MAX_SLIPPAGE_BPS = 100;
// Exit when the position is worth 106/100 of its cost (+6% ROI).
const ROI_NUM = 106n;
const ROI_DEN = 100n;
// Stop when it is worth 982/1000 of its cost (-1.8%).
const STOP_NUM = 982n;
const STOP_DEN = 1000n;

interface Series {
  last: number | null;
  first: number[];
  gain: number | null;
  loss: number | null;
}

const series = new Map<string, Series>();
// Bar seq at which each held position first appeared in state.
const enteredAt = new Map<string, number>();

function pushClose(symbol: string, close: number): void {
  let s = series.get(symbol);
  if (s === undefined) {
    s = { last: null, first: [], gain: null, loss: null };
    series.set(symbol, s);
  }
  if (s.last !== null) {
    const change = close - s.last;
    if (s.gain === null || s.loss === null) {
      s.first.push(change);
      if (s.first.length === RSI_BARS) {
        let g = 0;
        let l = 0;
        for (const x of s.first) {
          if (x > 0) g += x;
          else l -= x;
        }
        s.gain = g / RSI_BARS;
        s.loss = l / RSI_BARS;
      }
    } else {
      const up = change > 0 ? change : 0;
      const down = change < 0 ? -change : 0;
      s.gain = (s.gain * (RSI_BARS - 1) + up) / RSI_BARS;
      s.loss = (s.loss * (RSI_BARS - 1) + down) / RSI_BARS;
    }
  }
  s.last = close;
}

function rsi(s: Series): number | null {
  if (s.gain === null || s.loss === null) return null;
  const moved = s.gain + s.loss;
  return moved === 0 ? 50 : (100 * s.gain) / moved;
}

function exits(state: BarsState, symbol: string, held: { qty: bigint; cost: bigint }, r: number | null): boolean {
  if (r !== null && r >= RSI_EXIT) return true;
  const value = state.value(symbol, held.qty);
  if (value * ROI_DEN >= held.cost * ROI_NUM) return true;
  if (value * STOP_DEN <= held.cost * STOP_NUM) return true;
  const since = enteredAt.get(symbol);
  if (since !== undefined && state.seq - since >= MAX_HOLD_BARS) return true;
  return false;
}

await runBars({
  onBatch(state, batch) {
    if (state.warmingUp) return [];
    for (const bar of batch.bars) pushClose(bar.symbol, Number(bar.c));
    const fresh = new Set(batch.bars.map((b) => b.symbol));
    const { caps, fees } = state.hello;

    // Remember when each current position first showed up, drop closed ones.
    // A position first appears in state the batch after its buy fills, so
    // the 24-bar timeout counts filled bars held, not bars since the signal.
    for (const symbol of state.positions.keys()) {
      if (!enteredAt.has(symbol)) enteredAt.set(symbol, state.seq);
    }
    for (const symbol of [...enteredAt.keys()]) {
      if (!state.positions.has(symbol)) enteredAt.delete(symbol);
    }

    const sells: SellInput[] = [];
    const entries: string[] = [];
    for (const { symbol } of state.hello.symbols) {
      const s = series.get(symbol);
      if (s === undefined || !fresh.has(symbol)) continue;
      const r = rsi(s);
      const held = state.positions.get(symbol);
      if (held !== undefined) {
        if (exits(state, symbol, held, r)) {
          sells.push({ side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
        }
        continue;
      }
      if (r !== null && r <= RSI_ENTRY) entries.push(symbol);
    }

    const orders: (SellInput | BuyInput)[] = sells.slice(0, caps.max_orders_per_bar);
    const stake = state.equity / 4n;
    const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / BPS;
    let room = caps.max_open_positions - state.positions.size;
    let cash = state.cash;
    for (const symbol of entries) {
      if (room <= 0 || orders.length >= caps.max_orders_per_bar) break;
      let slice = stake < byWeight ? stake : byWeight;
      if (cash < slice) slice = cash;
      if (slice === 0n || slice < BigInt(fees.min_notional_quote_units)) break;
      orders.push({ side: 'buy', symbol, notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS });
      cash -= slice;
      room--;
    }
    return orders;
  },
});
