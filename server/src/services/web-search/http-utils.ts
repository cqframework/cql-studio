// Author: Preston Lee

import fetch from 'node-fetch';
import { logger } from '../../logger.js';

export const DEFAULT_FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9'
};

export function cleanUrl(url: string): string {
  if (!url) return url;
  try {
    const urlObj = new URL(url);
    return urlObj.href;
  } catch {
    return url;
  }
}

export async function fetchWithTimeout(
  url: string,
  options: { headers?: Record<string, string>; redirect?: 'follow' } & Record<string, unknown>,
  timeoutMs: number
): Promise<Awaited<ReturnType<typeof fetch>>> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      headers: options.headers ?? DEFAULT_FETCH_HEADERS,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

/** Follow HTTP 300 redirect manually if present. Returns the final response. */
export async function follow300Redirect(
  response: Awaited<ReturnType<typeof fetch>>,
  originalUrl: string,
  timeoutMs: number
): Promise<Awaited<ReturnType<typeof fetch>>> {
  if (response.status !== 300) return response;
  const location = response.headers.get('Location');
  if (!location) throw new Error('HTTP 300: Multiple Choices - No Location header provided');
  const redirectUrl = new URL(location, originalUrl).href;
  logger.info({ redirectUrl }, 'WebSearch HTTP 300 redirect; following Location header');
  return fetchWithTimeout(redirectUrl, { redirect: 'follow' }, timeoutMs);
}
