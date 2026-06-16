import type { MarketSymbol } from './binanceFutures';

const GDELT_DOC_API_URL = '/api/gdelt/api/v2/doc/doc';
const DEFAULT_NEWS_MAX_RECORDS = 8;
const DEFAULT_NEWS_TIMESPAN = '12h';
const NEWS_CACHE_TTL_MS = 10 * 60 * 1000;

const newsContextCache = new Map<string, { expiresAt: number; context: MarketNewsContext }>();

export interface MarketNewsArticle {
  title: string;
  url: string;
  domain: string;
  sourceCountry?: string;
  language?: string;
  seenAt?: string;
}

export interface MarketNewsContext {
  symbol: MarketSymbol;
  query: string;
  articles: MarketNewsArticle[];
  fetchedAt: string;
  status: 'available' | 'unavailable';
  error?: string;
}

export interface FetchMarketNewsOptions {
  maxRecords?: number;
  timespan?: string;
  fetcher?: typeof fetch;
}

interface GdeltArticle {
  title?: unknown;
  url?: unknown;
  domain?: unknown;
  sourceCountry?: unknown;
  language?: unknown;
  seendate?: unknown;
}

interface GdeltResponse {
  articles?: GdeltArticle[];
}

export async function fetchMarketNewsContext(
  symbol: MarketSymbol,
  options: FetchMarketNewsOptions = {},
): Promise<MarketNewsContext> {
  const query = marketNewsQuery(symbol);
  const fetchedAt = new Date().toISOString();
  const fetcher = options.fetcher ?? fetch;
  const cacheKey = `${symbol}:${options.maxRecords ?? DEFAULT_NEWS_MAX_RECORDS}:${options.timespan ?? DEFAULT_NEWS_TIMESPAN}`;
  const cachedContext = options.fetcher ? undefined : newsContextCache.get(cacheKey);

  if (cachedContext && cachedContext.expiresAt > Date.now()) {
    return cachedContext.context;
  }

  try {
    const response = await fetcher(
      buildGdeltNewsUrl(query, options.maxRecords, options.timespan),
    );

    if (!response.ok) {
      return cacheNewsContext(
        cacheKey,
        unavailableNewsContext(symbol, query, `GDELT returned HTTP ${response.status}`, fetchedAt),
        options.fetcher,
      );
    }

    const payload = (await response.json()) as GdeltResponse;
    const articles = (payload.articles ?? []).flatMap(normalizeGdeltArticle);

    return cacheNewsContext(cacheKey, {
      symbol,
      query,
      articles,
      fetchedAt,
      status: articles.length > 0 ? 'available' : 'unavailable',
      error: articles.length > 0 ? undefined : 'No relevant recent news found.',
    }, options.fetcher);
  } catch (error) {
    return cacheNewsContext(
      cacheKey,
      unavailableNewsContext(
        symbol,
        query,
        error instanceof Error ? error.message : 'News fetch failed.',
        fetchedAt,
      ),
      options.fetcher,
    );
  }
}

export function buildGdeltNewsUrl(
  query: string,
  maxRecords = DEFAULT_NEWS_MAX_RECORDS,
  timespan = DEFAULT_NEWS_TIMESPAN,
): string {
  const params = new URLSearchParams({
    query,
    mode: 'artlist',
    format: 'json',
    sort: 'datedesc',
    maxrecords: String(maxRecords),
    timespan,
  });

  return `${GDELT_DOC_API_URL}?${params.toString()}`;
}

export function marketNewsQuery(symbol: MarketSymbol): string {
  const queries: Record<MarketSymbol, string> = {
    BTCUSDT: '(bitcoin OR BTC OR crypto OR cryptocurrency)',
    ETHUSDT: '(ethereum OR ether OR ETH OR crypto OR cryptocurrency)',
    BNBUSDT: '("Binance Coin" OR BNB OR Binance)',
    SOLUSDT: '(Solana OR SOL OR crypto OR cryptocurrency)',
    XAUUSDT: '(gold OR XAU OR "Federal Reserve" OR inflation OR "US dollar")',
  };

  return queries[symbol];
}

function normalizeGdeltArticle(article: GdeltArticle): MarketNewsArticle[] {
  if (
    typeof article.title !== 'string' ||
    article.title.trim() === '' ||
    typeof article.url !== 'string' ||
    article.url.trim() === ''
  ) {
    return [];
  }

  return [
    {
      title: article.title.trim(),
      url: article.url.trim(),
      domain: typeof article.domain === 'string' ? article.domain : articleDomain(article.url),
      sourceCountry: typeof article.sourceCountry === 'string' ? article.sourceCountry : undefined,
      language: typeof article.language === 'string' ? article.language : undefined,
      seenAt: typeof article.seendate === 'string' ? article.seendate : undefined,
    },
  ];
}

function unavailableNewsContext(
  symbol: MarketSymbol,
  query: string,
  error: string,
  fetchedAt: string,
): MarketNewsContext {
  return {
    symbol,
    query,
    articles: [],
    fetchedAt,
    status: 'unavailable',
    error,
  };
}

function cacheNewsContext(
  cacheKey: string,
  context: MarketNewsContext,
  skipCache: typeof fetch | undefined,
): MarketNewsContext {
  if (!skipCache) {
    newsContextCache.set(cacheKey, {
      expiresAt: Date.now() + NEWS_CACHE_TTL_MS,
      context,
    });
  }

  return context;
}

function articleDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}
