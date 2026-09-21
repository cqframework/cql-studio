// Author: Preston Lee

import { test, expect } from '@playwright/test';

test.describe('CQL Debugger', () => {
  test('Debug button and Inspector are available in the IDE', async ({ page }) => {
    await page.goto('/ide');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.ide-panel-tab', { hasText: 'Inspector' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('#cql-editor-debug-btn')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#cql-editor-execute-btn')).toBeVisible();
    await page.locator('.ide-panel-tab', { hasText: 'Inspector' }).click();
    await expect(page.locator('#cql-inspector-step-out-btn')).toBeVisible();
  });
});
