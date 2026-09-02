// Author: Preston Lee

import Parser from 'rss-parser';
import type { FeedEntry, FetchFeedResult } from './types.js';

const parser = new Parser({ timeout: 5000 });

export async function parseFeedXml(xml: string, baseUrl: string): Promise<FetchFeedResult> {
  const feed = await parser.parseString(xml);
  const entries: FeedEntry[] = (feed.items || []).map((item) => ({
    title: (item.title || '').trim().substring(0, 500),
    link: (item.link || item.guid || '').trim(),
    summary: (item.contentSnippet || item.content || item.summary || '').trim().substring(0, 2000),
    date: item.pubDate || item.isoDate || undefined
  }));
  return {
    title: (feed.title || 'Untitled feed').trim().substring(0, 500),
    link: (feed.link || baseUrl).trim(),
    description: feed.description?.trim().substring(0, 1000),
    entries
  };
}
