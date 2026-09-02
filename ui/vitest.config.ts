// Author: Preston Lee

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'src/app/services/**/*.spec.ts',
      'src/app/components/**/*.spec.ts',
      'tests/unit/**/*.spec.ts',
    ],
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
