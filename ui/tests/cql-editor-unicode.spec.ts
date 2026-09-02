// Author: Preston Lee

import { test, expect } from '@playwright/test';

test.describe('CQL editor Unicode paste', () => {
  test('remains responsive after pasting em dash', async ({ page }) => {
    await page.goto('/ide');
    await page.waitForLoadState('networkidle');

    const editor = page.locator('.cm-content').first();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await editor.click();

    await page.keyboard.insertText('define "Test": 1 — 2');
    await page.keyboard.type(' ');

    await expect(editor).toBeVisible();
    const content = await editor.innerText();
    expect(content).toContain('—');
  });
});
