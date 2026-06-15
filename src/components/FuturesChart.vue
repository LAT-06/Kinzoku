<script setup lang="ts">
import { CandlestickSeries, ColorType, createChart } from 'lightweight-charts';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import {
  connectFuturesKlineStream,
  fetchFuturesKlines,
  type KlineInterval,
  type MarketSymbol,
  type StreamStatus,
} from '../services/binanceFutures';

const props = defineProps<{
  symbol: MarketSymbol;
  interval: KlineInterval;
}>();

const chartContainer = ref<HTMLDivElement | null>(null);
const isLoading = ref(true);
const errorMessage = ref('');
const streamStatus = ref<StreamStatus>('closed');

let chart: IChartApi | undefined;
let candleSeries: ISeriesApi<'Candlestick'> | undefined;
let cleanupStream: (() => void) | undefined;
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

    candleSeries.setData(history);
    chart?.timeScale().fitContent();

    cleanupStream = connectFuturesKlineStream(
      props.symbol,
      props.interval,
      (candle) => {
        candleSeries?.update(candle);
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

  chart = createChart(chartContainer.value, {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: '#111418' },
      textColor: '#d6dde6',
      fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    },
    grid: {
      vertLines: { color: '#202833' },
      horzLines: { color: '#202833' },
    },
    crosshair: {
      mode: 0,
      vertLine: { color: '#6f7d8f', labelBackgroundColor: '#2a3340' },
      horzLine: { color: '#6f7d8f', labelBackgroundColor: '#2a3340' },
    },
    rightPriceScale: {
      borderColor: '#2a3340',
    },
    timeScale: {
      borderColor: '#2a3340',
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 10,
    },
  });

  candleSeries = chart.addSeries(CandlestickSeries, {
    upColor: '#16a085',
    downColor: '#e85d64',
    borderUpColor: '#16a085',
    borderDownColor: '#e85d64',
    wickUpColor: '#16a085',
    wickDownColor: '#e85d64',
  });

  void loadMarketData();
});

watch(
  () => [props.symbol, props.interval] as const,
  () => {
    void loadMarketData();
  },
);

onBeforeUnmount(() => {
  loadToken += 1;
  cleanupStream?.();
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
