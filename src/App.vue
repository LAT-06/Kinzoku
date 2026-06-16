<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';

import FuturesChart from './components/FuturesChart.vue';
import {
  KLINE_INTERVALS,
  MARKET_SYMBOLS,
  type KlineInterval,
  type MarketSymbol,
} from './services/binanceFutures';
import {
  DEFAULT_INDICATOR_VISIBILITY,
  INDICATOR_OPTIONS,
  type IndicatorId,
  type IndicatorVisibility,
} from './services/indicators';

const INDICATOR_VISIBILITY_STORAGE_KEY = 'kinzoku.indicatorVisibility';

function loadIndicatorVisibility(): IndicatorVisibility {
  const visibility = { ...DEFAULT_INDICATOR_VISIBILITY };

  try {
    const storedVisibility = window.localStorage.getItem(INDICATOR_VISIBILITY_STORAGE_KEY);

    if (!storedVisibility) {
      return visibility;
    }

    const parsedVisibility = JSON.parse(storedVisibility) as Partial<
      Record<IndicatorId, unknown>
    >;

    INDICATOR_OPTIONS.forEach((option) => {
      const savedValue = parsedVisibility[option.id];

      if (typeof savedValue === 'boolean') {
        visibility[option.id] = savedValue;
      }
    });
  } catch {
    return visibility;
  }

  return visibility;
}

function saveIndicatorVisibility(visibility: IndicatorVisibility) {
  const storedVisibility = INDICATOR_OPTIONS.reduce((savedVisibility, option) => {
    savedVisibility[option.id] = visibility[option.id];
    return savedVisibility;
  }, {} as IndicatorVisibility);

  try {
    window.localStorage.setItem(
      INDICATOR_VISIBILITY_STORAGE_KEY,
      JSON.stringify(storedVisibility),
    );
  } catch {
    // Keep the chart usable when storage is unavailable.
  }
}

const selectedSymbol = ref<MarketSymbol>('BTCUSDT');
const selectedInterval = ref<KlineInterval>('1m');
const enabledIndicators = reactive<IndicatorVisibility>(loadIndicatorVisibility());

const selectedMarketName = computed(() => {
  if (selectedSymbol.value === 'XAUUSDT') {
    return 'Gold perpetual';
  }

  return `${selectedSymbol.value.replace('USDT', '')} perpetual`;
});

const enabledIndicatorCount = computed(() => {
  return INDICATOR_OPTIONS.filter((option) => enabledIndicators[option.id]).length;
});

function handleSymbolChange(event: Event) {
  selectedSymbol.value = (event.target as HTMLSelectElement).value as MarketSymbol;
}

function handleIntervalChange(event: Event) {
  selectedInterval.value = (event.target as HTMLSelectElement).value as KlineInterval;
}

function handleIndicatorChange(indicator: IndicatorId, event: Event) {
  enabledIndicators[indicator] = (event.target as HTMLInputElement).checked;
}

watch(
  enabledIndicators,
  () => {
    saveIndicatorVisibility(enabledIndicators);
  },
  { deep: true },
);
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">K</div>
        <div>
          <h1>Kinzoku</h1>
          <p>USD-M Futures</p>
        </div>
      </div>

      <div class="controls" aria-label="Chart controls">
        <label class="control-field">
          <span>Market</span>
          <select :value="selectedSymbol" @change="handleSymbolChange">
            <option v-for="symbol in MARKET_SYMBOLS" :key="symbol" :value="symbol">
              {{ symbol }}
            </option>
          </select>
        </label>

        <label class="control-field">
          <span>Interval</span>
          <select :value="selectedInterval" @change="handleIntervalChange">
            <option v-for="interval in KLINE_INTERVALS" :key="interval" :value="interval">
              {{ interval }}
            </option>
          </select>
        </label>

        <details class="indicator-panel">
          <summary>
            <span>Indicators</span>
            <span class="indicator-count">{{ enabledIndicatorCount }}/{{ INDICATOR_OPTIONS.length }}</span>
          </summary>

          <fieldset>
            <legend class="sr-only">Indicators</legend>
            <div class="indicator-list">
              <label v-for="option in INDICATOR_OPTIONS" :key="option.id" class="indicator-toggle">
                <input
                  type="checkbox"
                  :checked="enabledIndicators[option.id]"
                  @change="handleIndicatorChange(option.id, $event)"
                />
                <span>{{ option.label }}</span>
              </label>
            </div>
          </fieldset>
        </details>
      </div>
    </header>

    <main class="app-main">
      <section class="chart-section" aria-labelledby="chart-title">
        <div class="chart-heading">
          <div>
            <p>Perpetual futures</p>
            <h2 id="chart-title">{{ selectedSymbol }}</h2>
          </div>
          <dl class="market-meta">
            <div>
              <dt>Instrument</dt>
              <dd>{{ selectedMarketName }}</dd>
            </div>
            <div>
              <dt>Interval</dt>
              <dd>{{ selectedInterval }}</dd>
            </div>
          </dl>
        </div>

        <FuturesChart
          :symbol="selectedSymbol"
          :interval="selectedInterval"
          :enabled-indicators="enabledIndicators"
        />
      </section>
    </main>
  </div>
</template>
