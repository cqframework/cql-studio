// Author: Preston Lee

export interface FetchResult {
  url: string;
  title: string;
  content: string;
  textContent: string;
}

export interface FetchMetadataResult {
  finalUrl: string;
  statusCode: number;
  contentType: string;
  title?: string;
  description?: string;
  imageUrl?: string;
}

export interface FeedEntry {
  title: string;
  link: string;
  summary: string;
  date?: string;
}

export interface FetchFeedResult {
  title: string;
  link: string;
  description?: string;
  entries: FeedEntry[];
}

export interface ExtractedLink {
  href: string;
  text: string;
}

export interface SitemapUrl {
  loc: string;
  lastmod?: string;
  changefreq?: string;
  priority?: string;
}

export interface FetchSitemapResult {
  type: 'urlset' | 'sitemapindex';
  url?: string;
  urls?: SitemapUrl[];
  sitemaps?: Array<{ loc: string; lastmod?: string }>;
}
