// Author: Preston Lee

import * as cheerio from 'cheerio';

const MAX_HEAD_BYTES = 150000;

export interface ParsedMetadata {
  title?: string;
  description?: string;
  imageUrl?: string;
}

export function parseMetadataFromHtml(html: string, finalUrl: string): ParsedMetadata {
  const headAndSome = html.substring(0, MAX_HEAD_BYTES);
  const $ = cheerio.load(headAndSome);
  const title =
    $('meta[property="og:title"]').attr('content')?.trim() ||
    $('meta[name="twitter:title"]').attr('content')?.trim() ||
    $('title').first().text().trim() ||
    undefined;
  const description =
    $('meta[property="og:description"]').attr('content')?.trim() ||
    $('meta[name="twitter:description"]').attr('content')?.trim() ||
    $('meta[name="description"]').attr('content')?.trim() ||
    undefined;
  const img =
    $('meta[property="og:image"]').attr('content') ||
    $('meta[name="twitter:image"]').attr('content');
  const imageUrl = img ? (img.startsWith('http') ? img : new URL(img, finalUrl).href) : undefined;
  return { title, description, imageUrl };
}
