// Author: Preston Lee

import { test, expect } from '@playwright/test';
import { TestHelpers } from './utils/test-helpers';
import { ExamplePaths } from '../src/app/constants/example-paths.constants';

test.describe('Dashboard Tests', () => {
  let helpers: TestHelpers;

  test.beforeEach(async ({ page }) => {
    helpers = new TestHelpers(page);
  });

  test.describe('Dashboard Navigation', () => {
    test('should navigate to dashboard from home page', async () => {
      await helpers.goToHome();
      
      // Load index file first to enable dashboard
      await helpers.loadFromIndex(ExamplePaths.INDEX_JSON);
      
      // Set up session storage for dashboard
      await helpers.page.evaluate((indexUrl) => {
        sessionStorage.setItem('indexUrl', indexUrl);
      }, ExamplePaths.INDEX_JSON);
      
      // Navigate to dashboard
      await helpers.goToDashboard();
      
      // Should show dashboard component
      await expect(helpers.page.locator('app-dashboard')).toBeVisible();
      
      // Should show dashboard header
      await expect(helpers.page.locator('#dashboard-title')).toBeVisible();
    });

    test('should show back to home button', async () => {
      await helpers.goToHome();
      await helpers.loadFromIndex(ExamplePaths.INDEX_JSON);
      
      // Set up session storage for dashboard
      await helpers.page.evaluate((indexUrl) => {
        sessionStorage.setItem('indexUrl', indexUrl);
      }, ExamplePaths.INDEX_JSON);
      
      await helpers.goToDashboard();
      
      // Should have back button
      const backButton = helpers.page.locator('#back-to-home-btn');
      await expect(backButton).toBeVisible();
      
      // Click back button should navigate to home
      await backButton.click();
      expect(await helpers.isOnHomePage()).toBe(true);
    });

    test('should redirect to home when accessing dashboard without index data', async () => {
      await helpers.goToDashboard();
      
      // Should either redirect to home page or show error message
      const isOnHome = await helpers.isOnHomePage();
      const hasError = await helpers.hasErrorMessage();
      
      // Either should be on home page or show error message
      expect(isOnHome || hasError).toBe(true);
    });
  });

  test.describe('Dashboard Loading States', () => {
    test('should show loading state initially', async () => {
      await helpers.goToHome();
      await helpers.loadFromIndex(ExamplePaths.INDEX_JSON);
      
      // Set up session storage for dashboard
      await helpers.page.evaluate((indexUrl) => {
        sessionStorage.setItem('indexUrl', indexUrl);
      }, ExamplePaths.INDEX_JSON);
      
      // Navigate to dashboard and wait for loading state
      await helpers.page.goto('/dashboard');
      await helpers.waitForDashboardLoad();
      
      // Should show loading spinner or content (depending on timing)
      const hasSpinner = await helpers.isDashboardLoading();
      const hasContent = await helpers.page.locator('#engine-comparison-chart').isVisible();
      
      // Either loading spinner or content should be visible
      expect(hasSpinner || hasContent).toBe(true);
    });

    test('should show error state when no data available', async () => {
      // Navigate to dashboard without loading index data first
      await helpers.goToDashboard();
      
      // Should show error message
      await expect(helpers.page.locator('.alert-danger')).toBeVisible();
      await expect(helpers.page.locator('text=No index data found')).toBeVisible();
    });
  });

  test.describe('Dashboard Content Display', () => {
    test.beforeEach(async () => {
      await helpers.goToHome();
      await helpers.loadFromIndex(ExamplePaths.INDEX_JSON);
      
      // Set up session storage for dashboard
      await helpers.page.evaluate((indexUrl) => {
        sessionStorage.setItem('indexUrl', indexUrl);
      }, ExamplePaths.INDEX_JSON);
      
      await helpers.goToDashboard();
      await helpers.waitForDashboardLoad();
    });

    test('should display dashboard content when data is loaded', async () => {
      // Should show charts section
      await expect(helpers.page.locator('#engine-comparison-chart')).toBeVisible();
      await expect(helpers.page.locator('#summary-chart')).toBeVisible();
      
      // Should show filters section
      await expect(helpers.page.locator('#filters-controls-card')).toBeVisible();
      
      // Should show detailed results table
      await expect(helpers.page.locator('#detailed-results-card')).toBeVisible();
    });

    test('should display summary cards', async () => {
      // Should show summary cards with totals
      await expect(helpers.page.locator('#total-passed-card')).toBeVisible();
      await expect(helpers.page.locator('#total-failed-card')).toBeVisible();
      await expect(helpers.page.locator('#total-skipped-card')).toBeVisible();
      await expect(helpers.page.locator('#total-errors-card')).toBeVisible();
    });

    test('should display file selection checkboxes', async () => {
      // Should show file selection section
      await expect(helpers.page.locator('#file-selection-section')).toBeVisible();
      
      // Should have select all/deselect all buttons
      await expect(helpers.page.locator('#select-all-btn')).toBeVisible();
      await expect(helpers.page.locator('#deselect-all-btn')).toBeVisible();
      
      // Should have file checkboxes
      const checkboxes = await helpers.page.locator('input[type="checkbox"][id^="file-"]').count();
      expect(checkboxes).toBeGreaterThan(0);
    });

    test('should display filters and controls', async () => {
      // Should have status filter
      await expect(helpers.page.locator('#status-filter')).toBeVisible();
      
      // Should have sort options
      await expect(helpers.page.locator('#sort-by')).toBeVisible();
      
      // Should have sort order button
      await expect(helpers.page.locator('#sort-order-btn')).toBeVisible();
    });

    test('should display results table with proper headers', async () => {
      // Should show table headers
      await expect(helpers.page.locator('#engine-header')).toBeVisible();
      await expect(helpers.page.locator('#filename-header')).toBeVisible();
      await expect(helpers.page.locator('#timestamp-header')).toBeVisible();
      await expect(helpers.page.locator('#pass-header')).toBeVisible();
      await expect(helpers.page.locator('#fail-header')).toBeVisible();
      await expect(helpers.page.locator('#skip-header')).toBeVisible();
      await expect(helpers.page.locator('#error-header')).toBeVisible();
      await expect(helpers.page.locator('#total-header')).toBeVisible();
      await expect(helpers.page.locator('#actions-header')).toBeVisible();
    });
  });

  test.describe('Dashboard Functionality', () => {
    test.beforeEach(async () => {
      await helpers.goToHome();
      await helpers.loadFromIndex(ExamplePaths.INDEX_JSON);
      
      // Set up session storage for dashboard
      await helpers.page.evaluate((indexUrl) => {
        sessionStorage.setItem('indexUrl', indexUrl);
      }, ExamplePaths.INDEX_JSON);
      
      await helpers.goToDashboard();
      await helpers.waitForDashboardLoad();
    });

    test('should filter by status', async () => {
      // Change status filter to "Has Failures"
      const statusFilter = helpers.page.locator('#status-filter');
      await statusFilter.selectOption('fail');
      
      // Wait for filter to apply
      await helpers.page.waitForTimeout(500);
      
      // Should show filtered results
      const rowCount = await helpers.page.locator('table tbody tr').count();
      expect(rowCount).toBeGreaterThanOrEqual(1);
    });

    test('should sort by different columns', async () => {
      // Sort by pass count
      const sortBy = helpers.page.locator('#sort-by');
      await sortBy.selectOption('passCount');
      await helpers.page.waitForTimeout(500);
      
      // Should show sorted results
      const rowCount = await helpers.page.locator('table tbody tr').count();
      expect(rowCount).toBeGreaterThanOrEqual(1);
    });

    test('should toggle sort order', async () => {
      // Click sort order button to toggle
      const sortOrderButton = helpers.page.locator('#sort-order-btn');
      await sortOrderButton.click();
      
      // Should show descending order
      await expect(helpers.page.locator('#sort-order-btn:has-text("Descending")')).toBeVisible();
    });

    test('should select and deselect files', async () => {
      // Get first file checkbox
      const firstCheckbox = helpers.page.locator('input[type="checkbox"][id^="file-"]').first();
      
      // Uncheck first file
      await firstCheckbox.uncheck();
      await helpers.page.waitForTimeout(500);
      
      // Should update the display
      await expect(firstCheckbox).not.toBeChecked();
      
      // Check it again
      await firstCheckbox.check();
      await helpers.page.waitForTimeout(500);
      
      // Should be checked
      await expect(firstCheckbox).toBeChecked();
    });

    test('should select all files', async () => {
      // Click select all button
      await helpers.page.locator('#select-all-btn').click();
      
      // All file checkboxes should be checked (exclude the schema validation switch)
      const fileCheckboxes = helpers.page.locator('input[type="checkbox"][id^="file-"]');
      const count = await fileCheckboxes.count();
      
      for (let i = 0; i < count; i++) {
        await expect(fileCheckboxes.nth(i)).toBeChecked();
      }
    });

    test('should deselect all files', async () => {
      // First select all
      await helpers.page.locator('#select-all-btn').click();
      
      // Then deselect all
      await helpers.page.locator('#deselect-all-btn').click();
      
      // All file checkboxes should be unchecked (exclude the schema validation switch)
      const fileCheckboxes = helpers.page.locator('input[type="checkbox"][id^="file-"]');
      const count = await fileCheckboxes.count();
      
      for (let i = 0; i < count; i++) {
        await expect(fileCheckboxes.nth(i)).not.toBeChecked();
      }
    });

    test('should sort table by clicking column headers', async () => {
      // Click on engine column header
      await helpers.page.locator('#engine-header').click();
      await helpers.page.waitForTimeout(500);
      
      // Should show sort indicator
      await expect(helpers.page.locator('#engine-header .bi-sort-alpha-down')).toBeVisible();
      
      // Click again to reverse sort
      await helpers.page.locator('#engine-header').click();
      await helpers.page.waitForTimeout(500);
      
      // Should show reverse sort indicator
      await expect(helpers.page.locator('#engine-header .bi-sort-alpha-up')).toBeVisible();
    });

    test('should view individual file results', async () => {
      // Click view button on first row
      const viewButton = helpers.page.locator('.view-file-btn').first();
      await viewButton.click();
      
      // Should navigate to results page
      expect(await helpers.isOnResultsPage()).toBe(true);
    });

    test('should view file by clicking engine name', async () => {
      // Click on engine name in first row (look for the actual engine name, not "Engine" text)
      await helpers.page.locator('td.fw-bold.text-primary').first().click();
      
      // Should navigate to results page
      expect(await helpers.isOnResultsPage()).toBe(true);
    });
  });

  test.describe('Dashboard Charts', () => {
    test.beforeEach(async () => {
      await helpers.goToHome();
      await helpers.loadFromIndex(ExamplePaths.INDEX_JSON);
      
      // Set up session storage for dashboard
      await helpers.page.evaluate((indexUrl) => {
        sessionStorage.setItem('indexUrl', indexUrl);
      }, ExamplePaths.INDEX_JSON);
      
      await helpers.goToDashboard();
      await helpers.waitForDashboardLoad();
    });

    test('should display charts', async () => {
      // Should show chart containers
      await expect(helpers.page.locator('#engine-chart-canvas')).toBeVisible();
      await expect(helpers.page.locator('#summary-chart-canvas')).toBeVisible();
      
      // Should show chart titles
      await expect(helpers.page.locator('text=Results by Engine')).toBeVisible();
      await expect(helpers.page.locator('text=Aggregated Summary')).toBeVisible();
    });

    test('should update charts when filters change', async () => {
      // Change status filter
      await helpers.page.locator('#status-filter').selectOption('fail');
      await helpers.page.waitForTimeout(500);
      
      // Charts should still be visible
      await expect(helpers.page.locator('#engine-chart-canvas')).toBeVisible();
      await expect(helpers.page.locator('#summary-chart-canvas')).toBeVisible();
    });

    test('should update charts when file selection changes', async () => {
      // Deselect first file
      await helpers.page.locator('input[type="checkbox"][id^="file-"]').first().uncheck();
      await helpers.page.waitForTimeout(500);
      
      // Charts should still be visible
      await expect(helpers.page.locator('#engine-chart-canvas')).toBeVisible();
      await expect(helpers.page.locator('#summary-chart-canvas')).toBeVisible();
    });
  });

  test.describe('Dashboard Error Handling', () => {
    test('should handle invalid index data', async () => {
      // Navigate to dashboard without proper index data
      await helpers.goToDashboard();
      
      // Should show error message
      await expect(helpers.page.locator('.alert-danger')).toBeVisible();
    });

    test('should handle network errors gracefully', async () => {
      // Mock network failure
      await helpers.page.route(ExamplePaths.ROUTE_GLOB, route => route.abort());
      
      await helpers.goToHome();
      await helpers.loadFromIndex(ExamplePaths.INDEX_JSON);
      await helpers.goToDashboard();
      await helpers.waitForDashboardLoad();
      
      // Should show error message
      await expect(helpers.page.locator('.alert-danger')).toBeVisible();
    });
  });

  test.describe('Dashboard Responsive Design', () => {
    test.beforeEach(async () => {
      await helpers.goToHome();
      await helpers.loadFromIndex(ExamplePaths.INDEX_JSON);
      
      // Set up session storage for dashboard
      await helpers.page.evaluate((indexUrl) => {
        sessionStorage.setItem('indexUrl', indexUrl);
      }, ExamplePaths.INDEX_JSON);
      
      await helpers.goToDashboard();
      await helpers.waitForDashboardLoad();
    });

    test('should be responsive on mobile viewport', async () => {
      // Set mobile viewport
      await helpers.page.setViewportSize({ width: 375, height: 667 });
      
      // Should still show all main elements
      await expect(helpers.page.locator('#dashboard-title')).toBeVisible();
      const cardCount = await helpers.page.locator('.card').count();
      expect(cardCount).toBeGreaterThanOrEqual(4);
      
      // Table should be responsive
      await expect(helpers.page.locator('.table-responsive')).toBeVisible();
    });

    test('should be responsive on tablet viewport', async () => {
      // Set tablet viewport
      await helpers.page.setViewportSize({ width: 768, height: 1024 });
      
      // Should show charts in two columns
      const colCount = await helpers.page.locator('.col-md-6').count();
      expect(colCount).toBeGreaterThanOrEqual(2);
    });
  });
});
