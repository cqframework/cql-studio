// Author: Preston Lee

import crypto from 'node:crypto';

/**
 * HMAC-SHA256 sign a payload; returns `payload.signature` (base64url).
 */
export function hmacSign(payload: string, secret: string): string {
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export interface HmacVerifyResult {
  payload: string;
  /** True when the matching secret was not the primary (index 0) signing secret. */
  usedPreviousSecret: boolean;
}

/**
 * Verify `payload.signature` against secrets in order (primary first).
 * Returns null if no secret matches.
 */
export function hmacVerify(cookieValue: string, secrets: readonly string[]): HmacVerifyResult | null {
  const dot = cookieValue.lastIndexOf('.');
  if (dot <= 0 || dot === cookieValue.length - 1) {
    return null;
  }
  const payload = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  const sigBuf = Buffer.from(sig);

  for (let i = 0; i < secrets.length; i++) {
    const expected = crypto.createHmac('sha256', secrets[i]).update(payload).digest('base64url');
    const expectedBuf = Buffer.from(expected);
    if (sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return { payload, usedPreviousSecret: i > 0 };
    }
  }
  return null;
}

/**
 * Parse a comma/whitespace-separated previous-secrets list, dropping empties and
 * duplicates of the current secret.
 */
export function parsePreviousSecrets(current: string, raw: string | undefined): string[] {
  if (!raw?.trim()) {
    return [];
  }
  const seen = new Set<string>([current]);
  const previous: string[] = [];
  for (const part of raw.split(/[,\s]+/)) {
    const secret = part.trim();
    if (!secret || seen.has(secret)) {
      continue;
    }
    seen.add(secret);
    previous.push(secret);
  }
  return previous;
}
