// Author: Preston Lee

export interface MCPToolProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: { type: string };
  default?: unknown;
}

export interface MCPToolParameters {
  type: string;
  properties: Record<string, MCPToolProperty>;
  required?: string[];
}

export interface MCPTool {
  name: string;
  description: string;
  /** User-facing message shown while the tool is executing */
  statusMessage?: string;
  /** If true, tool is read-only and allowed in Plan Mode. If false, tool modifies state and is blocked. */
  allowedInPlanMode?: boolean;
  parameters: MCPToolParameters;
}

export class MCPToolNames {
  static readonly FETCH_CONTENT = 'fetch_content';
  static readonly FETCH_URL = 'fetch_url';
  static readonly SEARXNG_SEARCH = 'searxng_search';
  static readonly SEARXNG_SEARCH_FORMATTED = 'searxng_search_formatted';
  static readonly SEARXNG_SEARCH_THEN_FETCH = 'searxng_search_then_fetch';
  static readonly SEARXNG_SEARCH_THEN_FETCH_FORMATTED = 'searxng_search_then_fetch_formatted';
  static readonly BATCH_FETCH = 'batch_fetch';
  static readonly FETCH_METADATA = 'fetch_metadata';
  static readonly FETCH_FEED = 'fetch_feed';
  static readonly FETCH_CONTENT_AS_MARKDOWN = 'fetch_content_as_markdown';
  static readonly EXTRACT_LINKS = 'extract_links';
  static readonly FETCH_SITEMAP = 'fetch_sitemap';
  static readonly GET_RATE_LIMIT_STATUS = 'get_rate_limit_status';
  static readonly VSAC_SEARCH = 'vsac_search';
  static readonly VALIDATE_VSAC = 'validate_vsac';
}
