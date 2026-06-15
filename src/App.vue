<script setup lang="ts">
import { computed, ref } from 'vue';

import FuturesChart from './components/FuturesChart.vue';
import {
  KLINE_INTERVALS,
  MARKET_SYMBOLS,
  type KlineInterval,
  type MarketSymbol,
} from './services/binanceFutures';

const selectedSymbol = ref<MarketSymbol>('BTCUSDT');
const selectedInterval = ref<KlineInterval>('1m');

const selectedMarketName = computed(() => {
  if (selectedSymbol.value === 'XAUUSDT') {
    return 'Gold perpetual';
  }

  return `${selectedSymbol.value.replace('USDT', '')} perpetual`;
});

function handleSymbolChange(event: Event) {
  selectedSymbol.value = (event.target as HTMLSelectElement).value as MarketSymbol;
}

function handleIntervalChange(event: Event) {
  selectedInterval.value = (event.target as HTMLSelectElement).value as KlineInterval;
}
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

        <FuturesChart :symbol="selectedSymbol" :interval="selectedInterval" />
      </section>
    </main>
  </div>
</template>
