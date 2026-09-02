// Author: Preston Lee

import fetch from 'node-fetch';
import { logger } from '../logger.js';
import { RateLimiter, RateLimitError } from './rate-limiter.js';

export interface SearXNGResult {
  title: string;
  url: string;
  content?: string;
  snippet?: string;
}

export interface SearXNGResponse {
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
  }>;
  query?: string;
}

export interface SearXNGSearchParams {
  /** Base URL of the SearXNG instance (e.g. https://search.example.org). No trailing slash. */
  searxng_base_url: string;
  /** Search query (required by SearXNG API). */
  query: string;
  /** Output format: json, csv, or rss. Default json. */
  format?: 'json' | 'csv' | 'rss';
  /** Comma-separated categories (e.g. general, science). Optional. */
  categories?: string;
  /** Language code (e.g. en-US). Optional. */
  language?: string;
  /** Page number (default 1). Optional. */
  pageno?: number;
  /** Time range: day, week, month, year. Optional. */
  time_range?: string;
  /** SafeSearch: 0=off, 1=moderate, 2=strict. Optional. */
  safesearch?: number;
  /** Max results to return to caller (default 10). We slice the API results. */
  max_results?: number;
}

export class SearXNGService {
  private rateLimiter: RateLimiter;

  constructor(rateLimiter?: RateLimiter) {
    this.rateLimiter = rateLimiter || new RateLimiter();
    this.rateLimiter.configure('searxng', 30, 60000); // 30 req/min
  }

  /**
   * Normalize base URL: no trailing slash, allow path like https://host/search
   */
  private normalizeBaseUrl(baseUrl: string): string {
    if (!baseUrl || typeof baseUrl !== 'string') return baseUrl;
    const trimmed = baseUrl.trim();
    return trimmed.replace(/\/+$/, '');
  }

  /**
   * Build search URL for SearXNG. API accepts GET /search or GET / with query params.
   */
  private buildSearchUrl(baseUrl: string, params: SearXNGSearchParams): string {
    const base = this.normalizeBaseUrl(baseUrl);
    const searchPath = base.endsWith('/search') ? base : `${base}/search`;
    const url = new URL(searchPath);
    url.searchParams.set('q', params.query);
    url.searchParams.set('format', params.format || 'json');
    if (params.categories) url.searchParams.set('categories', params.categories);
    if (params.language) url.searchParams.set('language', params.language);
    if (params.pageno != null) url.searchParams.set('pageno', String(params.pageno));
    if (params.time_range) url.searchParams.set('time_range', params.time_range);
    if (params.safesearch != null) url.searchParams.set('safesearch', String(params.safesearch));
    return url.toString();
  }

  /**
   * Perform a search via SearXNG and return normalized results.
   */
  async search(params: SearXNGSearchParams): Promise<SearXNGResult[]> {
    const { searxng_base_url, query, max_results = 10 } = params;

    if (!searxng_base_url || typeof searxng_base_url !== 'string' || !searxng_base_url.trim()) {
      throw new Error('searxng_base_url is required and must be a non-empty string');
    }
    if (!query || typeof query !== 'string' || !query.trim()) {
      throw new Error('query is required and must be a non-empty string');
    }

    if (this.rateLimiter.getRemainingTokens('searxng') < 1) {
      throw new RateLimitError(
        'SearXNG search rate limited (30 requests per minute). Try again later or check get_rate_limit_status for remaining tokens.'
      );
    }
    await this.rateLimiter.acquire('searxng');

    const searchUrl = this.buildSearchUrl(searxng_base_url, params);
    const max = Math.min(Math.max(1, max_results || 10), 50);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    try {
      const response = await fetch(searchUrl, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'CQL-Studio-Server/1.0 (SearXNG proxy)'
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 403) {
          throw new Error('SearXNG returned 403. The instance may not allow JSON format or may block this client.');
        }
        if (response.status === 429) {
          throw new RateLimitError('SearXNG instance rate limit exceeded (HTTP 429). Try again later.');
        }
        throw new Error(`SearXNG returned ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error(`SearXNG returned non-JSON content type: ${contentType}`);
      }

      const data = (await response.json()) as SearXNGResponse;
      const rawResults = data.results || [];
      const results: SearXNGResult[] = rawResults.slice(0, max).map((r: any) => ({
        title: (r.title || 'No title').substring(0, 500),
        url: r.url || '',
        snippet: (r.content || r.snippet || '').substring(0, 500)
      })).filter((r: SearXNGResult) => r.url);

      return results;
    } catch (error: unknown) {
      clearTimeout(timeoutId);
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error({ searchUrl, err }, 'SearXNG search failed');
      if (err.name === 'AbortError') {
        throw new Error('SearXNG request timed out');
      }
      throw err;
    }
  }

  /** Return remaining SearXNG rate limit tokens (refreshed for elapsed time). */
  getRemainingSearchTokens(): number {
    return this.rateLimiter.getRemainingTokens('searxng');
  }

  /**
   * Search and return a string formatted for LLM consumption.
   */
  async searchFormatted(params: SearXNGSearchParams): Promise<string> {
    const results = await this.search(params);
    if (results.length === 0) return 'No search results found.';
    return results.map((r, i) => {
      return `[${i + 1}] ${r.title}\nURL: ${r.url}\nDescription: ${r.snippet || ''}`;
    }).join('\n\n');
  }
}
