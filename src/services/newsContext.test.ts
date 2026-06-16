import { describe, expect, it } from 'vitest';

import {
  buildGdeltNewsUrl,
  fetchMarketNewsContext,
  marketNewsQuery,
} from './newsContext';

describe('market news context', () => {
  it('builds GDELT URLs for recent article lists', () => {
    expect(buildGdeltNewsUrl('(bitcoin OR BTC)', 5, '6h')).toBe(
      'https://api.gdeltproject.org/api/v2/doc/doc?query=%28bitcoin+OR+BTC%29&mode=artlist&format=json&sort=datedesc&maxrecords=5&timespan=6h',
    );
  });

  it('maps symbols to news queries', () => {
    expect(marketNewsQuery('BTCUSDT')).toContain('bitcoin');
    expect(marketNewsQuery('XAUUSDT')).toContain('gold');
  });

  it('normalizes GDELT articles', async () => {
    const context = await fetchMarketNewsContext('ETHUSDT', {
      fetcher: async () =>
        new Response(
          JSON.stringify({
            articles: [
              {
                title: 'Ethereum ETF flows shift',
                url: 'https://example.com/eth',
                domain: 'example.com',
                sourceCountry: 'US',
                language: 'English',
                seendate: '20260616T120000Z',
              },
            ],
          }),
          { status: 200 },
        ),
    });

    expect(context.status).toBe('available');
    expect(context.articles).toEqual([
      {
        title: 'Ethereum ETF flows shift',
        url: 'https://example.com/eth',
        domain: 'example.com',
        sourceCountry: 'US',
        language: 'English',
        seenAt: '20260616T120000Z',
      },
    ]);
  });

  it('returns unavailable context when news fetch fails', async () => {
    const context = await fetchMarketNewsContext('SOLUSDT', {
      fetcher: async () => {
        throw new Error('network blocked');
      },
    });

    expect(context.status).toBe('unavailable');
    expect(context.error).toBe('network blocked');
    expect(context.articles).toEqual([]);
  });
});
