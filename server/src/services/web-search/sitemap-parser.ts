// Author: Preston Lee

import { XMLParser } from 'fast-xml-parser';
import type { FetchSitemapResult, SitemapUrl } from './types.js';

function getStr(v: unknown): string | undefined {
  return typeof v === 'string'
    ? v
    : v && typeof v === 'object' && '#text' in v
      ? (v as Record<string, string>)['#text']
      : undefined;
}

function toUrlList(urlset: Record<string, unknown>): SitemapUrl[] {
  const url = (urlset as Record<string, unknown>).url;
  const urlList = Array.isArray(url) ? url : url ? [url] : [];
  return urlList
    .map((u: Record<string, unknown>) => {
      const loc = getStr(u.loc) ?? '';
      return {
        loc: String(loc || ''),
        lastmod: getStr(u.lastmod),
        changefreq: getStr(u.changefreq),
        priority: getStr(u.priority)
      };
    })
    .filter((u) => u.loc);
}

function toSitemapEntries(sitemapindex: Record<string, unknown>): Array<{ loc: string; lastmod?: string }> {
  const sitemap = (sitemapindex as Record<string, unknown>).sitemap;
  const list = Array.isArray(sitemap) ? sitemap : sitemap ? [sitemap] : [];
  return list
    .map((s: Record<string, unknown>) => {
      const locRaw = s.loc;
      const loc =
        typeof locRaw === 'string'
          ? locRaw
          : locRaw && typeof locRaw === 'object' && '#text' in locRaw
            ? (locRaw as Record<string, string>)['#text']
            : '';
      const lastmodRaw = s.lastmod;
      const lastmod =
        typeof lastmodRaw === 'string'
          ? lastmodRaw
          : lastmodRaw && typeof lastmodRaw === 'object' && '#text' in lastmodRaw
            ? (lastmodRaw as Record<string, string>)['#text']
            : undefined;
      return typeof loc === 'string' && loc ? { loc, lastmod } : null;
    })
    .filter(Boolean) as Array<{ loc: string; lastmod?: string }>;
}

export function parseSitemapXml(xml: string): Omit<FetchSitemapResult, 'url'> {
  const xmlParser = new XMLParser({ ignoreDeclaration: true });
  const obj = xmlParser.parse(xml) as Record<string, unknown>;
  const rootKey = Object.keys(obj)[0];
  const urlset =
    obj.urlset ??
    obj['urlset'] ??
    (rootKey && /urlset/i.test(rootKey) ? obj[rootKey] : undefined);
  const sitemapindex =
    obj.sitemapindex ??
    obj['sitemapindex'] ??
    (rootKey && /sitemapindex/i.test(rootKey) ? obj[rootKey] : undefined);

  if (sitemapindex && typeof sitemapindex === 'object') {
    const sitemaps = toSitemapEntries(sitemapindex as Record<string, unknown>);
    return { type: 'sitemapindex', sitemaps };
  }

  if (urlset && typeof urlset === 'object') {
    const urls = toUrlList(urlset as Record<string, unknown>);
    return { type: 'urlset', urls };
  }

  return { type: 'urlset', urls: [] };
}
