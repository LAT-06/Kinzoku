import type { KlineInterval, MarketCandle, MarketSymbol } from './binanceFutures';
import {
  calculateAtr,
  calculateBollingerBands,
  calculateEma,
  calculateLiquiditySweeps,
  calculateMacd,
  calculateRsi,
} from './indicators';
import type { MarketNewsContext } from './newsContext';

const ATR_PERIOD = 14;
const ATR_STOP_MULTIPLIER = 1.5;
const RISK_REWARD = 2;
const MIN_SIGNAL_CANDLES = 220;
const LIQUIDITY_LOOKBACK = 8;
const DEFAULT_OLLAMA_BASE_URL = '/api/ollama';
const DEFAULT_OLLAMA_MODEL = 'qwen2.5:7b';
const OLLAMA_TIMEOUT_MS = 8_000;
const OLLAMA_FAILURE_BACKOFF_MS = 5 * 60 * 1000;

let ollamaBackoffUntil = 0;

export type SignalDirection = 'LONG' | 'SHORT' | 'FLAT';
export type AgentValidationDecision = 'confirm' | 'review' | 'veto';
export type AgentSignalStatus = 'llm_validated' | 'llm_review' | 'llm_veto' | 'rule_fallback';
export type PaperTradeOutcome = 'take_profit' | 'stop_loss' | 'manual_close';
export type SignalAnalysisAgentId = 'trend' | 'momentum' | 'liquidity' | 'risk';

export interface SignalAgentAnalysis {
  id: SignalAnalysisAgentId;
  label: string;
  vote: SignalDirection;
  confidence: number;
  entry: number;
  takeProfit: number | null;
  stopLoss: number | null;
  riskReward: number | null;
  reasons: string[];
}

export interface SignalConsensus {
  decision: SignalDirection;
  longVotes: number;
  shortVotes: number;
  flatVotes: number;
  requiredVotes: number;
  reasons: string[];
}

export interface SignalCandidate {
  symbol: MarketSymbol;
  interval: KlineInterval;
  direction: SignalDirection;
  entry: number;
  takeProfit: number | null;
  stopLoss: number | null;
  riskReward: number | null;
  confidence: number;
  reasons: string[];
  agentAnalyses: SignalAgentAnalysis[];
  consensus: SignalConsensus;
  atr: number | null;
  stopDistance: number | null;
  updatedAt: string;
}

export interface AgentValidation {
  decision: AgentValidationDecision;
  summary: string;
  riskNotes: string[];
  source: 'ollama' | 'fallback';
  newsContext?: MarketNewsContext;
  error?: string;
}

export interface AgentSignal extends SignalCandidate {
  validation: AgentValidation;
  status: AgentSignalStatus;
}

export interface PaperTradeSettlement {
  symbol: MarketSymbol;
  interval: KlineInterval;
  direction: Exclude<SignalDirection, 'FLAT'>;
  outcome: PaperTradeOutcome;
  price: number;
  candleTime: MarketCandle['time'];
  settledAt: string;
}

export interface OllamaValidationOptions {
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
  newsContext?: MarketNewsContext;
}

type VoteDirection = Exclude<SignalDirection, 'FLAT'>;

interface IndicatorVote {
  name: string;
  direction: VoteDirection | 'NEUTRAL';
  reason: string;
}

export function buildSignalCandidate(
  candles: MarketCandle[],
  symbol: MarketSymbol,
  interval: KlineInterval,
  generatedAt = new Date(),
): SignalCandidate {
  const latestCandle = candles.at(-1);
  const entry = latestCandle?.close ?? 0;
  const baseCandidate: SignalCandidate = {
    symbol,
    interval,
    direction: 'FLAT',
    entry,
    takeProfit: null,
    stopLoss: null,
    riskReward: null,
    confidence: 0,
    reasons: [],
    agentAnalyses: [],
    consensus: flatConsensus(['signal_not_evaluated']),
    atr: null,
    stopDistance: null,
    updatedAt: generatedAt.toISOString(),
  };

  if (!latestCandle || candles.length < MIN_SIGNAL_CANDLES) {
    return {
      ...baseCandidate,
      consensus: flatConsensus([`insufficient_candles:${candles.length}/${MIN_SIGNAL_CANDLES}`]),
      reasons: [`insufficient_candles:${candles.length}/${MIN_SIGNAL_CANDLES}`],
    };
  }

  const snapshot = buildIndicatorSnapshot(candles);

  if (!snapshot) {
    return {
      ...baseCandidate,
      consensus: flatConsensus(['missing_indicator_data']),
      reasons: ['missing_indicator_data'],
    };
  }

  if (!Number.isFinite(snapshot.atr) || snapshot.atr <= 0 || !Number.isFinite(entry) || entry <= 0) {
    return {
      ...baseCandidate,
      consensus: flatConsensus(['risk_guard_invalid_price_or_atr']),
      reasons: ['risk_guard_invalid_price_or_atr'],
    };
  }

  const stopDistance = snapshot.atr * ATR_STOP_MULTIPLIER;
  const agentAnalyses = buildAgentAnalyses(candles, snapshot, entry, stopDistance);
  const consensus = buildConsensus(agentAnalyses);
  const reasons = agentAnalyses.flatMap((analysis) => analysis.reasons);
  const direction = consensus.decision;

  if (direction === 'FLAT') {
    return {
      ...baseCandidate,
      atr: snapshot.atr,
      stopDistance,
      confidence: 0.2,
      reasons: [...reasons, ...consensus.reasons],
      agentAnalyses,
      consensus,
    };
  }

  const alignedVotes = direction === 'LONG' ? consensus.longVotes : consensus.shortVotes;
  const confidence = confidenceFromVotes(alignedVotes);
  const tradeLevels = calculateTradeLevels(entry, direction, stopDistance);

  return {
    ...baseCandidate,
    direction,
    ...tradeLevels,
    riskReward: RISK_REWARD,
    confidence,
    reasons: [...reasons, ...consensus.reasons, `risk_reward:${RISK_REWARD}`],
    agentAnalyses,
    consensus,
    atr: snapshot.atr,
    stopDistance,
  };
}

export function createUnavailableSignal(
  symbol: MarketSymbol,
  interval: KlineInterval,
  reason: string,
  generatedAt = new Date(),
): AgentSignal {
  const candidate: SignalCandidate = {
    symbol,
    interval,
    direction: 'FLAT',
    entry: 0,
    takeProfit: null,
    stopLoss: null,
    riskReward: null,
    confidence: 0,
    reasons: [reason],
    agentAnalyses: [],
    consensus: flatConsensus([reason]),
    atr: null,
    stopDistance: null,
    updatedAt: generatedAt.toISOString(),
  };

  return buildAgentSignal(candidate, fallbackValidation('Market data unavailable.'));
}

export function calculateTradeLevels(
  entry: number,
  direction: Exclude<SignalDirection, 'FLAT'>,
  stopDistance: number,
): Pick<SignalCandidate, 'takeProfit' | 'stopLoss'> {
  if (direction === 'LONG') {
    return {
      stopLoss: entry - stopDistance,
      takeProfit: entry + stopDistance * RISK_REWARD,
    };
  }

  return {
    stopLoss: entry + stopDistance,
    takeProfit: entry - stopDistance * RISK_REWARD,
  };
}

export async function validateSignalWithOllama(
  candidate: SignalCandidate,
  options: OllamaValidationOptions = {},
): Promise<AgentValidation> {
  const fetcher = options.fetcher ?? fetch;
  const canUseBackoff = options.fetcher === undefined;

  if (canUseBackoff && Date.now() < ollamaBackoffUntil) {
    return withNewsContext(
      fallbackValidation('Ollama validation paused after a recent connection failure.'),
      options.newsContext,
    );
  }

  const baseUrl = (options.baseUrl ?? getEnvValue('VITE_OLLAMA_BASE_URL') ?? DEFAULT_OLLAMA_BASE_URL).replace(
    /\/$/,
    '',
  );
  const model = options.model ?? getEnvValue('VITE_OLLAMA_MODEL') ?? DEFAULT_OLLAMA_MODEL;
  const timeoutMs = options.timeoutMs ?? OLLAMA_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetcher(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: buildOllamaPrompt(candidate, options.newsContext),
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      if (canUseBackoff && response.status >= 500) {
        ollamaBackoffUntil = Date.now() + OLLAMA_FAILURE_BACKOFF_MS;
      }

      return withNewsContext(
        fallbackValidation(`Ollama returned HTTP ${response.status}.`),
        options.newsContext,
      );
    }

    const payload = (await response.json()) as { response?: unknown };
    const validation =
      typeof payload.response === 'string'
        ? parseOllamaValidationContent(payload.response)
        : undefined;

    return withNewsContext(
      validation ?? fallbackValidation('Ollama response was not valid signal JSON.'),
      options.newsContext,
    );
  } catch (error) {
    if (canUseBackoff) {
      ollamaBackoffUntil = Date.now() + OLLAMA_FAILURE_BACKOFF_MS;
    }

    return withNewsContext(
      fallbackValidation(error instanceof Error ? error.message : 'Ollama validation failed.'),
      options.newsContext,
    );
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export function parseOllamaValidationContent(content: string): AgentValidation | undefined {
  const parsed = parseJsonObject(stripJsonFence(content));

  if (!parsed) {
    return undefined;
  }

  const decision = parsed.decision;
  const summary = parsed.summary;
  const riskNotes = parsed.risk_notes ?? parsed.riskNotes;

  if (!isValidationDecision(decision) || typeof summary !== 'string') {
    return undefined;
  }

  if (!Array.isArray(riskNotes) || !riskNotes.every((note) => typeof note === 'string')) {
    return undefined;
  }

  return {
    decision,
    summary,
    riskNotes,
    source: 'ollama',
  };
}

export function buildAgentSignal(
  candidate: SignalCandidate,
  validation: AgentValidation,
): AgentSignal {
  return {
    ...candidate,
    validation,
    status: statusFromValidation(validation),
  };
}

export function resolveSignalSettlement(
  signal: AgentSignal,
  candle: MarketCandle,
  settledAt = new Date(),
): PaperTradeSettlement | undefined {
  if (signal.direction === 'FLAT' || signal.takeProfit === null || signal.stopLoss === null) {
    return undefined;
  }

  if (signal.direction === 'LONG') {
    if (candle.low <= signal.stopLoss) {
      return buildSettlement(signal, 'stop_loss', signal.stopLoss, candle, settledAt);
    }

    if (candle.high >= signal.takeProfit) {
      return buildSettlement(signal, 'take_profit', signal.takeProfit, candle, settledAt);
    }
  }

  if (signal.direction === 'SHORT') {
    if (candle.high >= signal.stopLoss) {
      return buildSettlement(signal, 'stop_loss', signal.stopLoss, candle, settledAt);
    }

    if (candle.low <= signal.takeProfit) {
      return buildSettlement(signal, 'take_profit', signal.takeProfit, candle, settledAt);
    }
  }

  return undefined;
}

export function createManualSettlement(
  signal: AgentSignal,
  settledAt = new Date(),
): PaperTradeSettlement | undefined {
  if (signal.direction === 'FLAT') {
    return undefined;
  }

  return {
    symbol: signal.symbol,
    interval: signal.interval,
    direction: signal.direction,
    outcome: 'manual_close',
    price: signal.entry,
    candleTime: Math.floor(settledAt.getTime() / 1000) as MarketCandle['time'],
    settledAt: settledAt.toISOString(),
  };
}

function buildIndicatorSnapshot(candles: MarketCandle[]) {
  const latest = candles.at(-1);
  const ema20 = calculateEma(candles, 20).at(-1)?.value;
  const ema50 = calculateEma(candles, 50).at(-1)?.value;
  const ema200 = calculateEma(candles, 200).at(-1)?.value;
  const rsi = calculateRsi(candles, 14).at(-1)?.value;
  const macd = calculateMacd(candles, 12, 26, 9);
  const macdLine = macd.line.at(-1)?.value;
  const macdSignal = macd.signal.at(-1)?.value;
  const macdHistogram = macd.histogram.at(-1)?.value;
  const bollinger = calculateBollingerBands(candles, 20, 2);
  const bollingerMiddle = bollinger.middle.at(-1)?.value;
  const atr = calculateAtr(candles, ATR_PERIOD).at(-1);

  if (
    !latest ||
    ema20 === undefined ||
    ema50 === undefined ||
    ema200 === undefined ||
    rsi === undefined ||
    macdLine === undefined ||
    macdSignal === undefined ||
    macdHistogram === undefined ||
    bollingerMiddle === undefined ||
    atr === undefined
  ) {
    return undefined;
  }

  return {
    latest,
    ema20,
    ema50,
    ema200,
    rsi,
    macdLine,
    macdSignal,
    macdHistogram,
    bollingerMiddle,
    liquidityMarkers: calculateLiquiditySweeps(candles),
    atr,
  };
}

function buildVotes(
  candles: MarketCandle[],
  snapshot: NonNullable<ReturnType<typeof buildIndicatorSnapshot>>,
): IndicatorVote[] {
  const votes: IndicatorVote[] = [];
  const close = snapshot.latest.close;
  const recentMarkers = snapshot.liquidityMarkers.filter((marker) => {
    const markerIndex = candles.findIndex((candle) => candle.time === marker.time);
    return markerIndex >= candles.length - LIQUIDITY_LOOKBACK;
  });
  const hasBullishSweep = recentMarkers.some((marker) => marker.text === 'SSL');
  const hasBearishSweep = recentMarkers.some((marker) => marker.text === 'BSL');

  if (snapshot.ema20 > snapshot.ema50 && snapshot.ema50 > snapshot.ema200 && close > snapshot.ema20) {
    votes.push({ name: 'ema_trend', direction: 'LONG', reason: 'ema_trend:bullish' });
  } else if (
    snapshot.ema20 < snapshot.ema50 &&
    snapshot.ema50 < snapshot.ema200 &&
    close < snapshot.ema20
  ) {
    votes.push({ name: 'ema_trend', direction: 'SHORT', reason: 'ema_trend:bearish' });
  } else {
    votes.push({ name: 'ema_trend', direction: 'NEUTRAL', reason: 'ema_trend:neutral' });
  }

  if (snapshot.rsi >= 55) {
    votes.push({ name: 'rsi', direction: 'LONG', reason: `rsi:bullish_${round(snapshot.rsi)}` });
  } else if (snapshot.rsi <= 45) {
    votes.push({ name: 'rsi', direction: 'SHORT', reason: `rsi:bearish_${round(snapshot.rsi)}` });
  } else {
    votes.push({ name: 'rsi', direction: 'NEUTRAL', reason: `rsi:neutral_${round(snapshot.rsi)}` });
  }

  if (snapshot.macdLine > snapshot.macdSignal && snapshot.macdHistogram > 0) {
    votes.push({ name: 'macd', direction: 'LONG', reason: 'macd:bullish' });
  } else if (snapshot.macdLine < snapshot.macdSignal && snapshot.macdHistogram < 0) {
    votes.push({ name: 'macd', direction: 'SHORT', reason: 'macd:bearish' });
  } else {
    votes.push({ name: 'macd', direction: 'NEUTRAL', reason: 'macd:neutral' });
  }

  if (close > snapshot.bollingerMiddle) {
    votes.push({ name: 'bollinger', direction: 'LONG', reason: 'bollinger:above_middle' });
  } else if (close < snapshot.bollingerMiddle) {
    votes.push({ name: 'bollinger', direction: 'SHORT', reason: 'bollinger:below_middle' });
  } else {
    votes.push({ name: 'bollinger', direction: 'NEUTRAL', reason: 'bollinger:at_middle' });
  }

  if (hasBullishSweep && !hasBearishSweep) {
    votes.push({ name: 'liquidity', direction: 'LONG', reason: 'liquidity:recent_ssl' });
  } else if (hasBearishSweep && !hasBullishSweep) {
    votes.push({ name: 'liquidity', direction: 'SHORT', reason: 'liquidity:recent_bsl' });
  } else {
    votes.push({ name: 'liquidity', direction: 'NEUTRAL', reason: 'liquidity:neutral' });
  }

  return votes;
}

function buildAgentAnalyses(
  candles: MarketCandle[],
  snapshot: NonNullable<ReturnType<typeof buildIndicatorSnapshot>>,
  entry: number,
  stopDistance: number,
): SignalAgentAnalysis[] {
  const votes = buildVotes(candles, snapshot);
  const voteByName = new Map(votes.map((vote) => [vote.name, vote]));
  const trendVote = voteByName.get('ema_trend');
  const momentumVotes = ['rsi', 'macd', 'bollinger']
    .map((name) => voteByName.get(name))
    .filter((vote): vote is IndicatorVote => vote !== undefined);
  const liquidityVote = voteByName.get('liquidity');

  const trend = createAgentAnalysis(
    'trend',
    'Trend Agent',
    trendVote?.direction === 'NEUTRAL' ? 'FLAT' : trendVote?.direction ?? 'FLAT',
    trendVote?.direction === 'NEUTRAL' ? 0.3 : 0.72,
    [trendVote?.reason ?? 'ema_trend:missing'],
    entry,
    stopDistance,
  );
  const momentumDirection = majorityDirection(momentumVotes);
  const momentum = createAgentAnalysis(
    'momentum',
    'Momentum Agent',
    momentumDirection,
    momentumDirection === 'FLAT' ? 0.35 : 0.68,
    momentumVotes.map((vote) => vote.reason),
    entry,
    stopDistance,
  );
  const liquidity = createAgentAnalysis(
    'liquidity',
    'Liquidity Agent',
    liquidityVote?.direction === 'NEUTRAL' ? 'FLAT' : liquidityVote?.direction ?? 'FLAT',
    liquidityVote?.direction === 'NEUTRAL' ? 0.25 : 0.58,
    [liquidityVote?.reason ?? 'liquidity:missing'],
    entry,
    stopDistance,
  );
  const provisionalDirection = majorityDirection([trend, momentum, liquidity]);
  const risk = createRiskAgentAnalysis(
    provisionalDirection,
    entry,
    snapshot.atr,
    stopDistance,
  );

  return [trend, momentum, liquidity, risk];
}

function createAgentAnalysis(
  id: SignalAnalysisAgentId,
  label: string,
  vote: SignalDirection,
  confidence: number,
  reasons: string[],
  entry: number,
  stopDistance: number,
): SignalAgentAnalysis {
  const levels = vote === 'FLAT' ? { takeProfit: null, stopLoss: null } : calculateTradeLevels(entry, vote, stopDistance);

  return {
    id,
    label,
    vote,
    confidence,
    entry,
    ...levels,
    riskReward: vote === 'FLAT' ? null : RISK_REWARD,
    reasons,
  };
}

function createRiskAgentAnalysis(
  provisionalDirection: SignalDirection,
  entry: number,
  atr: number,
  stopDistance: number,
): SignalAgentAnalysis {
  const stopPct = stopDistance / entry;

  if (provisionalDirection === 'FLAT') {
    return createAgentAnalysis(
      'risk',
      'Risk Agent',
      'FLAT',
      0.3,
      ['risk:waiting_for_agent_alignment'],
      entry,
      stopDistance,
    );
  }

  if (!Number.isFinite(atr) || atr <= 0 || !Number.isFinite(stopPct) || stopPct <= 0) {
    return createAgentAnalysis(
      'risk',
      'Risk Agent',
      'FLAT',
      0.1,
      ['risk:invalid_atr_or_stop'],
      entry,
      stopDistance,
    );
  }

  if (stopPct > 0.08) {
    return createAgentAnalysis(
      'risk',
      'Risk Agent',
      'FLAT',
      0.25,
      [`risk:stop_too_wide_${round(stopPct * 100, 2)}pct`],
      entry,
      stopDistance,
    );
  }

  return createAgentAnalysis(
    'risk',
    'Risk Agent',
    provisionalDirection,
    0.7,
    [`risk:atr_stop_${round(stopDistance, 4)}`, `risk:stop_pct_${round(stopPct * 100, 2)}pct`],
    entry,
    stopDistance,
  );
}

function buildConsensus(agentAnalyses: SignalAgentAnalysis[]): SignalConsensus {
  const longVotes = agentAnalyses.filter((analysis) => analysis.vote === 'LONG').length;
  const shortVotes = agentAnalyses.filter((analysis) => analysis.vote === 'SHORT').length;
  const flatVotes = agentAnalyses.filter((analysis) => analysis.vote === 'FLAT').length;
  const riskAgent = agentAnalyses.find((analysis) => analysis.id === 'risk');
  const requiredVotes = 3;

  if (riskAgent?.vote === 'FLAT') {
    return {
      decision: 'FLAT',
      longVotes,
      shortVotes,
      flatVotes,
      requiredVotes,
      reasons: ['not_enough_signal_alignment', 'consensus:risk_agent_blocked'],
    };
  }

  if (longVotes >= requiredVotes && longVotes >= shortVotes + 2) {
    return {
      decision: 'LONG',
      longVotes,
      shortVotes,
      flatVotes,
      requiredVotes,
      reasons: [`consensus:long_${longVotes}_of_${agentAnalyses.length}`],
    };
  }

  if (shortVotes >= requiredVotes && shortVotes >= longVotes + 2) {
    return {
      decision: 'SHORT',
      longVotes,
      shortVotes,
      flatVotes,
      requiredVotes,
      reasons: [`consensus:short_${shortVotes}_of_${agentAnalyses.length}`],
    };
  }

  return {
    decision: 'FLAT',
    longVotes,
    shortVotes,
    flatVotes,
    requiredVotes,
    reasons:
      longVotes > 0 && shortVotes > 0
        ? [`consensus:conflict_long_${longVotes}_short_${shortVotes}`]
        : ['not_enough_signal_alignment', 'consensus:not_enough_agent_alignment'],
  };
}

function flatConsensus(reasons: string[]): SignalConsensus {
  return {
    decision: 'FLAT',
    longVotes: 0,
    shortVotes: 0,
    flatVotes: 0,
    requiredVotes: 3,
    reasons,
  };
}

function majorityDirection(
  votes: Array<Partial<Pick<SignalAgentAnalysis, 'vote'>> & Partial<Pick<IndicatorVote, 'direction'>>>,
): SignalDirection {
  const directions = votes.map((vote) => vote.direction ?? vote.vote);
  const longVotes = directions.filter((direction) => direction === 'LONG').length;
  const shortVotes = directions.filter((direction) => direction === 'SHORT').length;

  if (longVotes >= 2 && longVotes > shortVotes) {
    return 'LONG';
  }

  if (shortVotes >= 2 && shortVotes > longVotes) {
    return 'SHORT';
  }

  return 'FLAT';
}

function confidenceFromVotes(alignedVotes: number): number {
  return Math.min(0.95, round(0.45 + alignedVotes * 0.1, 2));
}

function buildOllamaPrompt(candidate: SignalCandidate, newsContext?: MarketNewsContext): string {
  const newsPayload =
    newsContext?.status === 'available'
      ? {
          symbol: newsContext.symbol,
          fetchedAt: newsContext.fetchedAt,
          articles: newsContext.articles.map((article) => ({
            title: article.title,
            domain: article.domain,
            seenAt: article.seenAt,
          })),
        }
      : {
          symbol: candidate.symbol,
          status: 'unavailable',
          error: newsContext?.error ?? 'not_requested',
        };

  return [
    'You are a read-only trading signal validator for a paper-trading dashboard.',
    'Do not create new trades. Do not change direction, entry, takeProfit, stopLoss, or riskReward.',
    'Only validate the deterministic payload and downgrade to review or veto if technical or recent-news risk is weak.',
    'Use news headlines only as risk context. Never treat headlines as proof of a guaranteed price move.',
    'Return strict JSON only with this shape:',
    '{"decision":"confirm|review|veto","summary":"one concise sentence","risk_notes":["note"]}',
    `Signal payload: ${JSON.stringify(candidate)}`,
    `Recent news context: ${JSON.stringify(newsPayload)}`,
  ].join('\n');
}

function fallbackValidation(error: string): AgentValidation {
  return {
    decision: 'review',
    summary: 'Rule signal shown without LLM validation.',
    riskNotes: ['Local Ollama validation unavailable.', error],
    source: 'fallback',
    error,
  };
}

function withNewsContext(
  validation: AgentValidation,
  newsContext: MarketNewsContext | undefined,
): AgentValidation {
  if (!newsContext) {
    return validation;
  }

  return {
    ...validation,
    newsContext,
  };
}

function statusFromValidation(validation: AgentValidation): AgentSignalStatus {
  if (validation.source === 'fallback') {
    return 'rule_fallback';
  }

  if (validation.decision === 'veto') {
    return 'llm_veto';
  }

  if (validation.decision === 'review') {
    return 'llm_review';
  }

  return 'llm_validated';
}

function buildSettlement(
  signal: AgentSignal,
  outcome: PaperTradeOutcome,
  price: number,
  candle: MarketCandle,
  settledAt: Date,
): PaperTradeSettlement {
  return {
    symbol: signal.symbol,
    interval: signal.interval,
    direction: signal.direction as Exclude<SignalDirection, 'FLAT'>,
    outcome,
    price,
    candleTime: candle.time,
    settledAt: settledAt.toISOString(),
  };
}

function parseJsonObject(content: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(content) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function stripJsonFence(content: string): string {
  const trimmed = content.trim();

  if (!trimmed.startsWith('```')) {
    return trimmed;
  }

  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

function isValidationDecision(value: unknown): value is AgentValidationDecision {
  return value === 'confirm' || value === 'review' || value === 'veto';
}

function getEnvValue(key: 'VITE_OLLAMA_BASE_URL' | 'VITE_OLLAMA_MODEL'): string | undefined {
  const value = import.meta.env[key];
  return value ? String(value) : undefined;
}

function round(value: number, precision = 1): number {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}
