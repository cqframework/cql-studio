// Author: Preston Lee

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

function blockedIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(value => !Number.isInteger(value))) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224;
}

function blockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0];
  return normalized === '::' || normalized === '::1' ||
    normalized.startsWith('fc') || normalized.startsWith('fd') ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith('ff') ||
    normalized.startsWith('::ffff:127.') ||
    normalized.startsWith('::ffff:10.') ||
    normalized.startsWith('::ffff:192.168.');
}

export function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  return version === 4 ? blockedIpv4(address) : version === 6 ? blockedIpv6(address) : true;
}

export async function assertSafePublicUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only HTTP and HTTPS URLs are allowed');
  if (url.username || url.password) throw new Error('URLs containing credentials are not allowed');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === 'metadata.google.internal') {
    throw new Error('Local, private, and metadata network targets are not allowed');
  }
  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(result => isBlockedAddress(result.address))) {
    throw new Error('Local, private, and metadata network targets are not allowed');
  }
  return url;
}
