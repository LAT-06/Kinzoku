import { describe, expect, it } from 'vitest';
import type { UTCTimestamp } from 'lightweight-charts';

import type { MarketCandle } from './binanceFutures';
import {
  calculateAtr,
  calculateBollingerBands,
  calculateEma,
  calculateLiquiditySweeps,
  calculateMacd,
  calculateRsi,
  calculateVolumeHistogram,
} from './indicators';

function candlesFromCloses(closes: number[]): MarketCandle[] {
  return closes.map((close, index) => ({
    time: (index + 1) as UTCTimestamp,
    open: index === 0 ? close : closes[index - 1],
    high: Math.max(close, index === 0 ? close : closes[index - 1]),
    low: Math.min(close, index === 0 ? close : closes[index - 1]),
    close,
    volume: index + 10,
  }));
}

describe('technical indicators', () => {
  it('calculates EMA from an SMA seed', () => {
    const ema = calculateEma(candlesFromCloses([1, 2, 3, 4, 5]), 3);

    expect(ema).toEqual([
      { time: 3, value: 2 },
      { time: 4, value: 3 },
      { time: 5, value: 4 },
    ]);
  });

  it('calculates Bollinger Bands with middle, upper, and lower lines', () => {
    const bands = calculateBollingerBands(candlesFromCloses([1, 2, 3]), 3, 2);

    expect(bands.middle).toEqual([{ time: 3, value: 2 }]);
    expect(bands.upper[0]?.value).toBeCloseTo(3.633, 3);
    expect(bands.lower[0]?.value).toBeCloseTo(0.367, 3);
  });

  it('returns high RSI for consistently rising closes and low RSI for falling closes', () => {
    expect(calculateRsi(candlesFromCloses([1, 2, 3, 4, 5, 6]), 5)).toEqual([
      { time: 6, value: 100 },
    ]);

    expect(calculateRsi(candlesFromCloses([6, 5, 4, 3, 2, 1]), 5)).toEqual([
      { time: 6, value: 0 },
    ]);
  });

  it('calculates MACD line, signal line, and histogram with aligned timestamps', () => {
    const macd = calculateMacd(candlesFromCloses([1, 2, 3, 4, 8, 16, 32]), 3, 5, 2);

    expect(macd.line.map((point) => point.time)).toEqual([5, 6, 7]);
    expect(macd.signal.map((point) => point.time)).toEqual([6, 7]);
    expect(macd.histogram.map((point) => point.time)).toEqual([6, 7]);
    expect(macd.histogram[0]?.value).toBeCloseTo(0.5583, 4);
  });

  it('colors volume bars by candle direction', () => {
    const volume = calculateVolumeHistogram([
      { time: 1 as UTCTimestamp, open: 10, high: 12, low: 9, close: 11, volume: 100 },
      { time: 2 as UTCTimestamp, open: 11, high: 12, low: 9, close: 10, volume: 120 },
    ]);

    expect(volume).toEqual([
      { time: 1, value: 100, color: '#16a085' },
      { time: 2, value: 120, color: '#e85d64' },
    ]);
  });

  it('calculates ATR with Wilder smoothing', () => {
    const atr = calculateAtr(
      [
        { time: 1 as UTCTimestamp, open: 10, high: 12, low: 9, close: 11, volume: 100 },
        { time: 2 as UTCTimestamp, open: 11, high: 13, low: 10, close: 12, volume: 100 },
        { time: 3 as UTCTimestamp, open: 12, high: 15, low: 11, close: 14, volume: 100 },
        { time: 4 as UTCTimestamp, open: 14, high: 16, low: 13, close: 15, volume: 100 },
      ],
      3,
    );

    expect(atr[2]).toBeCloseTo(10 / 3, 6);
    expect(atr[3]).toBeCloseTo(29 / 9, 6);
  });

  it('marks bearish liquidity sweeps above confirmed swing highs', () => {
    const markers = calculateLiquiditySweeps(
      [
        { time: 1 as UTCTimestamp, open: 9, high: 10, low: 8, close: 9, volume: 100 },
        { time: 2 as UTCTimestamp, open: 9, high: 15, low: 8, close: 14, volume: 100 },
        { time: 3 as UTCTimestamp, open: 14, high: 12, low: 9, close: 10, volume: 100 },
        { time: 4 as UTCTimestamp, open: 10, high: 11, low: 9, close: 10, volume: 100 },
        { time: 5 as UTCTimestamp, open: 10, high: 16, low: 9, close: 14, volume: 100 },
      ],
      { leftBars: 1, rightBars: 1, atrLength: 3, atrMultiplier: 0 },
    );

    expect(markers).toEqual([
      {
        id: 'bearish-liquidity-sweep-5',
        time: 5,
        position: 'aboveBar',
        shape: 'arrowDown',
        color: '#e85d64',
        text: 'BSL',
      },
    ]);
  });

  it('marks bullish liquidity sweeps below confirmed swing lows', () => {
    const markers = calculateLiquiditySweeps(
      [
        { time: 1 as UTCTimestamp, open: 11, high: 13, low: 10, close: 12, volume: 100 },
        { time: 2 as UTCTimestamp, open: 12, high: 13, low: 5, close: 6, volume: 100 },
        { time: 3 as UTCTimestamp, open: 6, high: 11, low: 8, close: 10, volume: 100 },
        { time: 4 as UTCTimestamp, open: 10, high: 11, low: 9, close: 10, volume: 100 },
        { time: 5 as UTCTimestamp, open: 10, high: 11, low: 4, close: 6, volume: 100 },
      ],
      { leftBars: 1, rightBars: 1, atrLength: 3, atrMultiplier: 0 },
    );

    expect(markers).toEqual([
      {
        id: 'bullish-liquidity-sweep-5',
        time: 5,
        position: 'belowBar',
        shape: 'arrowUp',
        color: '#16a085',
        text: 'SSL',
      },
    ]);
  });
});
