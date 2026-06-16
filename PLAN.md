# Kinzoku V2: Chart Indicators + Toggle Panel

## Summary
Add a full technical indicator set to the existing Binance USD-M Futures chart. The chart keeps candlesticks as the main pane, overlays trend indicators on price, and shows Volume/RSI/MACD as stacked panes below. A single `Indicators` checkbox panel controls hide/show for each indicator.

## Key Changes
- Add indicator data support:
  - Extend futures candle mapping to keep `volume` from REST/WebSocket payloads.
  - Store current candle history in `FuturesChart` so every realtime update can refresh indicator series.
- Add full technical indicator set:
  - Price overlays: `EMA 20`, `EMA 50`, `EMA 200`, `Bollinger Bands 20/2`.
  - Lower panes: `Volume`, `RSI 14`, `MACD 12/26/9`.
  - Default: all enabled, because user selected full technical mode.
- Add `Indicators` UI:
  - Checkbox group in the existing chart controls area.
  - Each checkbox toggles one indicator independently.
  - Pane order when enabled: Volume, RSI, MACD.
- Keep implementation local and simple:
  - No new charting/TA dependency.
  - Add a small `src/services/indicators.ts` module with tested calculation helpers.
  - Use Lightweight Charts `LineSeries` and `HistogramSeries`; use pane indexes for lower indicators.

## Interfaces
- Add `MarketCandle` type with `time`, `open`, `high`, `low`, `close`, `volume`.
- Add `IndicatorId` union:
  - `ema20 | ema50 | ema200 | bollinger | volume | rsi | macd`
- Add `IndicatorVisibility = Record<IndicatorId, boolean>`.
- `App.vue` owns `enabledIndicators` and passes it to `FuturesChart`.
- `FuturesChart` syncs enabled indicators after history load, symbol/interval change, and realtime candle update.

## Calculation Rules
- EMA uses multiplier `2 / (period + 1)` and starts after an SMA seed for the first full period.
- Bollinger Bands use 20-period rolling SMA with upper/lower bands at `mean +/- 2 * standardDeviation`.
- RSI uses Wilder smoothing with period 14; values before enough data are omitted.
- MACD uses EMA 12, EMA 26, signal EMA 9, and histogram `macd - signal`.
- Volume histogram bars are green when `close >= open`, red otherwise.

## Test Plan
- Extend existing Binance mapper tests to assert volume is preserved for REST and WebSocket candles.
- Add unit tests for:
  - EMA period seeding and output shape.
  - Bollinger upper/middle/lower values.
  - RSI rising/falling sample behavior.
  - MACD line/signal/histogram alignment.
  - Volume histogram color selection.
- Run:
  - `pnpm run test:unit`
  - `pnpm run type-check`
  - `pnpm run build`
- Manual check:
  - Toggle each indicator on/off.
  - Switch BTC/ETH/XAU and intervals.
  - Confirm realtime candle updates also update enabled indicators.
  - Confirm stacked panes disappear when their indicator is disabled.

## Assumptions
- Toggle state does not persist after refresh in this version.
- Indicator formulas are for chart visualization only, not trading signals or financial advice.
- Existing futures data source, symbol list, interval list, and read-only scope stay unchanged.
