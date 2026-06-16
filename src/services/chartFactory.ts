import { CandlestickSeries, ColorType, createChart } from 'lightweight-charts';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';

export function createKinzokuChart(container: HTMLElement): IChartApi {
  return createChart(container, {
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
}

export function addFuturesCandleSeries(chart: IChartApi): ISeriesApi<'Candlestick'> {
  return chart.addSeries(CandlestickSeries, {
    upColor: '#16a085',
    downColor: '#e85d64',
    borderUpColor: '#16a085',
    borderDownColor: '#e85d64',
    wickUpColor: '#16a085',
    wickDownColor: '#e85d64',
  });
}
