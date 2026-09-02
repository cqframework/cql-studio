// Author: Preston Lee

import * as cheerio from 'cheerio';

const MAX_TITLE_LEN = 500;
const MAX_TEXT_LEN = 50000;

export interface ParsedHtmlContent {
  title: string;
  content: string;
  textContent: string;
}

export function parseHtmlToContent(html: string, finalUrl: string): ParsedHtmlContent {
  const $ = cheerio.load(html);

  $('script, style, noscript, nav, header, footer, aside, .advertisement, .ads, [class*="ad-"], [class*="advertisement"], [id*="ad-"], [id*="advertisement"]').remove();
  $.root().find('*').contents().filter(function (this: { nodeType: number }) {
    return this.nodeType === 8;
  }).remove();

  const title =
    $('title').text().trim() ||
    $('h1').first().text().trim() ||
    $('meta[property="og:title"]').attr('content') ||
    $('meta[name="twitter:title"]').attr('content') ||
    finalUrl.split('/').pop()?.split('?')[0] ||
    finalUrl;

  let mainContent = $('main, article, [role="main"]').first();
  if (mainContent.length === 0) {
    mainContent = $('.content, .main-content, .post-content, .entry-content, .article-content').first();
  }
  if (mainContent.length === 0) {
    mainContent = $('body');
    mainContent.find('nav, header, footer').remove();
  }

  let textContent = mainContent
    .text()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.length > 2)
    .filter((line) => !/^(cookie|privacy|terms|skip|menu|search|login|register)$/i.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (textContent.length > MAX_TEXT_LEN) {
    const truncated = textContent.substring(0, MAX_TEXT_LEN);
    const lastSentence = truncated.lastIndexOf('.');
    const lastParagraph = truncated.lastIndexOf('\n\n');
    const cutPoint = Math.max(lastSentence, lastParagraph);
    textContent = truncated.substring(0, cutPoint > 40000 ? cutPoint : MAX_TEXT_LEN) + '\n\n[Content truncated...]';
  }

  return {
    title: title.substring(0, MAX_TITLE_LEN),
    content: mainContent.html() || '',
    textContent
  };
}
