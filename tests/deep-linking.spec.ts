// Author: Preston Lee

import { test, expect } from '@playwright/test';
import { TestHelpers } from './utils/test-helpers';
import { 
  StatusFilter, 
  GroupByOption, 
  SortByOption, 
  SortOrder 
} from '../src/app/models/query-params.model';

test.describe('Deep Linking Tests', () => {
  let helpers: TestHelpers;

  test.beforeEach(async ({ page }) => {
    helpers = new TestHelpers(page);
  });

  test.describe('URL Parameter Deep Linking', () => {
    test('should load results directly from URL parameter', async () => {
      await helpers.page.goto('/results/open?url=/examples/results.json');
      await helpers.waitForAppLoad();
      
      // Should be on results page
      expect(await helpers.isOnResultsPage()).toBe(true);
      
      // Should display test results
      await helpers.waitForResults();
      
      // URL should contain the file URL parameter
      const currentUrl = helpers.getCurrentUrl();
      expect(currentUrl).toContain('url=');
    });

    test('should load results with status filter', async () => {
      await helpers.page.goto('/results/open?url=/examples/results.json&status=fail');
      await helpers.waitForAppLoad();
      
      // Should be on results page
      expect(await helpers.isOnResultsPage()).toBe(true);
      
      // Should display filtered results
      await helpers.waitForResults();
      
      // Status filter should be set to fail
      const statusSelect = helpers.page.locator('#status-filter');
      await expect(statusSelect).toHaveValue('fail');
    });

    test('should load results with search filter', async () => {
      await helpers.page.goto('/results/open?url=/examples/results.json&search=arithmetic');
      await helpers.waitForAppLoad();
      
      // Should be on results page
      expect(await helpers.isOnResultsPage()).toBe(true);
      
      // Should display filtered results
      await helpers.waitForResults();
      
      // Search input should contain the search term
      const searchInput = helpers.page.locator('#search-input');
      await expect(searchInput).toHaveValue('arithmetic');
    });

    test('should load results with grouping', async () => {
      await helpers.page.goto('/results/open?url=/examples/results.json&groupBy=group');
      await helpers.waitForAppLoad();
      
      // Should be on results page
      expect(await helpers.isOnResultsPage()).toBe(true);
      
      // Should display grouped results
      await helpers.waitForResults();
      
      // Group by should be set to group
      const groupSelect = helpers.page.locator('#group-by-filter');
      await expect(groupSelect).toHaveValue('group');
    });

    test('should load results with sorting', async () => {
      await helpers.page.goto('/results/open?url=/examples/results.json&sortBy=name&sortOrder=desc');
      await helpers.waitForAppLoad();
      
      // Should be on results page
      expect(await helpers.isOnResultsPage()).toBe(true);
      
      // Should display sorted results
      await helpers.waitForResults();
      
      // Sort by should be set to name
      const sortBySelect = helpers.page.locator('#sort-by-filter');
      await expect(sortBySelect).toHaveValue('name');
      
      // Sort order should be set to desc
      const sortOrderSelect = helpers.page.locator('#sort-order-filter');
      await expect(sortOrderSelect).toHaveValue('desc');
    });

    test('should load results with multiple filters', async () => {
      await helpers.page.goto('/results/open?url=/examples/results.json&status=fail&search=arithmetic&groupBy=group&sortBy=name&sortOrder=asc');
      await helpers.waitForAppLoad();
      
      // Should be on results page
      expect(await helpers.isOnResultsPage()).toBe(true);
      
      // Should display filtered and sorted results
      await helpers.waitForResults();
      
      // All filters should be applied
      const statusSelect = helpers.page.locator('#status-filter');
      await expect(statusSelect).toHaveValue('fail');
      
      const searchInput = helpers.page.locator('#search-input');
      await expect(searchInput).toHaveValue('arithmetic');
      
      const groupSelect = helpers.page.locator('#group-by-filter');
      await expect(groupSelect).toHaveValue('group');
      
      const sortBySelect = helpers.page.locator('#sort-by-filter');
      await expect(sortBySelect).toHaveValue('name');
      
      const sortOrderSelect = helpers.page.locator('#sort-order-filter');
      await expect(sortOrderSelect).toHaveValue('asc');
    });
  });

  test.describe('Index Parameter Deep Linking', () => {
    test('should load index file from URL parameter', async () => {
      await helpers.page.goto('/results/open?index=/examples/index.json');
      await helpers.waitForAppLoad();
      
      // Should be on home page
      expect(await helpers.isOnHomePage()).toBe(true);
      
      // Should display file list
      const fileList = await helpers.page.locator('.list-group-item').count();
      expect(fileList).toBeGreaterThan(0);
    });

    test('should load index file with filters', async () => {
      await helpers.page.goto('/results/open?index=/examples/index.json&status=fail&search=arithmetic');
      await helpers.waitForAppLoad();
      
      // Should be on home page
      expect(await helpers.isOnHomePage()).toBe(true);
      
      // Should display file list
      const fileList = await helpers.page.locator('.list-group-item').count();
      expect(fileList).toBeGreaterThan(0);
      
      // Filters should be preserved for when a file is selected
      // (This would be tested when a file is actually selected from the index)
    });
  });

  test.describe('URL Parameter Validation', () => {
    test('should handle invalid URL parameter', async () => {
      await helpers.page.goto('/results/open?url=https://invalid-url.com/file.json');
      await helpers.waitForAppLoad();
      
      // Should redirect to home page
      expect(await helpers.isOnHomePage()).toBe(true);
      
      // Should show error message
      expect(await helpers.hasErrorMessage()).toBe(true);
    });

    test('should handle malformed URL parameter', async () => {
      await helpers.page.goto('/results/open?url=not-a-valid-url');
      await helpers.waitForAppLoad();
      
      // Should redirect to home page
      expect(await helpers.isOnHomePage()).toBe(true);
      
      // Should show error message
      expect(await helpers.hasErrorMessage()).toBe(true);
    });

    test('should handle invalid status parameter', async () => {
      await helpers.page.goto('/results/open?url=/examples/results.json&status=invalid');
      await helpers.waitForAppLoad();
      
      // Should be on results page
      expect(await helpers.isOnResultsPage()).toBe(true);
      
      // Should use default status (all)
      const statusSelect = helpers.page.locator('#status-filter');
      await expect(statusSelect).toHaveValue('all');
    });

    test('should handle invalid groupBy parameter', async () => {
      await helpers.page.goto('/results/open?url=/examples/results.json&groupBy=invalid');
      await helpers.waitForAppLoad();
      
      // Should be on results page
      expect(await helpers.isOnResultsPage()).toBe(true);
      
      // Should use default groupBy (none)
      const groupSelect = helpers.page.locator('#group-by-filter');
      await expect(groupSelect).toHaveValue('none');
    });

    test('should handle invalid sortBy parameter', async () => {
      await helpers.page.goto('/results/open?url=/examples/results.json&sortBy=invalid');
      await helpers.waitForAppLoad();
      
      // Should be on results page
      expect(await helpers.isOnResultsPage()).toBe(true);
      
      // Should use default sortBy (name)
      const sortBySelect = helpers.page.locator('#sort-by-filter');
      await expect(sortBySelect).toHaveValue('name');
    });

    test('should handle invalid sortOrder parameter', async () => {
      await helpers.page.goto('/results/open?url=/examples/results.json&sortOrder=invalid');
      await helpers.waitForAppLoad();
      
      // Should be on results page
      expect(await helpers.isOnResultsPage()).toBe(true);
      
      // Should use default sortOrder (asc)
      const sortOrderSelect = helpers.page.locator('#sort-order-filter');
      await expect(sortOrderSelect).toHaveValue('asc');
    });
  });

  test.describe('URL State Persistence', () => {
    test('should preserve URL parameters when navigating', async () => {
      await helpers.page.goto('/results/open?url=/examples/results.json&status=fail&search=test');
      await helpers.waitForAppLoad();
      
      // Should be on results page
      expect(await helpers.isOnResultsPage()).toBe(true);
      
      // Navigate to results documentation and back
      await helpers.goToResultsDocumentation();
      await helpers.page.goBack();
      
      // Should still be on results page with same filters
      expect(await helpers.isOnResultsPage()).toBe(true);
      
      const statusSelect = helpers.page.locator('#status-filter');
      await expect(statusSelect).toHaveValue('fail');
      
      const searchInput = helpers.page.locator('#search-input');
      await expect(searchInput).toHaveValue('test');
    });

    test('should update URL when filters change', async () => {
      await helpers.page.goto('/results/open?url=/examples/results.json');
      await helpers.waitForAppLoad();
      
      // Should be on results page
      expect(await helpers.isOnResultsPage()).toBe(true);
      
      // Change status filter
      await helpers.filterByStatus(StatusFilter.FAIL);
      
      // URL should be updated
      const currentUrl = helpers.getCurrentUrl();
      expect(currentUrl).toContain('status=fail');
      
      // Change search term
      await helpers.searchFor('arithmetic');
      
      // URL should be updated
      const updatedUrl = helpers.getCurrentUrl();
      expect(updatedUrl).toContain('search=arithmetic');
    });
  });

  test.describe('Direct Results Page Access', () => {
    test('should redirect to home when accessing results page without data', async () => {
      await helpers.page.goto('/results');
      await helpers.waitForAppLoad();
      
      // Should redirect to home page
      expect(await helpers.isOnHomePage()).toBe(true);
    });

    test('should load results page with data from session storage', async () => {
      // First load data normally
      await helpers.page.goto('/results/open?url=/examples/results.json');
      await helpers.waitForAppLoad();
      
      // Should be on results page
      expect(await helpers.isOnResultsPage()).toBe(true);
      
      // Navigate directly to results page
      await helpers.page.goto('/results');
      await helpers.waitForAppLoad();
      
      // Should still be on results page with data
      expect(await helpers.isOnResultsPage()).toBe(true);
      await helpers.waitForResults();
    });
  });
  
});
