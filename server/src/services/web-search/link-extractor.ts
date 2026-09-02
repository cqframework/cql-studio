// Author: Preston Lee

import * as cheerio from 'cheerio';
import type { ExtractedLink } from './types.js';

const SKIP_PREFIXES = ['#', 'javascript:', 'mailto:', 'tel:'];

export function extractLinksFromHtml(
  html: string,
  finalUrl: string,
  sameDomainOnly: boolean
): ExtractedLink[] {
  const $ = cheerio.load(html);
  const base = new URL(finalUrl);
  const links: ExtractedLink[] = [];
  const seen = new Set<string>();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')?.trim();
    if (!href || SKIP_PREFIXES.some((p) => href.startsWith(p))) return;
    let absolute: string;
    try {
      absolute = new URL(href, base).href;
    } catch {
      return;
    }
    if (sameDomainOnly && new URL(absolute).origin !== base.origin) return;
    if (seen.has(absolute)) return;
    seen.add(absolute);
    const text = $(el).text().trim().substring(0, 200);
    links.push({ href: absolute, text: text || absolute });
  });

  return links;
}
