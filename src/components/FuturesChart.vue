<script setup lang="ts">
import { LineStyle } from 'lightweight-charts';
import type { IChartApi, IPriceLine, ISeriesApi } from 'lightweight-charts';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import {
  connectFuturesKlineStream,
  fetchFuturesKlines,
  type KlineInterval,
  type MarketCandle,
  type MarketSymbol,
  type StreamStatus,
} from '../services/binanceFutures';
import {
  createChartIndicatorController,
  type ChartIndicatorController,
} from '../services/chartIndicatorSeries';
import { addFuturesCandleSeries, createKinzokuChart } from '../services/chartFactory';
import type { IndicatorVisibility } from '../services/indicators';
import {
  resolveSignalSettlement,
  type AgentSignal,
  type PaperTradeSettlement,
} from '../services/agentSignals';

type ActiveTradeSignal = AgentSignal & {
  direction: 'LONG' | 'SHORT';
  takeProfit: number;
  stopLoss: number;
};

const props = defineProps<{
  symbol: MarketSymbol;
  interval: KlineInterval;
  enabledIndicators: IndicatorVisibility;
  activeSignal: AgentSignal | null;
}>();

const emit = defineEmits<{
  paperTradeSettled: [settlement: PaperTradeSettlement];
}>();

const chartContainer = ref<HTMLDivElement | null>(null);
const isLoading = ref(true);
const errorMessage = ref('');
const streamStatus = ref<StreamStatus>('closed');
const tradeOverlay = ref<{
  direction: 'LONG' | 'SHORT';
  rewardTop: number;
  rewardHeight: number;
  riskTop: number;
  riskHeight: number;
  entryTop: number;
  takeProfitTop: number;
  stopLossTop: number;
  entryLabel: string;
  takeProfitLabel: string;
  stopLossLabel: string;
} | null>(null);

let chart: IChartApi | undefined;
let candleSeries: ISeriesApi<'Candlestick'> | undefined;
let indicatorController: ChartIndicatorController | undefined;
let cleanupStream: (() => void) | undefined;
let resizeObserver: ResizeObserver | undefined;
let tradePriceLines: IPriceLine[] = [];
let settledSignalKey: string | undefined;
let candles: MarketCandle[] = [];
let loadToken = 0;

const statusLabel = computed(() => {
  const labels: Record<StreamStatus, string> = {
    connecting: 'Connecting',
    open: 'Live',
    closed: 'Closed',
    reconnecting: 'Reconnecting',
    error: 'Stream error',
  };

  return labels[streamStatus.value];
});

function rebuildIndicators() {
  indicatorController?.rebuild(props.enabledIndicators);
  indicatorController?.update(candles);
}

function activeTradeSignal(): ActiveTradeSignal | undefined {
  const signal = props.activeSignal;

  if (
    !signal ||
    signal.symbol !== props.symbol ||
    signal.interval !== props.interval ||
    signal.direction === 'FLAT' ||
    signal.takeProfit === null ||
    signal.stopLoss === null
  ) {
    return undefined;
  }

  return signal as ActiveTradeSignal;
}

function signalKey(signal: AgentSignal) {
  return `${signal.symbol}:${signal.interval}:${signal.updatedAt}:${signal.direction}:${signal.entry}`;
}

function clearTradeOverlay() {
  if (candleSeries) {
    tradePriceLines.forEach((line) => {
      candleSeries?.removePriceLine(line);
    });
  }

  tradePriceLines = [];
  tradeOverlay.value = null;
}

function rebuildTradeOverlay() {
  clearTradeOverlay();

  const signal = activeTradeSignal();

  if (!signal || !candleSeries) {
    return;
  }

  const directionColor = signal.direction === 'LONG' ? '#23a6a6' : '#e85d64';

  tradePriceLines = [
    candleSeries.createPriceLine({
      price: signal.entry,
      color: '#eef2f6',
      lineWidth: 2,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: true,
      title: `ENTRY ${signal.direction}`,
    }),
    candleSeries.createPriceLine({
      price: signal.takeProfit,
      color: '#23a6a6',
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: 'TP',
    }),
    candleSeries.createPriceLine({
      price: signal.stopLoss,
      color: '#e85d64',
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: 'SL',
    }),
  ];

  chart?.applyOptions({
    crosshair: {
      horzLine: { labelBackgroundColor: directionColor },
    },
  });
  renderTradeOverlay();
}

function renderTradeOverlay() {
  const signal = activeTradeSignal();

  if (!signal || !candleSeries) {
    tradeOverlay.value = null;
    return;
  }

  const entryTop = candleSeries.priceToCoordinate(signal.entry);
  const takeProfitTop = candleSeries.priceToCoordinate(signal.takeProfit);
  const stopLossTop = candleSeries.priceToCoordinate(signal.stopLoss);

  if (entryTop === null || takeProfitTop === null || stopLossTop === null) {
    tradeOverlay.value = null;
    return;
  }

  tradeOverlay.value = {
    direction: signal.direction,
    rewardTop: Math.min(entryTop, takeProfitTop),
    rewardHeight: Math.abs(entryTop - takeProfitTop),
    riskTop: Math.min(entryTop, stopLossTop),
    riskHeight: Math.abs(entryTop - stopLossTop),
    entryTop,
    takeProfitTop,
    stopLossTop,
    entryLabel: `Entry ${formatPrice(signal.entry)}`,
    takeProfitLabel: `TP ${formatPrice(signal.takeProfit)}`,
    stopLossLabel: `SL ${formatPrice(signal.stopLoss)}`,
  };
}

function checkPaperTradeSettlement(candle: MarketCandle) {
  const signal = activeTradeSignal();

  if (!signal || settledSignalKey === signalKey(signal)) {
    return;
  }

  const settlement = resolveSignalSettlement(signal, candle);

  if (!settlement) {
    return;
  }

  settledSignalKey = signalKey(signal);
  clearTradeOverlay();
  emit('paperTradeSettled', settlement);
}

function formatPrice(value: number) {
  if (value >= 1000) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function updateCandleHistory(candle: MarketCandle) {
  const lastCandle = candles[candles.length - 1];

  if (!lastCandle || candle.time > lastCandle.time) {
    candles.push(candle);
    return;
  }

  if (candle.time === lastCandle.time) {
    candles[candles.length - 1] = candle;
    return;
  }

  const existingIndex = candles.findIndex((item) => item.time === candle.time);

  if (existingIndex >= 0) {
    candles[existingIndex] = candle;
  }
}

async function loadMarketData() {
  if (!candleSeries) {
    return;
  }

  const currentToken = ++loadToken;
  isLoading.value = true;
  errorMessage.value = '';
  cleanupStream?.();

  try {
    const history = await fetchFuturesKlines(props.symbol, props.interval);

    if (currentToken !== loadToken) {
      return;
    }

    candles = history;
    candleSeries.setData(candles);
    rebuildIndicators();
    rebuildTradeOverlay();
    chart?.timeScale().fitContent();
    renderTradeOverlay();

    cleanupStream = connectFuturesKlineStream(
      props.symbol,
      props.interval,
      (candle) => {
        updateCandleHistory(candle);
        candleSeries?.update(candle);
        indicatorController?.update(candles);
        checkPaperTradeSettlement(candle);
        renderTradeOverlay();
      },
      (status) => {
        streamStatus.value = status;
      },
    );
  } catch (error) {
    if (currentToken !== loadToken) {
      return;
    }

    streamStatus.value = 'error';
    errorMessage.value = error instanceof Error ? error.message : 'Unable to load market data';
    candles = [];
    candleSeries.setData([]);
    indicatorController?.update(candles);
    clearTradeOverlay();
  } finally {
    if (currentToken === loadToken) {
      isLoading.value = false;
    }
  }
}

onMounted(() => {
  if (!chartContainer.value) {
    return;
  }

  chart = createKinzokuChart(chartContainer.value);
  candleSeries = addFuturesCandleSeries(chart);
  indicatorController = createChartIndicatorController(chart, candleSeries);
  resizeObserver = new ResizeObserver(() => {
    renderTradeOverlay();
  });
  resizeObserver.observe(chartContainer.value);
  chart.timeScale().subscribeVisibleLogicalRangeChange(renderTradeOverlay);
  void loadMarketData();
});

watch(
  () => [props.symbol, props.interval] as const,
  () => {
    void loadMarketData();
  },
);

watch(
  () => props.activeSignal,
  () => {
    settledSignalKey = undefined;
    rebuildTradeOverlay();
  },
);

watch(
  () => props.enabledIndicators,
  () => {
    rebuildIndicators();
  },
  { deep: true },
);

onBeforeUnmount(() => {
  loadToken += 1;
  cleanupStream?.();
  resizeObserver?.disconnect();
  chart?.timeScale().unsubscribeVisibleLogicalRangeChange(renderTradeOverlay);
  clearTradeOverlay();
  indicatorController?.clear();
  chart?.remove();
});
</script>

<template>
  <div class="chart-shell">
    <div
      ref="chartContainer"
      class="chart-canvas"
      :aria-label="`${symbol} ${interval} futures candlestick chart`"
    />

    <div v-if="tradeOverlay" class="trade-zone-layer" aria-hidden="true">
      <div
        class="trade-zone trade-zone-reward"
        :data-direction="tradeOverlay.direction"
        :style="{ top: `${tradeOverlay.rewardTop}px`, height: `${tradeOverlay.rewardHeight}px` }"
      />
      <div
        class="trade-zone trade-zone-risk"
        :data-direction="tradeOverlay.direction"
        :style="{ top: `${tradeOverlay.riskTop}px`, height: `${tradeOverlay.riskHeight}px` }"
      />
      <span class="trade-zone-label trade-zone-label-entry" :style="{ top: `${tradeOverlay.entryTop}px` }">
        {{ tradeOverlay.entryLabel }}
      </span>
      <span class="trade-zone-label trade-zone-label-tp" :style="{ top: `${tradeOverlay.takeProfitTop}px` }">
        {{ tradeOverlay.takeProfitLabel }}
      </span>
      <span class="trade-zone-label trade-zone-label-sl" :style="{ top: `${tradeOverlay.stopLossTop}px` }">
        {{ tradeOverlay.stopLossLabel }}
      </span>
    </div>

    <div v-if="isLoading" class="chart-overlay" aria-live="polite">
      Loading {{ symbol }}
    </div>

    <div v-if="errorMessage" class="chart-overlay chart-overlay-error" role="alert">
      {{ errorMessage }}
    </div>

    <div class="chart-status" :data-status="streamStatus">
      <span class="status-dot" aria-hidden="true" />
      {{ statusLabel }}
    </div>
  </div>
</template>
