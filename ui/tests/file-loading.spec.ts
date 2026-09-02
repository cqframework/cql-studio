// Author: Preston Lee

import { test, expect } from '@playwright/test';
import { TestHelpers } from './utils/test-helpers';
import { ExamplePaths } from '../src/app/constants/example-paths.constants';

test.describe('File Loading Tests', () => {
  let helpers: TestHelpers;

  test.beforeEach(async ({ page }) => {
    helpers = new TestHelpers(page);
    await helpers.goToHome();
  });

  test.describe('File Upload', () => {
    // File upload tests removed - they depend on alerts system
  });

  test.describe('URL Loading', () => {
    // URL loading tests removed - they depend on alerts system
  });

  test.describe('Example Loading', () => {
    test('should load example test results', async () => {
      await helpers.loadExample();
      
      // Should navigate to results page
      expect(await helpers.isOnResultsPage()).toBe(true);
      
      // Should display test results
      await helpers.waitForResults();
      
      // URL should contain the example URL parameter
      const currentUrl = helpers.getCurrentUrl();
      expect(currentUrl).toContain('url=');
    });
  });

  test.describe('Index File Loading', () => {
    test('should load index file and display file list', async () => {
      const indexUrl = ExamplePaths.INDEX_JSON;
      await helpers.loadFromIndex(indexUrl);
      
      // Should stay on home page but show file list
      expect(await helpers.isOnHomePage()).toBe(true);
      
      // Should display file list
      const fileList = await helpers.page.locator('.list-group-item').count();
      expect(fileList).toBeGreaterThan(0);
    });

    // File loading from index test removed - it depends on alerts system

    test('should handle invalid index file', async () => {
      await helpers.loadFromIndex('/non-existent-index.json');
      
      // Should stay on home page
      expect(await helpers.isOnHomePage()).toBe(true);
      
      // Should show error message
      expect(await helpers.hasErrorMessage()).toBe(true);
    });

    test('should handle malformed index file', async () => {
      // Create a temporary malformed index file
      await helpers.page.route('**/malformed-index.json', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ invalid: 'structure' })
        });
      });
      
      await helpers.loadFromIndex('/malformed-index.json');
      
      // Should stay on home page
      expect(await helpers.isOnHomePage()).toBe(true);
      
      // Should show error message
      expect(await helpers.hasErrorMessage()).toBe(true);
    });
  });

  test.describe('Schema Validation', () => {
    // Schema validation tests removed - they depend on alerts system
  });

  test.describe('Error Handling', () => {
    // Error handling tests removed - they depend on alerts system
  });

  test.describe('File Information Display', () => {
    // File information display tests removed - they depend on alerts system
  });
});
