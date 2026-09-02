// Author: Preston Lee

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveUiReturnUrl, sanitizeReturnToPath } from '../src/auth/routes.ts';

describe('sanitizeReturnToPath', () => {
  it('allows path-only UI routes', () => {
    assert.equal(sanitizeReturnToPath('/'), '/');
    assert.equal(sanitizeReturnToPath('/team/dashboard'), '/team/dashboard');
    assert.equal(sanitizeReturnToPath('/team/workspaces?x=1'), '/team/workspaces?x=1');
  });

  it('rejects open redirects and absolute URLs', () => {
    assert.equal(sanitizeReturnToPath('//evil.example'), '/');
    assert.equal(sanitizeReturnToPath('https://evil.example/'), '/');
    assert.equal(sanitizeReturnToPath('\\evil'), '/');
    assert.equal(sanitizeReturnToPath('team'), '/');
    assert.equal(sanitizeReturnToPath(undefined), '/');
  });
});

describe('resolveUiReturnUrl', () => {
  it('joins the UI base URL with a safe path', () => {
    assert.equal(
      resolveUiReturnUrl('http://localhost:4200/', '/team/dashboard'),
      'http://localhost:4200/team/dashboard'
    );
    assert.equal(resolveUiReturnUrl('https://studio.example.org', '//evil'), 'https://studio.example.org/');
  });
});
