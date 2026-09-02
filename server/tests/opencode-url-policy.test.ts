// Author: Preston Lee

import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSafePublicUrl, isBlockedAddress } from '../src/services/web-search/url-policy.js';

test('OpenCode web fetch URL policy blocks local, private, metadata, and credentialed targets', async () => {
  for (const url of [
    'http://localhost:3000/secret',
    'http://127.0.0.1/secret',
    'http://10.0.0.1/secret',
    'http://169.254.169.254/latest/meta-data',
    'http://user:password@example.com/',
  ]) {
    await assert.rejects(assertSafePublicUrl(url));
  }
  assert.equal(isBlockedAddress('192.168.1.10'), true);
  assert.equal(isBlockedAddress('8.8.8.8'), false);
});
