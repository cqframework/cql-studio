// Author: Preston Lee

import assert from 'node:assert/strict';
import test from 'node:test';
import { createCorsOptions } from '../src/config/cors.js';

test('credentialed browser APIs use the configured origin instead of a wildcard', () => {
  assert.deepEqual(createCorsOptions({ corsOrigin: 'http://localhost:4200' }), {
    origin: 'http://localhost:4200',
    credentials: true,
    optionsSuccessStatus: 200,
  });
});
