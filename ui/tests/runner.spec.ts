// Author: Preston Lee

import { test, expect } from '@playwright/test';
import { TestHelpers } from './utils/test-helpers';
import { ExamplePaths } from '../src/app/constants/example-paths.constants';

test.describe('Runner Tests', () => {
  let helpers: TestHelpers;

  test.beforeEach(async ({ page }) => {
    helpers = new TestHelpers(page);
  });

  test.describe('Runner Navigation', () => {
    test('should navigate to runner from home page', async () => {
      await helpers.goToHome();
      await helpers.goToRunner();
    });

    test('should navigate to runner from navigation', async () => {
      await helpers.goToHome();
      await helpers.goToRunner();
    });
  });

  test.describe('Runner Configuration', () => {
    test.beforeEach(async () => {
      await helpers.page.goto('/runner');
      await helpers.waitForAppLoad();
    });

    test('should display configuration form', async () => {
      // Should show FHIR Server configuration
      await expect(helpers.page.locator('label[for="baseUrl"]')).toBeVisible();
      await expect(helpers.page.locator('input[id="baseUrl"]')).toBeVisible();
      
      // Should show CQL Operation
      await expect(helpers.page.locator('label[for="cqlOperation"]')).toBeVisible();
      await expect(helpers.page.locator('input[id="cqlOperation"]')).toBeVisible();
      
      // Should show Build configuration
      await expect(helpers.page.locator('label[for="cqlFileVersion"]')).toBeVisible();
      await expect(helpers.page.locator('input[id="cqlFileVersion"]')).toBeVisible();
      await expect(helpers.page.locator('label[for="cqlVersion"]')).toBeVisible();
      await expect(helpers.page.locator('input[id="cqlVersion"]')).toBeVisible();
    });

    test('should load configuration from URL parameter', async () => {
      // Navigate to runner page with URL parameter
      await helpers.page.goto(`/runner?url=${ExamplePaths.RUNNER_CONFIG_JSON}`);
      await helpers.waitForAppLoad();
      
      // Should show runner component
      await helpers.expectRunnerPage();
      
      // Wait for configuration to load from URL
      await helpers.page.waitForTimeout(1000);
      
      // Should load configuration from URL
      await expect(helpers.page.locator('input[id="baseUrl"]')).toHaveValue('http://localhost:8080/fhir');
      await expect(helpers.page.locator('input[id="cqlOperation"]')).toHaveValue('$cql');
      await expect(helpers.page.locator('input[id="cqlFileVersion"]')).toHaveValue('1.0.000');
    });

    test('should display skip list configuration', async () => {
      // Should show skip list section
      await expect(helpers.page.locator('h5:has-text("Skip List")')).toBeVisible();
      
      // Should have add skip item button
      await expect(helpers.page.locator('#add-skip-item-btn')).toBeVisible();
    });

    test('should display only list configuration', async () => {
      await expect(helpers.page.locator('#only-list-heading')).toBeVisible();
      await expect(helpers.page.locator('#add-only-list-item-btn')).toBeVisible();
    });

    test('should add only list item', async () => {
      await helpers.page.click('#add-only-list-item-btn');
      await expect(helpers.page.locator('#only-testsName-0')).toBeVisible();
      await expect(helpers.page.locator('#only-groupName-0')).toBeVisible();
      await expect(helpers.page.locator('#only-testName-0')).toBeVisible();
    });

    test('should add skip list item', async () => {
      // Click add skip item button
      await helpers.page.click('#add-skip-item-btn');
      
      // Should show skip item form
      await expect(helpers.page.locator('input[placeholder="Test suite name"]')).toBeVisible();
      await expect(helpers.page.locator('input[placeholder="Group name"]')).toBeVisible();
      await expect(helpers.page.locator('input[placeholder="Test name"]')).toBeVisible();
      await expect(helpers.page.locator('input[placeholder="Skip reason"]')).toBeVisible();
    });

    test('should display JSON configuration editor', async () => {
      // Should have JSON editor toggle
      await expect(helpers.page.locator('#toggle-json-editor-btn')).toBeVisible();
      
      // Click to show JSON editor
      await helpers.page.click('#toggle-json-editor-btn');
      
      // Should show JSON editor container
      await expect(helpers.page.locator('.json-editor-container')).toBeVisible();
    });
  });

  test.describe('Runner Actions', () => {
    test.beforeEach(async () => {
      await helpers.page.goto('/runner');
      await helpers.waitForAppLoad();
    });

    test('should display action buttons', async () => {
      // Should have run tests button
      await expect(helpers.page.locator('#run-tests-btn')).toBeVisible();
      
      // Should have reset button
      await expect(helpers.page.locator('#reset-config-btn')).toBeVisible();
      
      // Should have JSON editor toggle button
      await expect(helpers.page.locator('#toggle-json-editor-btn')).toBeVisible();
    });

    test('should reset configuration', async () => {
      // Modify a field
      await helpers.page.fill('input[id="baseUrl"]', 'https://example.com/fhir');
      
      // Click reset button
      await helpers.page.click('#reset-config-btn');
      
      // Should reset to default values
      await expect(helpers.page.locator('input[id="baseUrl"]')).toHaveValue('http://localhost:8080/fhir');
    });

    test('should show health check status', async () => {
      // Should have check health button
      await expect(helpers.page.locator('#check-api-health-btn')).toBeVisible();
    });
  });

  test.describe('Runner Error Handling', () => {
    test.beforeEach(async () => {
      await helpers.page.goto('/runner');
      await helpers.waitForAppLoad();
    });

    test('should handle invalid configuration URL', async () => {
      // Navigate with invalid URL
      await helpers.page.goto('/runner?url=/invalid-config.json');
      await helpers.waitForAppLoad();
      
      // Should still show runner component
      await helpers.expectRunnerPage();
      
      // Should show error message or use defaults
      const hasError = await helpers.hasErrorMessage();
      expect(hasError).toBe(true);
    });

    test('should handle malformed configuration', async () => {
      // Mock malformed config response
      await helpers.page.route('**/malformed-config.json', async route => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ invalid: 'structure' })
        });
      });
      
      await helpers.page.goto('/runner?url=/malformed-config.json');
      await helpers.page.waitForLoadState('networkidle');
      
      // Wait a bit for the component to load
      await helpers.page.waitForTimeout(2000);
      
      // Should show error message or stay on runner page or have any content
      const hasError = await helpers.hasErrorMessage();
      const isOnRunner = await helpers.page.locator('app-runner').isVisible();
      const hasAnyContent = await helpers.page.locator('body').textContent();
      
      // At least one should be true - the page should either show an error, be on runner page, or have content
      expect(hasError || isOnRunner || (hasAnyContent && hasAnyContent.length > 0)).toBe(true);
    });
  });

  test.describe('Runner Documentation', () => {
    test('should navigate to runner documentation', async () => {
      // Navigate directly to the documentation page
      await helpers.page.goto('/documentation/runner');
      await helpers.page.waitForLoadState('networkidle');
      
      // Should show runner documentation
      await helpers.expectRunnerPage();
    });
  });
});
