import { describe, expect, it } from 'vitest';

import {
  buildFuturesKlinesUrl,
  buildFuturesKlineStreamUrl,
  type BinanceFuturesKline,
  type BinanceFuturesKlineWsMessage,
  mapFuturesKline,
  mapFuturesWsMessageToCandle,
} from './binanceFutures';

describe('binance futures market data', () => {
  it('builds futures REST kline URLs', () => {
    expect(buildFuturesKlinesUrl('XAUUSDT', '1h', 500)).toBe(
      'https://fapi.binance.com/fapi/v1/klines?symbol=XAUUSDT&interval=1h&limit=500',
    );
  });

  it('builds lowercase futures WebSocket stream URLs', () => {
    expect(buildFuturesKlineStreamUrl('BTCUSDT', '1m')).toBe(
      'wss://fstream.binance.com/market/ws/btcusdt@kline_1m',
    );
  });

  it('maps REST kline payloads to candlestick data', () => {
    const xauKline: BinanceFuturesKline = [
      1781538180000,
      '4359.99',
      '4361.60',
      '4359.47',
      '4361.19',
      '298.006',
      1781538239999,
      '1299487.60472',
      533,
      '157.264',
      '685735.67129',
      '0',
    ];

    expect(mapFuturesKline(xauKline)).toEqual({
      time: 1781538180,
      open: 4359.99,
      high: 4361.6,
      low: 4359.47,
      close: 4361.19,
    });
  });

  it('maps WebSocket kline messages to candlestick updates', () => {
    const message: BinanceFuturesKlineWsMessage = {
      e: 'kline',
      E: 1781538181000,
      s: 'BTCUSDT',
      k: {
        t: 1781538180000,
        T: 1781538239999,
        s: 'BTCUSDT',
        i: '1m',
        f: 100,
        L: 200,
        o: '66875.40',
        c: '66831.90',
        h: '66880.00',
        l: '66801.50',
        v: '160.817',
        n: 4262,
        x: false,
        q: '10748809.30030',
        V: '72.116',
        Q: '4819554.63760',
        B: '0',
      },
    };

    expect(mapFuturesWsMessageToCandle(message)).toEqual({
      time: 1781538180,
      open: 66875.4,
      high: 66880,
      low: 66801.5,
      close: 66831.9,
    });
  });
});
