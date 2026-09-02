// Author: Preston Lee

import { MCPToolNames, type MCPTool } from '@cql-studio/core';
import { WebSearchService } from '../services/web-search/index.js';
import { SearXNGService } from '../services/searxng.service.js';
import { logger } from '../logger.js';

const DEFAULT_VSAC_FHIR_BASE = 'https://cts.nlm.nih.gov/fhir';
const ALLOWED_VSAC_HOSTS = new Set(['cts.nlm.nih.gov', 'uat-cts.nlm.nih.gov']);
const FHIR_JSON = 'application/fhir+json';

interface VsacToolConfig {
  fhirBaseUrl: string;
  username: string;
  password: string;
}

interface VsacValueSetSummary {
  resourceType: 'ValueSet';
  id?: string;
  url?: string;
  name?: string;
  title?: string;
  version?: string;
  status?: string;
  publisher?: string;
  date?: string;
  description?: string;
  expansionTotal?: number;
}

export type { MCPTool };

export class ToolExecutor {
  private webSearchService: WebSearchService;
  private searxngService: SearXNGService;

  constructor() {
    this.webSearchService = new WebSearchService();
    this.searxngService = new SearXNGService();
  }

  /**
   * Get all available MCP tools
   * Matches DuckDuckGo MCP Server tool definitions
   */
  async getAvailableTools(): Promise<MCPTool[]> {
    return [
      {
        name: MCPToolNames.FETCH_CONTENT,
        description: 'Fetches and parses content from a webpage and returns a single formatted string for LLM context. Use this when you need to inject page content directly into your response or context. Includes intelligent text extraction, rate limiting (20 requests per minute), and removes ads and irrelevant content. Return value: a single string with title, URL, and body text (newline-separated). Supports HTML and plain text URLs.',
        statusMessage: 'Fetching content...',
        allowedInPlanMode: true,
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The webpage URL to fetch content from (HTTP or HTTPS)'
            }
          },
          required: ['url']
        }
      },
      {
        name: MCPToolNames.FETCH_URL,
        description: 'Download and parse web content from a URL and return structured metadata plus text. Use this when you need individual fields (title, url, snippet length, hasMoreContent) or to check if content was truncated. Returns an object: { url, title, contentLength, textContent (max 10000 chars), hasMoreContent }. Rate limiting: 20 requests per minute. Supports HTML and plain text.',
        statusMessage: 'Fetching URL...',
        allowedInPlanMode: true,
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL to fetch and parse (HTTP or HTTPS)'
            }
          },
          required: ['url']
        }
      },
      {
        name: MCPToolNames.SEARXNG_SEARCH,
        description: 'Perform an anonymous general web search via a user-configured SearXNG instance (no API key required). Do NOT use this tool to discover, look up, or validate VSAC ValueSets, OIDs, or canonical URLs; use vsac_search for discovery and validate_vsac for an existing reference. Returns an object: { query, resultsCount, results: [{ title, url, snippet }] }. Use for non-VSAC web research when you need structured search results to process or filter. Requires searxng_base_url from the user. Rate limited (30 requests per minute). Optional: categories, language, time_range, safesearch, max_results (1–50).',
        statusMessage: 'Searching web (SearXNG)...',
        allowedInPlanMode: true,
        parameters: {
          type: 'object',
          properties: {
            searxng_base_url: {
              type: 'string',
              description: 'Base URL of the SearXNG instance (e.g. https://search.example.org). No trailing slash.'
            },
            query: {
              type: 'string',
              description: 'The search query string'
            },
            format: {
              type: 'string',
              description: 'SearXNG output format. Use json (default); this server parses and returns structured results only for json.',
              enum: ['json', 'csv', 'rss']
            },
            categories: {
              type: 'string',
              description: 'Comma-separated categories (e.g. general, science)'
            },
            language: {
              type: 'string',
              description: 'Language code (e.g. en-US)'
            },
            pageno: {
              type: 'number',
              description: 'Page number (default: 1)'
            },
            time_range: {
              type: 'string',
              description: 'Filter by time: day, week, month, year'
            },
            safesearch: {
              type: 'number',
              description: 'SafeSearch level: 0=off, 1=moderate, 2=strict'
            },
            max_results: {
              type: 'number',
              description: 'Maximum number of results to return (default: 10, max: 50)'
            }
          },
          required: ['searxng_base_url', 'query']
        }
      },
      {
        name: MCPToolNames.SEARXNG_SEARCH_FORMATTED,
        description: 'Perform an anonymous general web search via a SearXNG instance and return a single formatted string for LLM context (no API key required). Do NOT use this tool to discover, look up, or validate VSAC ValueSets, OIDs, or canonical URLs; use vsac_search for discovery and validate_vsac for an existing reference. Use for non-VSAC web research when you want to inject search results directly into your response. Return value: a single string with numbered entries (title, URL, description per result). Requires searxng_base_url. Rate limited (30 requests per minute). Same optional parameters as searxng_search (categories, language, time_range, safesearch, max_results 1–50).',
        statusMessage: 'Searching web (SearXNG)...',
        allowedInPlanMode: true,
        parameters: {
          type: 'object',
          properties: {
            searxng_base_url: {
              type: 'string',
              description: 'Base URL of the SearXNG instance (e.g. https://search.example.org). No trailing slash.'
            },
            query: {
              type: 'string',
              description: 'The search query string'
            },
            categories: {
              type: 'string',
              description: 'Comma-separated categories (e.g. general, science)'
            },
            language: {
              type: 'string',
              description: 'Language code (e.g. en-US)'
            },
            pageno: {
              type: 'number',
              description: 'Page number (default: 1)'
            },
            time_range: {
              type: 'string',
              description: 'Filter by time: day, week, month, year'
            },
            safesearch: {
              type: 'number',
              description: 'SafeSearch level: 0=off, 1=moderate, 2=strict'
            },
            max_results: {
              type: 'number',
              description: 'Maximum number of results to return (default: 10, max: 50)'
            }
          },
          required: ['searxng_base_url', 'query']
        }
      },
      {
        name: MCPToolNames.SEARXNG_SEARCH_THEN_FETCH,
        description: 'Run a general SearXNG web search and then fetch full page content for the top results in one call. Do NOT use this tool for VSAC ValueSet discovery or validation; use vsac_search or validate_vsac instead. Use for non-VSAC research when you need both search and full text of the first few results. Returns an array of { url, title, snippet, content } (content is formatted body text). Consumes 1 search + N fetch rate limit tokens (N = max_results_to_fetch, default 3, max 5). Requires searxng_base_url and query.',
        statusMessage: 'Searching and fetching...',
        allowedInPlanMode: true,
        parameters: {
          type: 'object',
          properties: {
            searxng_base_url: {
              type: 'string',
              description: 'Base URL of the SearXNG instance (e.g. https://search.example.org). No trailing slash.'
            },
            query: {
              type: 'string',
              description: 'The search query string'
            },
            max_results_to_fetch: {
              type: 'number',
              description: 'Number of search results to fetch full content for (default: 3, max: 5)'
            },
            categories: { type: 'string', description: 'Comma-separated categories (e.g. general, science)' },
            language: { type: 'string', description: 'Language code (e.g. en-US)' },
            time_range: { type: 'string', description: 'Filter by time: day, week, month, year' },
            safesearch: { type: 'number', description: 'SafeSearch level: 0=off, 1=moderate, 2=strict' }
          },
          required: ['searxng_base_url', 'query']
        }
      },
      {
        name: MCPToolNames.SEARXNG_SEARCH_THEN_FETCH_FORMATTED,
        description: 'Run a general SearXNG web search and fetch full content for the top results, then return a single formatted string for LLM context. Do NOT use this tool for VSAC ValueSet discovery or validation; use vsac_search or validate_vsac instead. Same as searxng_search_then_fetch but returns one string with all results concatenated. Use for non-VSAC "search and read" tasks. max_results_to_fetch default 3, max 5.',
        statusMessage: 'Searching and fetching...',
        allowedInPlanMode: true,
        parameters: {
          type: 'object',
          properties: {
            searxng_base_url: {
              type: 'string',
              description: 'Base URL of the SearXNG instance (e.g. https://search.example.org). No trailing slash.'
            },
            query: {
              type: 'string',
              description: 'The search query string'
            },
            max_results_to_fetch: {
              type: 'number',
              description: 'Number of search results to fetch full content for (default: 3, max: 5)'
            },
            categories: { type: 'string', description: 'Comma-separated categories (e.g. general, science)' },
            language: { type: 'string', description: 'Language code (e.g. en-US)' },
            time_range: { type: 'string', description: 'Filter by time: day, week, month, year' },
            safesearch: { type: 'number', description: 'SafeSearch level: 0=off, 1=moderate, 2=strict' }
          },
          required: ['searxng_base_url', 'query']
        }
      },
      {
        name: MCPToolNames.BATCH_FETCH,
        description: 'Fetch multiple URLs in one call and return structured results for each. Use when you already have a list of URLs (e.g. from searxng_search). Returns array of { url, title, contentLength, textContent (max 10000 chars), hasMoreContent }. Max 10 URLs per call. Each URL consumes one fetch rate limit token (20/min).',
        statusMessage: 'Fetching URLs...',
        allowedInPlanMode: true,
        parameters: {
          type: 'object',
          properties: {
            urls: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of URLs to fetch (max 10). Each must be HTTP or HTTPS.'
            }
          },
          required: ['urls']
        }
      },
      {
        name: MCPToolNames.FETCH_METADATA,
        description: 'Lightweight fetch: get final URL (after redirects), status code, content-type, and optional title/description/image from HTML meta tags (Open Graph, Twitter Card). Use to check if a link is valid, get preview card data, or decide whether to run fetch_content. Does not download full body (reads only first 150KB for meta). Rate limited (20/min, same as fetch).',
        statusMessage: 'Fetching metadata...',
        allowedInPlanMode: true,
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL to fetch metadata for (HTTP or HTTPS)'
            }
          },
          required: ['url']
        }
      },
      {
        name: MCPToolNames.FETCH_FEED,
        description: 'Fetch and parse an RSS or Atom feed. Returns feed title, link, description, and list of entries (title, link, summary, date). Use for blogs, news, and "what\'s new" discovery. Rate limited (20/min, same as fetch).',
        statusMessage: 'Fetching feed...',
        allowedInPlanMode: true,
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The feed URL (RSS or Atom, HTTP or HTTPS)'
            }
          },
          required: ['url']
        }
      },
      {
        name: MCPToolNames.FETCH_CONTENT_AS_MARKDOWN,
        description: 'Fetch a webpage and return its main content as Markdown (headings, lists, links preserved). Use when you want structured Markdown instead of plain text. Return value: single string with title, URL, and Markdown body. Rate limited (20/min, same as fetch).',
        statusMessage: 'Fetching as Markdown...',
        allowedInPlanMode: true,
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The webpage URL to fetch (HTTP or HTTPS)'
            }
          },
          required: ['url']
        }
      },
      {
        name: MCPToolNames.EXTRACT_LINKS,
        description: 'Fetch a page and return all outbound links. Use for discovery or crawling. Returns array of { href, text }. Optionally restrict to same domain only. Rate limited (20/min).',
        statusMessage: 'Extracting links...',
        allowedInPlanMode: true,
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The page URL to extract links from (HTTP or HTTPS)'
            },
            same_domain_only: {
              type: 'boolean',
              description: 'If true, only return links whose host matches the page host (default: false)'
            }
          },
          required: ['url']
        }
      },
      {
        name: MCPToolNames.FETCH_SITEMAP,
        description: 'Fetch and parse a sitemap.xml (or sitemap index). Returns either urlset (list of page URLs with optional lastmod, changefreq, priority) or sitemapindex (list of child sitemap URLs). Use expand_index to follow an index and aggregate URLs from up to 10 child sitemaps. Rate limited (20/min; expanding an index consumes 1 + N tokens).',
        statusMessage: 'Fetching sitemap...',
        allowedInPlanMode: true,
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The sitemap URL (e.g. https://example.com/sitemap.xml)'
            },
            expand_index: {
              type: 'boolean',
              description: 'If true and the sitemap is an index, fetch each child sitemap (max 10) and return all URLs (default: false)'
            }
          },
          required: ['url']
        }
      },
      {
        name: MCPToolNames.GET_RATE_LIMIT_STATUS,
        description: 'Return remaining rate limit tokens for fetch and search. Use to decide whether to batch requests or wait. No parameters. Does not consume any tokens.',
        statusMessage: 'Checking rate limits...',
        allowedInPlanMode: true,
        parameters: {
          type: 'object',
          properties: {},
          required: []
        }
      },
      {
        name: MCPToolNames.VSAC_SEARCH,
        description: 'MANDATORY for VSAC ValueSet discovery. Search the official NLM VSAC FHIR ValueSet endpoint before writing or editing CQL that introduces a ValueSet when the exact canonical URL is not already known in this conversation. Results returned by vsac_search are authoritative and MUST NOT be passed to validate_vsac; choose a candidate and proceed directly to the requested code edit using its exact canonical URL. Never guess a VSAC OID/canonical URL and never use SearXNG as a substitute. Returns verified candidates with id/OID, canonical URL, title/name, version, status, publisher, description, and a CQL declaration. VSAC credentials and base URL are injected by CQL Studio; do not ask the user for them.',
        statusMessage: 'Searching VSAC...',
        allowedInPlanMode: true,
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Human search text, usually a clinical value set name or topic. Applied to VSAC/FHIR title contains.'
            },
            title: {
              type: 'string',
              description: 'FHIR title contains search. VSAC display name maps to FHIR title.'
            },
            name: {
              type: 'string',
              description: 'FHIR name contains search for machine-oriented names.'
            },
            url: {
              type: 'string',
              description: 'Exact canonical ValueSet URL to search for.'
            },
            identifier: {
              type: 'string',
              description: 'Identifier or OID to search for.'
            },
            status: {
              type: 'string',
              description: 'FHIR ValueSet status, e.g. active, draft, retired. Defaults to active.'
            },
            count: {
              type: 'number',
              description: 'Maximum results to return. Defaults to 10, max 50.'
            }
          },
          required: []
        }
      },
      {
        name: MCPToolNames.VALIDATE_VSAC,
        description: 'Use only for checking an exact VSAC canonical URL or id/OID that came from user input or existing CQL and has not already been established by vsac_search in this conversation. Never call validate_vsac for a candidate returned by vsac_search; search results are already authoritative. Never validate through SearXNG. If only a clinical topic/name is known, call vsac_search instead. After valid=true, proceed directly to the requested code edit using the returned exact canonical URL. VSAC credentials and base URL are injected by CQL Studio; do not ask the user for them.',
        statusMessage: 'Validating VSAC value set...',
        allowedInPlanMode: true,
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'Canonical ValueSet URL to validate.'
            },
            id: {
              type: 'string',
              description: 'ValueSet logical id or OID to validate. urn:oid: prefixes are accepted.'
            }
          },
          required: []
        }
      }
    ];
  }

  async executeTool(toolName: string, params: any): Promise<any> {
    const paramsForLog = this.sanitizeParamsForLog(params);
    logger.info({ toolName, params: paramsForLog }, 'MCP tool invoked');

    const start = Date.now();
    try {
      const result = await this.executeToolInternal(toolName, params);
      const durationMs = Date.now() - start;
      logger.info({ toolName, durationMs }, 'MCP tool completed');
      return result;
    } catch (err) {
      const durationMs = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      logger.info({ toolName, durationMs, message }, 'MCP tool failed');
      throw err;
    }
  }

  /** Truncate/sanitize params for logging to avoid huge payloads. */
  private sanitizeParamsForLog(params: any): Record<string, unknown> {
    if (params == null || typeof params !== 'object') return {};
    const out: Record<string, unknown> = {};
    const maxStr = 200;
    const maxArray = 5;
    for (const [k, v] of Object.entries(params)) {
      if (/password|api[_-]?key|token|secret/i.test(k)) out[k] = '[redacted]';
      else if (v == null) out[k] = v;
      else if (typeof v === 'string') out[k] = v.length <= maxStr ? v : v.slice(0, maxStr) + '...';
      else if (Array.isArray(v)) out[k] = v.length <= maxArray ? v : `[${v.length} items]`;
      else if (typeof v === 'object') out[k] = '[object]';
      else out[k] = v;
    }
    return out;
  }

  private async executeToolInternal(toolName: string, params: any): Promise<any> {
    switch (toolName) {
      case MCPToolNames.FETCH_CONTENT:
        return await this.executeFetchContent(params);
      case MCPToolNames.FETCH_URL:
        return await this.executeFetchUrl(params);
      case MCPToolNames.SEARXNG_SEARCH:
        return await this.executeSearXNGSearch(params);
      case MCPToolNames.SEARXNG_SEARCH_FORMATTED:
        return await this.executeSearXNGSearchFormatted(params);
      case MCPToolNames.SEARXNG_SEARCH_THEN_FETCH:
        return await this.executeSearXNGSearchThenFetch(params);
      case MCPToolNames.SEARXNG_SEARCH_THEN_FETCH_FORMATTED:
        return await this.executeSearXNGSearchThenFetchFormatted(params);
      case MCPToolNames.BATCH_FETCH:
        return await this.executeBatchFetch(params);
      case MCPToolNames.FETCH_METADATA:
        return await this.executeFetchMetadata(params);
      case MCPToolNames.FETCH_FEED:
        return await this.executeFetchFeed(params);
      case MCPToolNames.FETCH_CONTENT_AS_MARKDOWN:
        return await this.executeFetchContentAsMarkdown(params);
      case MCPToolNames.EXTRACT_LINKS:
        return await this.executeExtractLinks(params);
      case MCPToolNames.FETCH_SITEMAP:
        return await this.executeFetchSitemap(params);
      case MCPToolNames.GET_RATE_LIMIT_STATUS:
        return await this.executeGetRateLimitStatus(params);
      case MCPToolNames.VSAC_SEARCH:
        return await this.executeVsacSearch(params);
      case MCPToolNames.VALIDATE_VSAC:
        return await this.executeValidateVsac(params);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  private async executeFetchContent(params: any): Promise<string> {
    const { url } = params;
    if (!url || typeof url !== 'string') throw new Error('URL parameter is required and must be a string');
    return await this.webSearchService.fetchUrlFormatted(url);
  }

  private async executeFetchUrl(params: any): Promise<any> {
    const { url } = params;
    if (!url || typeof url !== 'string') throw new Error('URL parameter is required and must be a string');
    const result = await this.webSearchService.fetchUrl(url);
    return {
      url: result.url,
      title: result.title,
      contentLength: result.textContent.length,
      textContent: result.textContent.substring(0, 10000),
      hasMoreContent: result.textContent.length > 10000
    };
  }

  private async executeSearXNGSearch(params: any): Promise<any> {
    const { searxng_base_url, query, format, categories, language, pageno, time_range, safesearch, max_results = 10 } = params;
    if (!query || typeof query !== 'string') throw new Error('query is required and must be a string');
    if (!searxng_base_url || typeof searxng_base_url !== 'string' || !searxng_base_url.trim()) throw new Error('searxng_base_url is required and must be a non-empty string');
    const results = await this.searxngService.search({
      searxng_base_url: searxng_base_url.trim(),
      query: query.trim(),
      format: format || 'json',
      categories,
      language,
      pageno,
      time_range,
      safesearch,
      max_results
    });
    return {
      query,
      resultsCount: results.length,
      results: results.map((r) => ({ title: r.title, url: r.url, snippet: r.snippet || r.content || '' }))
    };
  }

  private async executeSearXNGSearchFormatted(params: any): Promise<string> {
    const { searxng_base_url, query, categories, language, pageno, time_range, safesearch, max_results = 10 } = params;
    if (!query || typeof query !== 'string') throw new Error('query is required and must be a string');
    if (!searxng_base_url || typeof searxng_base_url !== 'string' || !searxng_base_url.trim()) throw new Error('searxng_base_url is required and must be a non-empty string');
    return await this.searxngService.searchFormatted({
      searxng_base_url: searxng_base_url.trim(),
      query: query.trim(),
      format: 'json',
      categories,
      language,
      pageno,
      time_range,
      safesearch,
      max_results
    });
  }

  private async executeSearXNGSearchThenFetch(params: any): Promise<any[]> {
    const { searxng_base_url, query, max_results_to_fetch = 3, categories, language, time_range, safesearch } = params;
    if (!query || typeof query !== 'string') throw new Error('query is required and must be a string');
    if (!searxng_base_url || typeof searxng_base_url !== 'string' || !searxng_base_url.trim()) throw new Error('searxng_base_url is required and must be a non-empty string');
    const toFetch = Math.min(5, Math.max(1, Number(max_results_to_fetch) || 3));
    const results = await this.searxngService.search({
      searxng_base_url: searxng_base_url.trim(),
      query: query.trim(),
      format: 'json',
      categories,
      language,
      pageno: 1,
      time_range,
      safesearch,
      max_results: toFetch
    });
    const out: Array<{ url: string; title: string; snippet: string; content: string }> = [];
    for (const r of results) {
      if (!r.url) continue;
      try {
        const content = await this.webSearchService.fetchUrlFormatted(r.url);
        out.push({ url: r.url, title: r.title || 'No title', snippet: (r.snippet || r.content || '').substring(0, 500), content });
      } catch (err) {
        out.push({ url: r.url, title: r.title || 'No title', snippet: (r.snippet || r.content || '').substring(0, 500), content: `[Failed to fetch: ${err instanceof Error ? err.message : String(err)}]` });
      }
    }
    return out;
  }

  private async executeSearXNGSearchThenFetchFormatted(params: any): Promise<string> {
    const items = await this.executeSearXNGSearchThenFetch(params);
    return items.map((item, i) => `--- Result ${i + 1}: ${item.title} ---\nURL: ${item.url}\n\n${item.content}`).join('\n\n');
  }

  private async executeBatchFetch(params: any): Promise<any[]> {
    const { urls } = params;
    if (!Array.isArray(urls) || urls.length === 0) throw new Error('urls is required and must be a non-empty array of URL strings');
    const list = urls.slice(0, 10).filter((u: unknown) => typeof u === 'string' && (u as string).trim());
    if (list.length === 0) throw new Error('urls must contain at least one non-empty URL string');
    const out: any[] = [];
    for (const url of list) {
      try {
        const result = await this.webSearchService.fetchUrl(url);
        out.push({
          url: result.url,
          title: result.title,
          contentLength: result.textContent.length,
          textContent: result.textContent.substring(0, 10000),
          hasMoreContent: result.textContent.length > 10000
        });
      } catch (err) {
        out.push({ url: (url as string).trim(), error: err instanceof Error ? err.message : String(err) });
      }
    }
    return out;
  }

  private async executeFetchMetadata(params: any): Promise<any> {
    const { url } = params;
    if (!url || typeof url !== 'string') throw new Error('url is required and must be a string');
    return await this.webSearchService.fetchMetadata(url);
  }

  private async executeFetchFeed(params: any): Promise<any> {
    const { url } = params;
    if (!url || typeof url !== 'string') throw new Error('url is required and must be a string');
    return await this.webSearchService.fetchFeed(url);
  }

  private async executeFetchContentAsMarkdown(params: any): Promise<string> {
    const { url } = params;
    if (!url || typeof url !== 'string') throw new Error('url is required and must be a string');
    return await this.webSearchService.fetchUrlAsMarkdown(url);
  }

  private async executeExtractLinks(params: any): Promise<any[]> {
    const { url, same_domain_only } = params;
    if (!url || typeof url !== 'string') throw new Error('url is required and must be a string');
    return await this.webSearchService.extractLinks(url, Boolean(same_domain_only));
  }

  private async executeFetchSitemap(params: any): Promise<any> {
    const { url, expand_index } = params;
    if (!url || typeof url !== 'string') throw new Error('url is required and must be a string');
    return await this.webSearchService.fetchSitemap(url, Boolean(expand_index));
  }

  private async executeGetRateLimitStatus(_params: any): Promise<any> {
    return {
      fetch_remaining: this.webSearchService.getRemainingFetchTokens(),
      searxng_remaining: this.searxngService.getRemainingSearchTokens()
    };
  }

  private getVsacConfig(params: any): VsacToolConfig {
    const fhirBaseRaw =
      typeof params?.vsac_fhir_base_url === 'string' && params.vsac_fhir_base_url.trim()
        ? params.vsac_fhir_base_url.trim()
        : DEFAULT_VSAC_FHIR_BASE;
    const base = new URL(fhirBaseRaw.replace(/\/+$/, ''));
    if (base.protocol !== 'https:' || !ALLOWED_VSAC_HOSTS.has(base.hostname)) {
      throw new Error('Invalid VSAC FHIR base URL. Only NLM CTS hosts are allowed.');
    }
    const username =
      typeof params?.vsac_api_username === 'string' && params.vsac_api_username.trim()
        ? params.vsac_api_username.trim()
        : 'apikey';
    const password = typeof params?.vsac_api_password === 'string' ? params.vsac_api_password.trim() : '';
    if (!password) {
      throw new Error('VSAC UMLS API key is required. Configure it in CQL Studio Settings.');
    }
    return {
      fhirBaseUrl: base.toString().replace(/\/+$/, ''),
      username,
      password
    };
  }

  private vsacHeaders(config: VsacToolConfig): Record<string, string> {
    const token = Buffer.from(`${config.username}:${config.password}`).toString('base64');
    return {
      Accept: FHIR_JSON,
      'Content-Type': FHIR_JSON,
      Authorization: `Basic ${token}`
    };
  }

  private async fetchVsacJson<T>(config: VsacToolConfig, pathAndQuery: string): Promise<T> {
    const path = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`;
    const response = await fetch(`${config.fhirBaseUrl}${path}`, {
      method: 'GET',
      headers: this.vsacHeaders(config)
    });
    if (!response.ok) {
      let detail = response.statusText;
      try {
        const body = await response.text();
        if (body) detail = body.substring(0, 500);
      } catch {
        // Keep status text.
      }
      throw new Error(`VSAC request failed (${response.status}): ${detail}`);
    }
    return (await response.json()) as T;
  }

  private async fetchVsacJsonOrNull<T>(config: VsacToolConfig, pathAndQuery: string): Promise<T | null> {
    try {
      return await this.fetchVsacJson<T>(config, pathAndQuery);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('VSAC request failed (404):')) {
        return null;
      }
      throw error;
    }
  }

  private summarizeValueSet(vs: any): VsacValueSetSummary {
    return {
      resourceType: 'ValueSet',
      id: typeof vs?.id === 'string' ? vs.id : undefined,
      url: typeof vs?.url === 'string' ? vs.url : undefined,
      name: typeof vs?.name === 'string' ? vs.name : undefined,
      title: typeof vs?.title === 'string' ? vs.title : undefined,
      version: typeof vs?.version === 'string' ? vs.version : undefined,
      status: typeof vs?.status === 'string' ? vs.status : undefined,
      publisher: typeof vs?.publisher === 'string' ? vs.publisher : undefined,
      date: typeof vs?.date === 'string' ? vs.date : undefined,
      description: typeof vs?.description === 'string' ? vs.description : undefined,
      expansionTotal: typeof vs?.expansion?.total === 'number' ? vs.expansion.total : undefined
    };
  }

  private cqlSnippetForValueSet(vs: any): string | null {
    if (!vs?.url || typeof vs.url !== 'string') return null;
    const label = String(vs.title || vs.name || vs.id || 'VSAC ValueSet').replace(/"/g, '\\"');
    return `valueset "${label}": '${vs.url}'`;
  }

  private async fetchVsacValueSetByIdOrUrl(config: VsacToolConfig, params: any): Promise<any | null> {
    const url = typeof params?.url === 'string' ? params.url.trim() : '';
    const idRaw = typeof params?.id === 'string' ? params.id.trim() : '';
    if (url) {
      const q = new URLSearchParams();
      q.set('url', url);
      q.set('_count', '1');
      const bundle = await this.fetchVsacJson<any>(config, `/ValueSet?${q.toString()}`);
      const first = bundle?.entry?.[0]?.resource;
      return first?.resourceType === 'ValueSet' ? first : null;
    }
    if (idRaw) {
      const id = idRaw.replace(/^urn:oid:/i, '');
      return await this.fetchVsacJsonOrNull<any>(config, `/ValueSet/${encodeURIComponent(id)}`);
    }
    throw new Error('Either url or id is required.');
  }

  private async executeVsacSearch(params: any): Promise<any> {
    const config = this.getVsacConfig(params);
    const q = new URLSearchParams();
    const query = typeof params?.query === 'string' ? params.query.trim() : '';
    const title = typeof params?.title === 'string' ? params.title.trim() : '';
    const name = typeof params?.name === 'string' ? params.name.trim() : '';
    const url = typeof params?.url === 'string' ? params.url.trim() : '';
    const identifier = typeof params?.identifier === 'string' ? params.identifier.trim() : '';
    const status = typeof params?.status === 'string' ? params.status.trim() : 'active';
    const count = Math.min(50, Math.max(1, Number(params?.count) || 10));

    if (!query && !title && !name && !url && !identifier) {
      throw new Error('vsac_search requires query, title, name, url, or identifier.');
    }

    if (title || query) q.set('title:contains', title || query);
    if (name) q.set('name:contains', name);
    if (url) q.set('url', url);
    if (identifier) q.set('identifier', identifier);
    if (status) q.set('status', status);
    q.set('_count', String(count));

    const bundle = await this.fetchVsacJson<any>(config, `/ValueSet?${q.toString()}`);
    const valueSets = Array.isArray(bundle?.entry)
      ? bundle.entry.map((entry: any) => entry?.resource).filter((resource: any) => resource?.resourceType === 'ValueSet')
      : [];
    return {
      query: { query, title, name, url, identifier, status, count },
      total: typeof bundle?.total === 'number' ? bundle.total : undefined,
      resultsCount: valueSets.length,
      results: valueSets.map((vs: any) => ({
        ...this.summarizeValueSet(vs),
        canonicalUrl: typeof vs?.url === 'string' ? vs.url : undefined,
        cqlDeclaration: this.cqlSnippetForValueSet(vs),
        cqlSnippet: this.cqlSnippetForValueSet(vs)
      })),
      codeGenerationInstruction: 'These results are authoritative; do not call validate_vsac. Choose the best match and proceed directly to the code edit, copying its canonicalUrl exactly. Do not construct, shorten, normalize, or guess a different VSAC URL or OID.'
    };
  }

  private async executeValidateVsac(params: any): Promise<any> {
    const config = this.getVsacConfig(params);
    const valueSet = await this.fetchVsacValueSetByIdOrUrl(config, params);
    if (!valueSet) {
      return {
        valid: false,
        message: 'No VSAC ValueSet found for the provided reference.'
      };
    }
    return {
      valid: true,
      valueSet: this.summarizeValueSet(valueSet),
      canonicalUrl: valueSet.url,
      cqlDeclaration: this.cqlSnippetForValueSet(valueSet),
      cqlSnippet: this.cqlSnippetForValueSet(valueSet),
      codeGenerationInstruction: 'Copy canonicalUrl exactly into the CQL declaration. Do not construct, shorten, normalize, or guess a different VSAC URL or OID.'
    };
  }

}
