import { createSeriesMarkers, HistogramSeries, LineSeries } from 'lightweight-charts';
import type {
  IChartApi,
  ISeriesApi,
  ISeriesMarkersPluginApi,
  SeriesType,
  Time,
} from 'lightweight-charts';

import type { MarketCandle } from './binanceFutures';
import {
  calculateBollingerBands,
  calculateEma,
  calculateLiquiditySweeps,
  calculateMacd,
  calculateRsi,
  calculateVolumeHistogram,
  type IndicatorVisibility,
} from './indicators';

type IndicatorSeriesApi = ISeriesApi<'Line'> | ISeriesApi<'Histogram'>;

interface IndicatorSeriesGroup {
  ema20?: ISeriesApi<'Line'>;
  ema50?: ISeriesApi<'Line'>;
  ema200?: ISeriesApi<'Line'>;
  bollingerMiddle?: ISeriesApi<'Line'>;
  bollingerUpper?: ISeriesApi<'Line'>;
  bollingerLower?: ISeriesApi<'Line'>;
  volume?: ISeriesApi<'Histogram'>;
  rsi?: ISeriesApi<'Line'>;
  macdLine?: ISeriesApi<'Line'>;
  macdSignal?: ISeriesApi<'Line'>;
  macdHistogram?: ISeriesApi<'Histogram'>;
}

export interface ChartIndicatorController {
  rebuild(visibility: IndicatorVisibility): void;
  update(candles: MarketCandle[]): void;
  clear(): void;
}

export function createChartIndicatorController(
  chart: IChartApi,
  candleSeries: ISeriesApi<'Candlestick'>,
): ChartIndicatorController {
  let indicatorSeries: IndicatorSeriesGroup = {};
  let indicatorSeriesList: IndicatorSeriesApi[] = [];
  let currentVisibility: IndicatorVisibility | undefined;
  const liquiditySweepMarkers: ISeriesMarkersPluginApi<Time> = createSeriesMarkers(
    candleSeries,
    [],
    { zOrder: 'top' },
  );

  function registerSeries<T extends IndicatorSeriesApi>(series: T): T {
    indicatorSeriesList.push(series);
    return series;
  }

  function clear() {
    indicatorSeriesList.forEach((series) => {
      chart.removeSeries(series as ISeriesApi<SeriesType>);
    });
    indicatorSeriesList = [];
    indicatorSeries = {};
    liquiditySweepMarkers.setMarkers([]);

    const panes = chart.panes();
    for (let index = panes.length - 1; index >= 1; index -= 1) {
      chart.removePane(index);
    }
  }

  function rebuild(visibility: IndicatorVisibility) {
    clear();
    currentVisibility = { ...visibility };

    if (visibility.ema20) {
      indicatorSeries.ema20 = registerSeries(
        chart.addSeries(LineSeries, {
          color: '#f0b429',
          lineWidth: 1,
          lastValueVisible: false,
          priceLineVisible: false,
        }),
      );
    }

    if (visibility.ema50) {
      indicatorSeries.ema50 = registerSeries(
        chart.addSeries(LineSeries, {
          color: '#4ea4f5',
          lineWidth: 1,
          lastValueVisible: false,
          priceLineVisible: false,
        }),
      );
    }

    if (visibility.ema200) {
      indicatorSeries.ema200 = registerSeries(
        chart.addSeries(LineSeries, {
          color: '#d27bf3',
          lineWidth: 1,
          lastValueVisible: false,
          priceLineVisible: false,
        }),
      );
    }

    if (visibility.bollinger) {
      indicatorSeries.bollingerMiddle = registerSeries(
        chart.addSeries(LineSeries, {
          color: '#9aa7b6',
          lineWidth: 1,
          lastValueVisible: false,
          priceLineVisible: false,
        }),
      );
      indicatorSeries.bollingerUpper = registerSeries(
        chart.addSeries(LineSeries, {
          color: '#7f8c99',
          lineWidth: 1,
          lastValueVisible: false,
          priceLineVisible: false,
        }),
      );
      indicatorSeries.bollingerLower = registerSeries(
        chart.addSeries(LineSeries, {
          color: '#7f8c99',
          lineWidth: 1,
          lastValueVisible: false,
          priceLineVisible: false,
        }),
      );
    }

    let nextPaneIndex = 1;

    if (visibility.volume) {
      indicatorSeries.volume = registerSeries(
        chart.addSeries(
          HistogramSeries,
          {
            color: '#6f7d8f',
            lastValueVisible: false,
            priceLineVisible: false,
            priceFormat: { type: 'volume' },
          },
          nextPaneIndex,
        ),
      );
      chart.panes()[nextPaneIndex]?.setHeight(90);
      nextPaneIndex += 1;
    }

    if (visibility.rsi) {
      indicatorSeries.rsi = registerSeries(
        chart.addSeries(
          LineSeries,
          {
            color: '#f0b429',
            lineWidth: 1,
            lastValueVisible: false,
            priceLineVisible: false,
          },
          nextPaneIndex,
        ),
      );
      chart.panes()[nextPaneIndex]?.setHeight(90);
      nextPaneIndex += 1;
    }

    if (visibility.macd) {
      indicatorSeries.macdHistogram = registerSeries(
        chart.addSeries(
          HistogramSeries,
          {
            color: '#6f7d8f',
            lastValueVisible: false,
            priceLineVisible: false,
          },
          nextPaneIndex,
        ),
      );
      indicatorSeries.macdLine = registerSeries(
        chart.addSeries(
          LineSeries,
          {
            color: '#4ea4f5',
            lineWidth: 1,
            lastValueVisible: false,
            priceLineVisible: false,
          },
          nextPaneIndex,
        ),
      );
      indicatorSeries.macdSignal = registerSeries(
        chart.addSeries(
          LineSeries,
          {
            color: '#f0b429',
            lineWidth: 1,
            lastValueVisible: false,
            priceLineVisible: false,
          },
          nextPaneIndex,
        ),
      );
      chart.panes()[nextPaneIndex]?.setHeight(110);
    }
  }

  function update(candles: MarketCandle[]) {
    liquiditySweepMarkers.setMarkers(
      currentVisibility?.liquiditySweep ? calculateLiquiditySweeps(candles) : [],
    );

    indicatorSeries.ema20?.setData(calculateEma(candles, 20));
    indicatorSeries.ema50?.setData(calculateEma(candles, 50));
    indicatorSeries.ema200?.setData(calculateEma(candles, 200));

    if (
      indicatorSeries.bollingerMiddle ||
      indicatorSeries.bollingerUpper ||
      indicatorSeries.bollingerLower
    ) {
      const bands = calculateBollingerBands(candles, 20, 2);
      indicatorSeries.bollingerMiddle?.setData(bands.middle);
      indicatorSeries.bollingerUpper?.setData(bands.upper);
      indicatorSeries.bollingerLower?.setData(bands.lower);
    }

    indicatorSeries.volume?.setData(calculateVolumeHistogram(candles));
    indicatorSeries.rsi?.setData(calculateRsi(candles, 14));

    if (
      indicatorSeries.macdLine ||
      indicatorSeries.macdSignal ||
      indicatorSeries.macdHistogram
    ) {
      const macd = calculateMacd(candles, 12, 26, 9);
      indicatorSeries.macdLine?.setData(macd.line);
      indicatorSeries.macdSignal?.setData(macd.signal);
      indicatorSeries.macdHistogram?.setData(macd.histogram);
    }
  }

  return { rebuild, update, clear };
}
