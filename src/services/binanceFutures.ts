import type { CandlestickData, UTCTimestamp } from 'lightweight-charts';

const FUTURES_REST_BASE_URL = 'https://fapi.binance.com';
const FUTURES_WS_BASE_URL = 'wss://fstream.binance.com/market/ws';

export const MARKET_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XAUUSDT'] as const;
export type MarketSymbol = (typeof MARKET_SYMBOLS)[number];

export const KLINE_INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;
export type KlineInterval = (typeof KLINE_INTERVALS)[number];

export type StreamStatus = 'connecting' | 'open' | 'closed' | 'reconnecting' | 'error';

export interface MarketCandle extends CandlestickData {
  time: UTCTimestamp;
  volume: number;
}

export type BinanceFuturesKline = [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  string,
  number,
  string,
  string,
  string,
];

export interface BinanceFuturesKlineWsMessage {
  e: 'kline';
  E: number;
  s: string;
  k: {
    t: number;
    T: number;
    s: string;
    i: string;
    f: number;
    L: number;
    o: string;
    c: string;
    h: string;
    l: string;
    v: string;
    n: number;
    x: boolean;
    q: string;
    V: string;
    Q: string;
    B: string;
  };
}

export function buildFuturesKlinesUrl(
  symbol: MarketSymbol,
  interval: KlineInterval,
  limit = 500,
): string {
  const params = new URLSearchParams({
    symbol,
    interval,
    limit: String(limit),
  });

  return `${FUTURES_REST_BASE_URL}/fapi/v1/klines?${params.toString()}`;
}

export function buildFuturesKlineStreamUrl(symbol: MarketSymbol, interval: KlineInterval): string {
  return `${FUTURES_WS_BASE_URL}/${symbol.toLowerCase()}@kline_${interval}`;
}

export function mapFuturesKline(kline: BinanceFuturesKline): MarketCandle {
  return {
    time: (kline[0] / 1000) as UTCTimestamp,
    open: Number(kline[1]),
    high: Number(kline[2]),
    low: Number(kline[3]),
    close: Number(kline[4]),
    volume: Number(kline[5]),
  };
}

export function mapFuturesWsMessageToCandle(message: BinanceFuturesKlineWsMessage): MarketCandle {
  const { k } = message;

  return {
    time: (k.t / 1000) as UTCTimestamp,
    open: Number(k.o),
    high: Number(k.h),
    low: Number(k.l),
    close: Number(k.c),
    volume: Number(k.v),
  };
}

export async function fetchFuturesKlines(
  symbol: MarketSymbol,
  interval: KlineInterval,
  limit = 500,
): Promise<MarketCandle[]> {
  const response = await fetch(buildFuturesKlinesUrl(symbol, interval, limit));

  if (!response.ok) {
    throw new Error(`Binance Futures returned ${response.status}`);
  }

  const klines = (await response.json()) as BinanceFuturesKline[];
  return klines.map(mapFuturesKline);
}

export function connectFuturesKlineStream(
  symbol: MarketSymbol,
  interval: KlineInterval,
  onCandle: (candle: MarketCandle) => void,
  onStatus: (status: StreamStatus) => void,
): () => void {
  let ws: WebSocket | null = null;
  let reconnectTimer: number | undefined;
  let closedByClient = false;

  const connect = () => {
    onStatus('connecting');
    ws = new WebSocket(buildFuturesKlineStreamUrl(symbol, interval));

    ws.addEventListener('open', () => {
      onStatus('open');
    });

    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data as string) as BinanceFuturesKlineWsMessage;
      onCandle(mapFuturesWsMessageToCandle(message));
    });

    ws.addEventListener('close', () => {
      if (closedByClient) {
        onStatus('closed');
        return;
      }

      onStatus('reconnecting');
      reconnectTimer = window.setTimeout(connect, 1000);
    });

    ws.addEventListener('error', () => {
      onStatus('error');
    });
  };

  connect();

  return () => {
    closedByClient = true;

    if (reconnectTimer !== undefined) {
      window.clearTimeout(reconnectTimer);
    }

    ws?.close();
  };
}
