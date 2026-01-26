// Author: Preston Lee

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    environmentOptions: {
      jsdom: {
        resources: 'usable',
      },
    },
  },
});
