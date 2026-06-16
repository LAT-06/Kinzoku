<script setup lang="ts">
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
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

const props = defineProps<{
  symbol: MarketSymbol;
  interval: KlineInterval;
  enabledIndicators: IndicatorVisibility;
}>();

const chartContainer = ref<HTMLDivElement | null>(null);
const isLoading = ref(true);
const errorMessage = ref('');
const streamStatus = ref<StreamStatus>('closed');

let chart: IChartApi | undefined;
let candleSeries: ISeriesApi<'Candlestick'> | undefined;
let indicatorController: ChartIndicatorController | undefined;
let cleanupStream: (() => void) | undefined;
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
    chart?.timeScale().fitContent();

    cleanupStream = connectFuturesKlineStream(
      props.symbol,
      props.interval,
      (candle) => {
        updateCandleHistory(candle);
        candleSeries?.update(candle);
        indicatorController?.update(candles);
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
  void loadMarketData();
});

watch(
  () => [props.symbol, props.interval] as const,
  () => {
    void loadMarketData();
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
