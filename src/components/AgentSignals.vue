<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import {
  fetchFuturesKlines,
  MARKET_SYMBOLS,
  type KlineInterval,
  type MarketSymbol,
} from '../services/binanceFutures';
import {
  buildAgentSignal,
  buildSignalCandidate,
  createUnavailableSignal,
  validateSignalWithOllama,
  type AgentSignal,
  type AgentSignalStatus,
  type PaperTradeSettlement,
} from '../services/agentSignals';
import { fetchMarketNewsContext } from '../services/newsContext';

const REFRESH_INTERVAL_MS = 60_000;
const SIGNAL_CANDLE_LIMIT = 250;

const props = defineProps<{
  selectedSymbol: MarketSymbol;
  interval: KlineInterval;
  activeSignal: AgentSignal | null;
  lastSettlement: PaperTradeSettlement | null;
}>();

const emit = defineEmits<{
  selectSymbol: [symbol: MarketSymbol];
  acceptSignal: [signal: AgentSignal];
  closeActiveSignal: [];
}>();

const signals = ref<AgentSignal[]>([]);
const isLoading = ref(false);
const errorMessage = ref('');

let refreshToken = 0;
let refreshTimer: number | undefined;

const selectedSignal = computed(() => {
  return signals.value.find((signal) => signal.symbol === props.selectedSymbol);
});

const displayedSignal = computed(() => {
  if (props.activeSignal?.symbol === props.selectedSymbol) {
    return props.activeSignal;
  }

  return selectedSignal.value;
});

const isTrackingSignal = computed(() => props.activeSignal !== null);

const canAcceptSelectedSignal = computed(() => {
  const signal = selectedSignal.value;

  return (
    !isTrackingSignal.value &&
    signal !== undefined &&
    signal.direction !== 'FLAT' &&
    signal.status !== 'llm_veto' &&
    signal.takeProfit !== null &&
    signal.stopLoss !== null
  );
});

const lastUpdatedLabel = computed(() => {
  const updatedAt = displayedSignal.value?.updatedAt;

  if (!updatedAt) {
    return 'Waiting';
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(updatedAt));
});

async function refreshSignals() {
  if (isTrackingSignal.value) {
    return;
  }

  const currentToken = ++refreshToken;
  isLoading.value = true;
  errorMessage.value = '';

  try {
    const nextSignals = await Promise.all(
      MARKET_SYMBOLS.map((symbol) => loadSignalForSymbol(symbol)),
    );

    if (currentToken !== refreshToken) {
      return;
    }

    signals.value = nextSignals;

    if (nextSignals.every((signal) => signal.entry === 0)) {
      errorMessage.value = 'Unable to load market data for the watchlist.';
    }
  } finally {
    if (currentToken === refreshToken) {
      isLoading.value = false;
    }
  }
}

async function loadSignalForSymbol(symbol: MarketSymbol): Promise<AgentSignal> {
  try {
    const candles = await fetchFuturesKlines(symbol, props.interval, SIGNAL_CANDLE_LIMIT);
    const candidate = buildSignalCandidate(candles, symbol, props.interval);
    const newsContext = await fetchMarketNewsContext(symbol);
    const validation = await validateSignalWithOllama(candidate, { newsContext });

    return buildAgentSignal(candidate, validation);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'signal_load_failed';
    return createUnavailableSignal(symbol, props.interval, message);
  }
}

function selectSymbol(symbol: MarketSymbol) {
  emit('selectSymbol', symbol);
}

function acceptSelectedSignal() {
  const signal = selectedSignal.value;

  if (!signal || !canAcceptSelectedSignal.value) {
    return;
  }

  emit('acceptSignal', signal);
}

function closeActiveSignal() {
  emit('closeActiveSignal');
}

function formatPrice(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return '-';
  }

  if (value >= 1000) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function formatRiskReward(value: number | null) {
  return value === null ? '-' : `1:${value.toFixed(1)}`;
}

function formatConfidence(value: number) {
  return `${Math.round(value * 100)}%`;
}

function statusLabel(status: AgentSignalStatus) {
  const labels: Record<AgentSignalStatus, string> = {
    llm_validated: 'LLM validated',
    llm_review: 'LLM review',
    llm_veto: 'LLM veto',
    rule_fallback: 'Rule fallback',
  };

  return labels[status];
}

function settlementLabel(settlement: PaperTradeSettlement) {
  const labels: Record<PaperTradeSettlement['outcome'], string> = {
    take_profit: 'TP hit',
    stop_loss: 'SL hit',
    manual_close: 'Manual close',
  };
  const outcome = labels[settlement.outcome];
  return `${outcome} ${settlement.symbol} @ ${formatPrice(settlement.price)}`;
}

function newsStatusLabel(signal: AgentSignal) {
  const newsContext = signal.validation.newsContext;

  if (!newsContext) {
    return 'News not requested';
  }

  if (newsContext.status === 'unavailable') {
    return `News unavailable: ${newsContext.error ?? 'no recent headlines'}`;
  }

  return `${newsContext.articles.length} recent headlines checked`;
}

function newsDomains(signal: AgentSignal) {
  const domains = signal.validation.newsContext?.articles.map((article) => article.domain) ?? [];
  return [...new Set(domains)].slice(0, 4).join(', ');
}

function agentReasonPreview(reasons: string[]) {
  return reasons.slice(0, 2).join(', ');
}

onMounted(() => {
  void refreshSignals();
  refreshTimer = window.setInterval(() => {
    void refreshSignals();
  }, REFRESH_INTERVAL_MS);
});

watch(
  () => props.interval,
  () => {
    void refreshSignals();
  },
);

watch(
  () => props.activeSignal,
  (activeSignal, previousSignal) => {
    if (!activeSignal && previousSignal) {
      void refreshSignals();
    }
  },
);

onBeforeUnmount(() => {
  refreshToken += 1;

  if (refreshTimer !== undefined) {
    window.clearInterval(refreshTimer);
  }
});
</script>

<template>
  <section class="agent-panel" aria-labelledby="agent-title">
    <header class="agent-header">
      <div>
        <p>Paper signal only / Not financial advice</p>
        <h3 id="agent-title">Agent Signals</h3>
      </div>
      <div class="agent-actions">
        <span class="agent-updated">{{ lastUpdatedLabel }}</span>
        <button
          type="button"
          class="agent-refresh"
          :disabled="isLoading || isTrackingSignal"
          @click="refreshSignals"
        >
          Refresh
        </button>
      </div>
    </header>

    <div v-if="lastSettlement" class="agent-settlement" :data-outcome="lastSettlement.outcome">
      {{ settlementLabel(lastSettlement) }}
    </div>

    <div v-if="isTrackingSignal" class="agent-tracking">
      <span>Tracking accepted paper trade. New signals resume after TP, SL, or manual close.</span>
      <button type="button" class="agent-close" @click="closeActiveSignal">
        Close paper trade
      </button>
    </div>

    <div v-if="displayedSignal" class="agent-detail">
      <div class="agent-signal-line">
        <span class="agent-symbol">{{ displayedSignal.symbol }}</span>
        <span class="direction-pill" :data-direction="displayedSignal.direction">
          {{ displayedSignal.direction }}
        </span>
        <span class="status-pill" :data-status="displayedSignal.status">
          {{ statusLabel(displayedSignal.status) }}
        </span>
      </div>

      <dl class="agent-metrics">
        <div>
          <dt>Entry</dt>
          <dd>{{ formatPrice(displayedSignal.entry) }}</dd>
        </div>
        <div>
          <dt>TP</dt>
          <dd>{{ formatPrice(displayedSignal.takeProfit) }}</dd>
        </div>
        <div>
          <dt>SL</dt>
          <dd>{{ formatPrice(displayedSignal.stopLoss) }}</dd>
        </div>
        <div>
          <dt>R:R</dt>
          <dd>{{ formatRiskReward(displayedSignal.riskReward) }}</dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd>{{ formatConfidence(displayedSignal.confidence) }}</dd>
        </div>
      </dl>

      <p class="agent-summary">{{ displayedSignal.validation.summary }}</p>
      <div class="agent-news-context" :data-status="displayedSignal.validation.newsContext?.status ?? 'missing'">
        <span>{{ newsStatusLabel(displayedSignal) }}</span>
        <span v-if="newsDomains(displayedSignal)">{{ newsDomains(displayedSignal) }}</span>
      </div>
      <ul class="agent-reasons">
        <li v-for="reason in displayedSignal.reasons.slice(0, 6)" :key="reason">
          {{ reason }}
        </li>
      </ul>

      <div v-if="displayedSignal.agentAnalyses.length" class="agent-breakdown">
        <div class="agent-breakdown-heading">
          <span>Agent price map</span>
          <span>
            {{ displayedSignal.consensus.longVotes }}L /
            {{ displayedSignal.consensus.shortVotes }}S /
            {{ displayedSignal.consensus.flatVotes }}F
          </span>
        </div>
        <div class="agent-breakdown-grid">
          <div
            v-for="analysis in displayedSignal.agentAnalyses"
            :key="analysis.id"
            class="agent-analysis-card"
          >
            <div class="agent-analysis-title">
              <span>{{ analysis.label }}</span>
              <span class="direction-pill compact" :data-direction="analysis.vote">
                {{ analysis.vote }}
              </span>
            </div>
            <dl>
              <div>
                <dt>Entry</dt>
                <dd>{{ formatPrice(analysis.entry) }}</dd>
              </div>
              <div>
                <dt>TP</dt>
                <dd>{{ formatPrice(analysis.takeProfit) }}</dd>
              </div>
              <div>
                <dt>SL</dt>
                <dd>{{ formatPrice(analysis.stopLoss) }}</dd>
              </div>
              <div>
                <dt>Conf</dt>
                <dd>{{ formatConfidence(analysis.confidence) }}</dd>
              </div>
            </dl>
            <p>{{ agentReasonPreview(analysis.reasons) }}</p>
          </div>
        </div>
      </div>

      <button
        type="button"
        class="agent-accept"
        :disabled="!canAcceptSelectedSignal"
        @click="acceptSelectedSignal"
      >
        {{ isTrackingSignal ? 'Tracking accepted signal' : 'Accept signal' }}
      </button>
    </div>

    <div v-else class="agent-empty">Loading signals</div>

    <div v-if="errorMessage" class="agent-error" role="alert">
      {{ errorMessage }}
    </div>

    <div class="agent-table-wrap">
      <table class="agent-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Signal</th>
            <th>Entry</th>
            <th>TP</th>
            <th>SL</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="signal in signals"
            :key="signal.symbol"
            :data-active="signal.symbol === selectedSymbol"
          >
            <td>
              <button
                type="button"
                class="agent-symbol-button"
                :aria-pressed="signal.symbol === selectedSymbol"
                @click="selectSymbol(signal.symbol)"
              >
                {{ signal.symbol }}
              </button>
            </td>
            <td>
              <span class="direction-pill compact" :data-direction="signal.direction">
                {{ signal.direction }}
              </span>
            </td>
            <td>{{ formatPrice(signal.entry) }}</td>
            <td>{{ formatPrice(signal.takeProfit) }}</td>
            <td>{{ formatPrice(signal.stopLoss) }}</td>
            <td>{{ statusLabel(signal.status) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
