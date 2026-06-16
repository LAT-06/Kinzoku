import type { HistogramData, LineData, SeriesMarker, UTCTimestamp } from 'lightweight-charts';

import type { MarketCandle } from './binanceFutures';

const UP_COLOR = '#16a085';
const DOWN_COLOR = '#e85d64';

export const INDICATOR_OPTIONS = [
  { id: 'ema20', label: 'EMA 20' },
  { id: 'ema50', label: 'EMA 50' },
  { id: 'ema200', label: 'EMA 200' },
  { id: 'bollinger', label: 'Bollinger 20/2' },
  { id: 'liquiditySweep', label: 'Liquidity Sweep' },
  { id: 'volume', label: 'Volume' },
  { id: 'rsi', label: 'RSI 14' },
  { id: 'macd', label: 'MACD 12/26/9' },
] as const;

export type IndicatorId = (typeof INDICATOR_OPTIONS)[number]['id'];
export type IndicatorVisibility = Record<IndicatorId, boolean>;

export const DEFAULT_INDICATOR_VISIBILITY: IndicatorVisibility = {
  ema20: true,
  ema50: true,
  ema200: true,
  bollinger: true,
  liquiditySweep: true,
  volume: true,
  rsi: true,
  macd: true,
};

interface ValuePoint {
  time: UTCTimestamp;
  value: number;
}

type IndicatorLineData = LineData<UTCTimestamp>;
type IndicatorHistogramData = HistogramData<UTCTimestamp>;
type LiquiditySweepMarker = SeriesMarker<UTCTimestamp>;

export interface BollingerBands {
  middle: IndicatorLineData[];
  upper: IndicatorLineData[];
  lower: IndicatorLineData[];
}

export interface MacdData {
  line: IndicatorLineData[];
  signal: IndicatorLineData[];
  histogram: IndicatorHistogramData[];
}

export interface LiquiditySweepOptions {
  leftBars?: number;
  rightBars?: number;
  atrLength?: number;
  atrMultiplier?: number;
}

export function calculateEma(candles: MarketCandle[], period: number): IndicatorLineData[] {
  return calculateEmaFromPoints(
    candles.map((candle) => ({ time: candle.time, value: candle.close })),
    period,
  );
}

export function calculateBollingerBands(
  candles: MarketCandle[],
  period = 20,
  multiplier = 2,
): BollingerBands {
  const middle: IndicatorLineData[] = [];
  const upper: IndicatorLineData[] = [];
  const lower: IndicatorLineData[] = [];

  if (candles.length < period) {
    return { middle, upper, lower };
  }

  for (let index = period - 1; index < candles.length; index += 1) {
    const window = candles.slice(index - period + 1, index + 1);
    const mean = average(window.map((candle) => candle.close));
    const variance = average(window.map((candle) => (candle.close - mean) ** 2));
    const deviation = Math.sqrt(variance);
    const time = candles[index].time;

    middle.push({ time, value: mean });
    upper.push({ time, value: mean + multiplier * deviation });
    lower.push({ time, value: mean - multiplier * deviation });
  }

  return { middle, upper, lower };
}

export function calculateRsi(candles: MarketCandle[], period = 14): IndicatorLineData[] {
  if (candles.length <= period) {
    return [];
  }

  const rsi: IndicatorLineData[] = [];
  let gainTotal = 0;
  let lossTotal = 0;

  for (let index = 1; index <= period; index += 1) {
    const change = candles[index].close - candles[index - 1].close;
    gainTotal += Math.max(change, 0);
    lossTotal += Math.max(-change, 0);
  }

  let averageGain = gainTotal / period;
  let averageLoss = lossTotal / period;

  rsi.push({
    time: candles[period].time,
    value: rsiFromAverages(averageGain, averageLoss),
  });

  for (let index = period + 1; index < candles.length; index += 1) {
    const change = candles[index].close - candles[index - 1].close;
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);

    averageGain = (averageGain * (period - 1) + gain) / period;
    averageLoss = (averageLoss * (period - 1) + loss) / period;

    rsi.push({
      time: candles[index].time,
      value: rsiFromAverages(averageGain, averageLoss),
    });
  }

  return rsi;
}

export function calculateMacd(
  candles: MarketCandle[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): MacdData {
  const fastEma = calculateEma(candles, fastPeriod);
  const slowEma = calculateEma(candles, slowPeriod);
  const fastByTime = new Map(fastEma.map((point) => [point.time, point.value]));

  const line: IndicatorLineData[] = slowEma.flatMap((slowPoint) => {
    const fastValue = fastByTime.get(slowPoint.time);
    return fastValue === undefined ? [] : [{ time: slowPoint.time, value: fastValue - slowPoint.value }];
  });

  const signal = calculateEmaFromPoints(line, signalPeriod);
  const lineByTime = new Map(line.map((point) => [point.time, point.value]));
  const histogram = signal.flatMap((signalPoint): IndicatorHistogramData[] => {
    const lineValue = lineByTime.get(signalPoint.time);

    if (lineValue === undefined) {
      return [];
    }

    const value = lineValue - signalPoint.value;

    return [
      {
        time: signalPoint.time,
        value,
        color: value >= 0 ? UP_COLOR : DOWN_COLOR,
      },
    ];
  });

  return { line, signal, histogram };
}

export function calculateVolumeHistogram(candles: MarketCandle[]): IndicatorHistogramData[] {
  return candles.map((candle) => ({
    time: candle.time,
    value: candle.volume,
    color: candle.close >= candle.open ? UP_COLOR : DOWN_COLOR,
  }));
}

export function calculateLiquiditySweeps(
  candles: MarketCandle[],
  options: LiquiditySweepOptions = {},
): LiquiditySweepMarker[] {
  const leftBars = options.leftBars ?? 3;
  const rightBars = options.rightBars ?? 3;
  const atrLength = options.atrLength ?? 14;
  const atrMultiplier = options.atrMultiplier ?? 0.05;
  const markers: LiquiditySweepMarker[] = [];
  const atr = calculateAtr(candles, atrLength);
  let lastSwingHigh: number | undefined;
  let lastSwingLow: number | undefined;

  for (let index = 0; index < candles.length; index += 1) {
    const pivotIndex = index - rightBars;

    if (pivotIndex >= leftBars) {
      if (isSwingHigh(candles, pivotIndex, leftBars, rightBars)) {
        lastSwingHigh = candles[pivotIndex].high;
      }

      if (isSwingLow(candles, pivotIndex, leftBars, rightBars)) {
        lastSwingLow = candles[pivotIndex].low;
      }
    }

    const candle = candles[index];
    const buffer = (atr[index] ?? 0) * atrMultiplier;

    if (lastSwingHigh !== undefined && candle.high > lastSwingHigh + buffer && candle.close < lastSwingHigh) {
      markers.push({
        id: `bearish-liquidity-sweep-${candle.time}`,
        time: candle.time,
        position: 'aboveBar',
        shape: 'arrowDown',
        color: DOWN_COLOR,
        text: 'BSL',
      });
    }

    if (lastSwingLow !== undefined && candle.low < lastSwingLow - buffer && candle.close > lastSwingLow) {
      markers.push({
        id: `bullish-liquidity-sweep-${candle.time}`,
        time: candle.time,
        position: 'belowBar',
        shape: 'arrowUp',
        color: UP_COLOR,
        text: 'SSL',
      });
    }
  }

  return markers;
}

function calculateEmaFromPoints(points: ValuePoint[], period: number): IndicatorLineData[] {
  if (points.length < period) {
    return [];
  }

  const multiplier = 2 / (period + 1);
  let previousEma = average(points.slice(0, period).map((point) => point.value));
  const ema: IndicatorLineData[] = [{ time: points[period - 1].time, value: previousEma }];

  for (let index = period; index < points.length; index += 1) {
    previousEma = (points[index].value - previousEma) * multiplier + previousEma;
    ema.push({ time: points[index].time, value: previousEma });
  }

  return ema;
}

function rsiFromAverages(averageGain: number, averageLoss: number): number {
  if (averageLoss === 0 && averageGain === 0) {
    return 50;
  }

  if (averageLoss === 0) {
    return 100;
  }

  if (averageGain === 0) {
    return 0;
  }

  const relativeStrength = averageGain / averageLoss;
  return 100 - 100 / (1 + relativeStrength);
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function calculateAtr(candles: MarketCandle[], period: number): number[] {
  const trueRanges = candles.map((candle, index) => {
    if (index === 0) {
      return candle.high - candle.low;
    }

    const previousClose = candles[index - 1].close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    );
  });

  const atr: number[] = [];

  if (trueRanges.length < period) {
    return atr;
  }

  atr[period - 1] = average(trueRanges.slice(0, period));

  for (let index = period; index < trueRanges.length; index += 1) {
    atr[index] = (atr[index - 1] * (period - 1) + trueRanges[index]) / period;
  }

  return atr;
}

function isSwingHigh(
  candles: MarketCandle[],
  pivotIndex: number,
  leftBars: number,
  rightBars: number,
): boolean {
  const pivotHigh = candles[pivotIndex].high;

  for (let index = pivotIndex - leftBars; index <= pivotIndex + rightBars; index += 1) {
    if (index !== pivotIndex && candles[index].high >= pivotHigh) {
      return false;
    }
  }

  return true;
}

function isSwingLow(
  candles: MarketCandle[],
  pivotIndex: number,
  leftBars: number,
  rightBars: number,
): boolean {
  const pivotLow = candles[pivotIndex].low;

  for (let index = pivotIndex - leftBars; index <= pivotIndex + rightBars; index += 1) {
    if (index !== pivotIndex && candles[index].low <= pivotLow) {
      return false;
    }
  }

  return true;
}
