// Author: Preston Lee

import TurndownService from 'turndown';
import { RateLimiter } from '../rate-limiter.js';
import { cleanUrl, fetchWithTimeout, follow300Redirect, DEFAULT_FETCH_HEADERS } from './http-utils.js';
import { parseHtmlToContent } from './html-parser.js';
import { parseMetadataFromHtml } from './metadata-parser.js';
import { extractLinksFromHtml } from './link-extractor.js';
import { parseFeedXml } from './feed-parser.js';
import { parseSitemapXml } from './sitemap-parser.js';
import type {
  FetchResult,
  FetchMetadataResult,
  FetchFeedResult,
  ExtractedLink,
  FetchSitemapResult,
  SitemapUrl
} from './types.js';

export type {
  FetchResult,
  FetchMetadataResult,
  FeedEntry,
  FetchFeedResult,
  ExtractedLink,
  SitemapUrl,
  FetchSitemapResult
} from './types.js';

const FETCH_TIMEOUT_MS = 15000;
const METADATA_TIMEOUT_MS = 10000;

export class WebSearchService {
  private rateLimiter: RateLimiter;

  constructor(rateLimiter?: RateLimiter) {
    this.rateLimiter = rateLimiter ?? new RateLimiter();
    this.rateLimiter.configure('fetch', 20, 60000);
  }

  async fetchUrl(url: string): Promise<FetchResult> {
    await this.rateLimiter.acquire('fetch');
    const normalized = cleanUrl(url);
    new URL(normalized);

    try {
      let response = await fetchWithTimeout(normalized, { redirect: 'follow' }, FETCH_TIMEOUT_MS);
      response = await follow300Redirect(response, normalized, FETCH_TIMEOUT_MS);

      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

      const contentType = response.headers.get('content-type') || '';
      const finalUrl = response.url || normalized;

      if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
        return {
          url: finalUrl,
          title: 'Non-text content',
          content: '',
          textContent: `Content type ${contentType} is not supported. Only HTML and plain text are supported.`
        };
      }

      const body = await response.text();

      if (contentType.includes('text/plain')) {
        const truncated = body.substring(0, 50000);
        return {
          url: finalUrl,
          title: finalUrl.split('/').pop() || finalUrl,
          content: truncated,
          textContent: truncated
        };
      }

      const parsed = parseHtmlToContent(body, finalUrl);
      return { url: finalUrl, ...parsed };
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (err.name === 'AbortError') throw new Error('URL fetch request timed out after 15 seconds');
      if (err.message.includes('Invalid URL')) throw new Error(`Invalid URL: ${url}`);
      if (err.message.includes('rate limit')) throw new Error('Rate limit exceeded. Please wait before trying again.');
      throw new Error(`Failed to fetch URL: ${err.message}`);
    }
  }

  async fetchUrlFormatted(url: string): Promise<string> {
    const result = await this.fetchUrl(url);
    return `Title: ${result.title}\nURL: ${result.url}\n\n${result.textContent}`;
  }

  async fetchMetadata(url: string): Promise<FetchMetadataResult> {
    await this.rateLimiter.acquire('fetch');
    const normalized = cleanUrl(url);
    new URL(normalized);

    try {
      const response = await fetchWithTimeout(normalized, { redirect: 'follow' }, METADATA_TIMEOUT_MS);
      const finalUrl = response.url || normalized;
      const contentType = response.headers.get('content-type') || '';
      const result: FetchMetadataResult = {
        finalUrl,
        statusCode: response.status,
        contentType: contentType.split(';')[0].trim()
      };

      if (!response.ok) return result;
      if (contentType.includes('text/html')) {
        const raw = await response.text();
        const meta = parseMetadataFromHtml(raw.substring(0, 150000), finalUrl);
        Object.assign(result, meta);
      }
      return result;
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (err.name === 'AbortError') throw new Error('Metadata fetch request timed out after 10 seconds');
      if (err.message.includes('Invalid URL')) throw new Error(`Invalid URL: ${url}`);
      if (err.message.includes('rate limit')) throw new Error('Rate limit exceeded. Please wait before trying again.');
      throw new Error(`Failed to fetch metadata: ${err.message}`);
    }
  }

  async fetchFeed(url: string): Promise<FetchFeedResult> {
    await this.rateLimiter.acquire('fetch');
    const normalized = cleanUrl(url);
    new URL(normalized);

    try {
      const response = await fetchWithTimeout(
        normalized,
        {
          headers: {
            ...DEFAULT_FETCH_HEADERS,
            Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
          },
          redirect: 'follow'
        },
        FETCH_TIMEOUT_MS
      );
      if (!response.ok) throw new Error(`Feed fetch failed: HTTP ${response.status} ${response.statusText}`);
      const xml = await response.text();
      return parseFeedXml(xml, normalized);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (err.name === 'AbortError') throw new Error('Feed fetch request timed out after 15 seconds');
      if (err.message.includes('Invalid URL')) throw new Error(`Invalid URL: ${url}`);
      if (err.message.includes('rate limit')) throw new Error('Rate limit exceeded. Please wait before trying again.');
      throw new Error(`Failed to fetch feed: ${err.message}`);
    }
  }

  async fetchUrlAsMarkdown(url: string): Promise<string> {
    const result = await this.fetchUrl(url);
    const html = result.content || '';
    if (!html.trim()) return `Title: ${result.title}\nURL: ${result.url}\n\n${result.textContent}`;
    try {
      const turndown = new TurndownService({ headingStyle: 'atx' });
      const markdown = turndown.turndown(html);
      return `Title: ${result.title}\nURL: ${result.url}\n\n${markdown}`;
    } catch {
      return `Title: ${result.title}\nURL: ${result.url}\n\n${result.textContent}`;
    }
  }

  async extractLinks(url: string, sameDomainOnly = false): Promise<ExtractedLink[]> {
    await this.rateLimiter.acquire('fetch');
    const normalized = cleanUrl(url);
    new URL(normalized);

    try {
      const response = await fetchWithTimeout(normalized, { redirect: 'follow' }, FETCH_TIMEOUT_MS);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      const contentType = response.headers.get('content-type') || '';
      const finalUrl = response.url || normalized;
      if (!contentType.includes('text/html')) return [];
      const html = await response.text();
      return extractLinksFromHtml(html, finalUrl, sameDomainOnly);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (err.name === 'AbortError') throw new Error('Extract links request timed out after 15 seconds');
      if (err.message.includes('Invalid URL')) throw new Error(`Invalid URL: ${url}`);
      if (err.message.includes('rate limit')) throw new Error('Rate limit exceeded. Please wait before trying again.');
      throw new Error(`Failed to extract links: ${err.message}`);
    }
  }

  async fetchSitemap(url: string, expandIndex = false): Promise<FetchSitemapResult> {
    await this.rateLimiter.acquire('fetch');
    const normalized = cleanUrl(url);
    new URL(normalized);

    try {
      const response = await fetchWithTimeout(
        normalized,
        {
          headers: { ...DEFAULT_FETCH_HEADERS, Accept: 'application/xml, text/xml, */*' },
          redirect: 'follow'
        },
        FETCH_TIMEOUT_MS
      );
      if (!response.ok) throw new Error(`Sitemap fetch failed: HTTP ${response.status} ${response.statusText}`);
      const xml = await response.text();
      const parsed = parseSitemapXml(xml);

      if (parsed.type === 'sitemapindex' && parsed.sitemaps && expandIndex && parsed.sitemaps.length > 0) {
        const maxExpand = Math.min(10, parsed.sitemaps.length);
        const allUrls: SitemapUrl[] = [];
        for (let i = 0; i < maxExpand; i++) {
          try {
            const child = await this.fetchSitemap(parsed.sitemaps![i].loc, false);
            if (child.urls) allUrls.push(...child.urls);
          } catch {
            // skip failed child sitemap
          }
        }
        return { type: 'urlset', url: normalized, urls: allUrls };
      }

      return { ...parsed, url: normalized };
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (err.name === 'AbortError') throw new Error('Sitemap fetch request timed out after 15 seconds');
      if (err.message.includes('Invalid URL')) throw new Error(`Invalid URL: ${url}`);
      if (err.message.includes('rate limit')) throw new Error('Rate limit exceeded. Please wait before trying again.');
      throw new Error(`Failed to fetch sitemap: ${err.message}`);
    }
  }

  getRemainingFetchTokens(): number {
    return this.rateLimiter.getRemainingTokens('fetch');
  }
}
