import { describe, expect, it } from 'vitest';
import type { UTCTimestamp } from 'lightweight-charts';

import type { MarketCandle } from './binanceFutures';
import {
  buildAgentSignal,
  buildSignalCandidate,
  createManualSettlement,
  parseOllamaValidationContent,
  resolveSignalSettlement,
  validateSignalWithOllama,
} from './agentSignals';
import type { MarketNewsContext } from './newsContext';

const GENERATED_AT = new Date('2026-06-16T00:00:00.000Z');
const NEWS_CONTEXT: MarketNewsContext = {
  symbol: 'BTCUSDT',
  query: '(bitcoin OR BTC)',
  status: 'available',
  fetchedAt: '2026-06-16T00:00:00.000Z',
  articles: [
    {
      title: 'Bitcoin volatility rises before Fed decision',
      url: 'https://example.com/btc',
      domain: 'example.com',
      seenAt: '20260616T000000Z',
    },
  ],
};

function acceleratingCandles(direction: 'up' | 'down', count = 240): MarketCandle[] {
  const start = direction === 'up' ? 100 : 2_000;

  return Array.from({ length: count }, (_, index) => {
    const close =
      direction === 'up'
        ? start + index * 0.8 + index ** 2 * 0.012
        : start - index * 0.8 - index ** 2 * 0.012;
    const previousClose =
      index === 0
        ? close
        : direction === 'up'
          ? start + (index - 1) * 0.8 + (index - 1) ** 2 * 0.012
          : start - (index - 1) * 0.8 - (index - 1) ** 2 * 0.012;
    const open = previousClose;

    return {
      time: (index + 1) as UTCTimestamp,
      open,
      high: Math.max(open, close) + 2,
      low: Math.min(open, close) - 2,
      close,
      volume: 100 + index,
    };
  });
}

function flatCandles(count = 240): MarketCandle[] {
  return Array.from({ length: count }, (_, index) => ({
    time: (index + 1) as UTCTimestamp,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 100,
  }));
}

describe('agent signals', () => {
  it('builds LONG signals with ATR TP/SL levels', () => {
    const signal = buildSignalCandidate(acceleratingCandles('up'), 'BTCUSDT', '1m', GENERATED_AT);
    const stopDistance = signal.stopDistance ?? 0;

    expect(signal.direction).toBe('LONG');
    expect(signal.entry).toBeGreaterThan(0);
    expect(signal.atr).toBeGreaterThan(0);
    expect(signal.riskReward).toBe(2);
    expect(signal.stopLoss).toBeCloseTo(signal.entry - stopDistance, 6);
    expect(signal.takeProfit).toBeCloseTo(signal.entry + stopDistance * 2, 6);
    expect(signal.reasons).toContain('ema_trend:bullish');
    expect(signal.agentAnalyses.map((analysis) => analysis.id)).toEqual([
      'trend',
      'momentum',
      'liquidity',
      'risk',
    ]);
    expect(signal.consensus.longVotes).toBeGreaterThanOrEqual(3);
    expect(signal.agentAnalyses.find((analysis) => analysis.id === 'risk')?.takeProfit).toBeCloseTo(
      signal.takeProfit ?? 0,
      6,
    );
  });

  it('builds SHORT signals with ATR TP/SL levels', () => {
    const signal = buildSignalCandidate(acceleratingCandles('down'), 'ETHUSDT', '5m', GENERATED_AT);
    const stopDistance = signal.stopDistance ?? 0;

    expect(signal.direction).toBe('SHORT');
    expect(signal.entry).toBeGreaterThan(0);
    expect(signal.atr).toBeGreaterThan(0);
    expect(signal.riskReward).toBe(2);
    expect(signal.stopLoss).toBeCloseTo(signal.entry + stopDistance, 6);
    expect(signal.takeProfit).toBeCloseTo(signal.entry - stopDistance * 2, 6);
    expect(signal.reasons).toContain('ema_trend:bearish');
  });

  it('returns FLAT when indicators do not align', () => {
    const signal = buildSignalCandidate(flatCandles(), 'SOLUSDT', '15m', GENERATED_AT);

    expect(signal.direction).toBe('FLAT');
    expect(signal.takeProfit).toBeNull();
    expect(signal.stopLoss).toBeNull();
    expect(signal.reasons).toContain('not_enough_signal_alignment');
  });

  it('risk guard returns FLAT when there are not enough candles', () => {
    const signal = buildSignalCandidate(flatCandles(50), 'BNBUSDT', '1h', GENERATED_AT);

    expect(signal.direction).toBe('FLAT');
    expect(signal.confidence).toBe(0);
    expect(signal.reasons).toEqual(['insufficient_candles:50/220']);
  });

  it('parses strict Ollama validation JSON', () => {
    expect(
      parseOllamaValidationContent(
        '{"decision":"review","summary":"Momentum is mixed.","risk_notes":["paper only"]}',
      ),
    ).toEqual({
      decision: 'review',
      summary: 'Momentum is mixed.',
      riskNotes: ['paper only'],
      source: 'ollama',
    });
  });

  it('rejects malformed Ollama validation JSON', () => {
    expect(parseOllamaValidationContent('LONG because price is going up')).toBeUndefined();
    expect(parseOllamaValidationContent('{"decision":"buy","summary":"x","risk_notes":[]}')).toBeUndefined();
  });

  it('passes recent news context into Ollama validation', async () => {
    const candidate = buildSignalCandidate(acceleratingCandles('up'), 'BTCUSDT', '1m', GENERATED_AT);
    const validation = await validateSignalWithOllama(candidate, {
      newsContext: NEWS_CONTEXT,
      fetcher: async (_input, init) => {
        expect(String(init?.body)).toContain('Bitcoin volatility rises before Fed decision');

        return new Response(
          JSON.stringify({
            response: '{"decision":"review","summary":"News adds event risk.","risk_notes":["Fed headline risk"]}',
          }),
          { status: 200 },
        );
      },
    });

    expect(validation.newsContext).toBe(NEWS_CONTEXT);
    expect(validation.decision).toBe('review');
    expect(validation.riskNotes).toEqual(['Fed headline risk']);
  });

  it('settles a LONG signal when TP is touched', () => {
    const candidate = buildSignalCandidate(acceleratingCandles('up'), 'BTCUSDT', '1m', GENERATED_AT);
    const signal = buildAgentSignal(candidate, {
      decision: 'confirm',
      summary: 'confirmed',
      riskNotes: [],
      source: 'ollama',
    });
    const settlement = resolveSignalSettlement(signal, {
      time: 300 as UTCTimestamp,
      open: signal.entry,
      high: signal.takeProfit ?? signal.entry,
      low: signal.entry,
      close: signal.takeProfit ?? signal.entry,
      volume: 100,
    });

    expect(settlement?.outcome).toBe('take_profit');
    expect(settlement?.price).toBe(signal.takeProfit);
  });

  it('settles a SHORT signal when SL is touched', () => {
    const candidate = buildSignalCandidate(acceleratingCandles('down'), 'ETHUSDT', '5m', GENERATED_AT);
    const signal = buildAgentSignal(candidate, {
      decision: 'confirm',
      summary: 'confirmed',
      riskNotes: [],
      source: 'ollama',
    });
    const settlement = resolveSignalSettlement(signal, {
      time: 300 as UTCTimestamp,
      open: signal.entry,
      high: signal.stopLoss ?? signal.entry,
      low: signal.entry,
      close: signal.stopLoss ?? signal.entry,
      volume: 100,
    });

    expect(settlement?.outcome).toBe('stop_loss');
    expect(settlement?.price).toBe(signal.stopLoss);
  });

  it('settles SL first when one candle touches both levels', () => {
    const candidate = buildSignalCandidate(acceleratingCandles('up'), 'BTCUSDT', '1m', GENERATED_AT);
    const signal = buildAgentSignal(candidate, {
      decision: 'confirm',
      summary: 'confirmed',
      riskNotes: [],
      source: 'ollama',
    });
    const settlement = resolveSignalSettlement(signal, {
      time: 300 as UTCTimestamp,
      open: signal.entry,
      high: signal.takeProfit ?? signal.entry,
      low: signal.stopLoss ?? signal.entry,
      close: signal.entry,
      volume: 100,
    });

    expect(settlement?.outcome).toBe('stop_loss');
    expect(settlement?.price).toBe(signal.stopLoss);
  });

  it('creates manual close settlements for active paper signals', () => {
    const candidate = buildSignalCandidate(acceleratingCandles('up'), 'BTCUSDT', '1m', GENERATED_AT);
    const signal = buildAgentSignal(candidate, {
      decision: 'confirm',
      summary: 'confirmed',
      riskNotes: [],
      source: 'ollama',
    });
    const settlement = createManualSettlement(signal, new Date('2026-06-16T01:00:00.000Z'));

    expect(settlement).toEqual({
      symbol: 'BTCUSDT',
      interval: '1m',
      direction: 'LONG',
      outcome: 'manual_close',
      price: signal.entry,
      candleTime: 1781571600,
      settledAt: '2026-06-16T01:00:00.000Z',
    });
  });
});
