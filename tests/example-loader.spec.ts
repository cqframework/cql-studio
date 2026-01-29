// Author: Preston Lee

import { test, expect } from '@playwright/test';

test.describe('Example Loader', () => {
  test('should show FHIR R4 example measures and their Library deps in load order', async ({
    page,
  }) => {
    await page.goto('/loader');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('app-example-loader')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Example Loader/i })).toBeVisible();

    await page.waitForSelector('.list-group-item.example-file-item', { timeout: 15000 });
    await expect(page.locator('.spinner-border').first()).not.toBeVisible({ timeout: 10000 });

    const items = page.locator('.example-file-item label.form-check-label');
    const count = await items.count();
    expect(count).toBe(11);

    const filenames: string[] = [];
    for (let i = 0; i < count; i++) {
      const text = await items.nth(i).textContent();
      if (text?.trim()) filenames.push(text.trim());
    }

    const indexOf = (name: string) => {
      const i = filenames.findIndex((f) => f === name || f.endsWith(name));
      return i >= 0 ? i : -1;
    };

    expect(indexOf('library-quick-model-definition.json')).toBeGreaterThanOrEqual(0);
    expect(indexOf('library-cms146-example.json')).toBeGreaterThanOrEqual(0);
    expect(indexOf('library-exclusive-breastfeeding-cqm-logic.json')).toBeGreaterThanOrEqual(0);
    expect(indexOf('library-hiv-indicators.json')).toBeGreaterThanOrEqual(0);

    const quickIdx = indexOf('library-quick-model-definition.json');
    const cms146Idx = indexOf('library-cms146-example.json');
    expect(quickIdx).toBeLessThan(cms146Idx);

    const libCqmIdx = indexOf('library-exclusive-breastfeeding-cqm-logic.json');
    const measureEbfIdx = indexOf('measure-exclusive-breastfeeding.json');
    expect(libCqmIdx).toBeLessThan(measureEbfIdx);
  });
});
