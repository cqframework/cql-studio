// Author: Preston Lee

import { test, expect } from '@playwright/test';

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
    await expect(page.locator('#example-load-button')).toBeVisible();
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
    await page.goto('/results/open');
    await page.waitForLoadState('networkidle');
    
    // Click runner link
    await page.click('#runner-nav-link');
    
    // Should show runner content
    await expect(page.locator('h1:has-text("CQL Test Runner")')).toBeVisible();
  });

  test('should navigate to settings page', async ({ page }) => {
    await page.goto('/results/open');
    await page.waitForLoadState('networkidle');
    
    // Click settings link
    await page.click('#settings-nav-link');
    
    // Should show settings content
    await expect(page.locator('h4:has-text("Preferences")')).toBeVisible();
  });

  test('should load example data', async ({ page }) => {
    await page.goto('/results/open');
    await page.waitForLoadState('networkidle');
    
    // Click load example button
    await page.click('#example-load-button');
    
    // Wait for navigation to results page
    await page.waitForSelector('app-results-viewer', { timeout: 10000 });
    
    // Should show results
    await expect(page.locator('app-results-viewer')).toBeVisible();
    
    // Should have test results table
    await expect(page.locator('table')).toBeVisible();
  });

  test('should handle deep linking with URL parameter', async ({ page }) => {
    await page.goto('/results/open?url=/examples/results.json');
    await page.waitForLoadState('networkidle');
    
    // Wait for the results to load (this might take a moment)
    await page.waitForSelector('app-results-viewer', { timeout: 10000 });
    
    // Should navigate directly to results page
    await expect(page.locator('app-results-viewer')).toBeVisible();
    
    // Should show test results
    await expect(page.locator('table')).toBeVisible();
  });

  test('should load runner configuration from URL parameter', async ({ page }) => {
    // Navigate to runner page with URL parameter
    await page.goto('/runner?url=/examples/runner-config.json');
    await page.waitForLoadState('networkidle');
    
    // Should show runner component
    await expect(page.locator('h1:has-text("CQL Test Runner")')).toBeVisible();
    
    // Wait for configuration to load from URL
    await page.waitForTimeout(1000);
    
    // Should load configuration from URL
    await expect(page.locator('input[id="baseUrl"]')).toHaveValue('http://localhost:8080/fhir');
    await expect(page.locator('input[id="cqlOperation"]')).toHaveValue('$cql');
    await expect(page.locator('input[id="cqlFileVersion"]')).toHaveValue('1.0.000');
    await expect(page.locator('input[id="cqlOutputPath"]')).toHaveValue('./cql');
    await expect(page.locator('input[id="resultsPath"]')).toHaveValue('./results');
    
    // Should have skip list section visible (skip list items might not be pre-populated)
    await expect(page.locator('h5:has-text("Skip List")')).toBeVisible();
  });
});
