// Author: Preston Lee

import { test, expect } from '@playwright/test';
import { ExamplePaths } from '../src/app/constants/example-paths.constants';
import { TestHelpers } from './utils/test-helpers';

test.describe('Smoke Tests', () => {
  test('should load the application homepage', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Should show the landing component
    await expect(page.locator('app-landing')).toBeVisible();
    
    // Should have a link to open results
    await expect(page.locator('#open-results-btn')).toBeVisible();
  });

  test('should load the results/open page', async ({ page }) => {
    await page.goto('/results/open');
    await page.waitForLoadState('networkidle');
    
    // Should show the open component
    await expect(page.locator('app-open')).toBeVisible();
    
    // Should have file input
    await expect(page.locator('input[type="file"]')).toBeVisible();
    
    // Should have URL input for results
    await expect(page.locator('input[placeholder*="results.json"]')).toBeVisible();
    
    // Should have example button
    await expect(page.locator('#url-example-button')).toBeVisible();
  });

  test('should navigate to results documentation page', async ({ page }) => {
    // Navigate directly to the documentation page
    await page.goto('/documentation/results');
    await page.waitForLoadState('networkidle');
    
    // Should show results documentation content
    await expect(page.locator('h1:has-text("Launching CQL Test Results Viewer")')).toBeVisible();
  });

  test('should navigate to runner documentation page', async ({ page }) => {
    // Navigate directly to the documentation page
    await page.goto('/documentation/runner');
    await page.waitForLoadState('networkidle');
    
    // Should show runner documentation content
    await expect(page.locator('h1:has-text("CQL Test Runner")')).toBeVisible();
  });

  test('should navigate to runner page', async ({ page }) => {
    const helpers = new TestHelpers(page);
    await helpers.goToHome();
    await helpers.goToRunner();
  });

  test('should navigate to settings page', async ({ page }) => {
    const helpers = new TestHelpers(page);
    await helpers.goToHome();
    await helpers.goToSettings();
    await expect(page.locator('#settings')).toBeVisible();
    await expect(page.locator('#settings-environments')).toBeVisible();
    await expect(page.locator('#environment-switcher')).toBeVisible();
  });

  test('should load example data', async ({ page }) => {
    const helpers = new TestHelpers(page);
    await helpers.goToHome();
    await helpers.loadExample();
    
    // Should show results
    await expect(page.locator('app-results-viewer')).toBeVisible();
    
    // Should have test results table
    await expect(page.locator('table')).toBeVisible();
  });

  test('should prefill runner OnlyList from visible results tests', async ({ page }) => {
    const helpers = new TestHelpers(page);
    await helpers.goToHome();
    await helpers.loadExample();
    await expect(page.locator('#create-runner-config-from-visible-tests-btn')).toBeEnabled();
    await page.click('#create-runner-config-from-visible-tests-btn');
    await expect(page).toHaveURL(/\/runner$/);
    await expect(page.locator('app-runner')).toBeVisible();
    await expect(page.locator('#only-testsName-0')).toBeVisible();
  });

  test('should handle deep linking with URL parameter', async ({ page }) => {
    await page.goto(`/results/open?url=${ExamplePaths.RESULTS_JSON}`);
    await page.waitForLoadState('networkidle');
    
    // Wait for the results to load (this might take a moment)
    await page.waitForSelector('app-results-viewer', { timeout: 10000 });
    
    // Should navigate directly to results page
    await expect(page.locator('app-results-viewer')).toBeVisible();
    
    // Should show test results
    await expect(page.locator('table')).toBeVisible();
  });

  test('should load runner configuration from URL parameter', async ({ page }) => {
    const helpers = new TestHelpers(page);
    // Navigate to runner page with URL parameter
    await page.goto(`/runner?url=${ExamplePaths.RUNNER_CONFIG_JSON}`);
    await page.waitForLoadState('networkidle');
    
    // Should show runner component
    await helpers.expectRunnerPage();
    
    // Wait for configuration to load from URL
    await page.waitForTimeout(1000);
    
    // Should load configuration from URL
    await expect(page.locator('input[id="baseUrl"]')).toHaveValue('http://localhost:8080/fhir');
    await expect(page.locator('input[id="cqlOperation"]')).toHaveValue('$cql');
    await expect(page.locator('input[id="cqlFileVersion"]')).toHaveValue('1.0.000');
    
    // Should have skip list section visible (skip list items might not be pre-populated)
    await expect(page.locator('h5:has-text("Skip List")')).toBeVisible();
  });
});
