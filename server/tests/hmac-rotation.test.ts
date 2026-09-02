// Author: Preston Lee

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hmacSign, hmacVerify, parsePreviousSecrets } from '../src/auth/hmac.js';

describe('hmac key rotation', () => {
  it('signs and verifies with the current secret', () => {
    const signed = hmacSign('session-id', 'current');
    const result = hmacVerify(signed, ['current']);
    assert.ok(result);
    assert.equal(result.payload, 'session-id');
    assert.equal(result.usedPreviousSecret, false);
  });

  it('verifies cookies signed with a previous secret', () => {
    const signed = hmacSign('session-id', 'old-secret');
    const result = hmacVerify(signed, ['current', 'old-secret']);
    assert.ok(result);
    assert.equal(result.payload, 'session-id');
    assert.equal(result.usedPreviousSecret, true);
  });

  it('rejects cookies when no secret matches', () => {
    const signed = hmacSign('session-id', 'unknown');
    assert.equal(hmacVerify(signed, ['current', 'previous']), null);
  });

  it('prefers the current secret when both would match the same payload shape', () => {
    const signed = hmacSign('abc', 'current');
    const result = hmacVerify(signed, ['current', 'previous']);
    assert.ok(result);
    assert.equal(result.usedPreviousSecret, false);
  });

  it('parses previous secrets and drops duplicates of current', () => {
    assert.deepEqual(parsePreviousSecrets('a', 'b, c  a,,b'), ['b', 'c']);
    assert.deepEqual(parsePreviousSecrets('only', ''), []);
    assert.deepEqual(parsePreviousSecrets('only', undefined), []);
  });
});
