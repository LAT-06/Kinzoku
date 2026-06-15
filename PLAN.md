# Kinzoku V1: Futures Realtime Chart Dashboard

## Summary
Build a frontend-only Vue 3 + TypeScript app using `pnpm`, `Vite`, and `lightweight-charts`. Data source switches from Binance Spot to Binance USD-M Futures.

Verified on June 15, 2026: Binance Futures `XAUUSDT` returns valid kline data via `GET /fapi/v1/klines`, so V1 can include `XAUUSDT` alongside crypto futures without a separate forex provider.

## Key Changes
- Use Binance USD-M Futures public market data:
  - REST history: `https://fapi.binance.com/fapi/v1/klines`
  - Realtime stream: `wss://fstream.binance.com/market/ws/<symbol>@kline_<interval>`
- Add chart controls:
  - Symbols: `BTCUSDT`, `ETHUSDT`, `BNBUSDT`, `SOLUSDT`, `XAUUSDT`
  - Intervals: `1m`, `5m`, `15m`, `1h`, `4h`, `1d`
- Scaffold manually in existing repo to avoid overwriting `AGENTS.md`, `.env`, `.agents`, and `PLAN.md`.
- Install `pnpm` first because local machine currently has no `pnpm` or `corepack`.
  - Implementation command: `npm install -g pnpm`
  - Then use `pnpm install`, `pnpm dev`, `pnpm build`, `pnpm test:unit`.

## Interfaces
- `src/services/binanceFutures.ts`
  - `fetchFuturesKlines(symbol, interval, limit = 500)`
  - `connectFuturesKlineStream(symbol, interval, onCandle, onStatus)`
  - Maps Binance millisecond timestamps to Lightweight Charts second timestamps.
- Types:
  - `MarketSymbol = 'BTCUSDT' | 'ETHUSDT' | 'BNBUSDT' | 'SOLUSDT' | 'XAUUSDT'`
  - `KlineInterval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d'`
  - `BinanceFuturesKline`, `BinanceFuturesKlineWsMessage`

## Test Plan
- Unit test futures kline mapper with BTC and XAU sample payloads.
- Unit test REST/WebSocket URL builders for lowercase stream names.
- Run:
  - `pnpm run type-check`
  - `pnpm run test:unit`
  - `pnpm run build`
- Manual check:
  - Start dev server with `pnpm dev -- --host 127.0.0.1`
  - Switch BTC/ETH/XAU and verify chart reloads history.
  - Switch intervals and verify WebSocket reconnects cleanly.
  - Confirm no console errors and realtime candle updates.

## Assumptions
- V1 is read-only market data, not trading.
- No Binance API key is needed because only public futures market endpoints are used.
- `XAUUSDT` means Binance USD-M Futures `XAUUSDT`, not spot and not a separate forex broker symbol.
