// Author: Preston Lee

import { Page } from '@playwright/test';
import { 
  StatusFilter, 
  GroupByOption, 
  SortByOption, 
  SortOrder 
} from '../../src/app/models/query-params.model';

export class TestHelpers {
  constructor(public page: Page) {}

  /**
   * Wait for the application to be fully loaded
   */
  async waitForAppLoad() {
    await this.page.waitForLoadState('networkidle');
    await this.page.waitForSelector('app-open, app-results-viewer, app-dashboard, app-runner, app-landing', { timeout: 10000 });
  }

  /**
   * Navigate to the home page (results/open) and wait for it to load
   */
  async goToHome() {
    await this.page.goto('/results/open');
    await this.waitForAppLoad();
  }


  /**
   * Load example data
   */
  async loadExample() {
    const exampleButton = this.page.locator('#example-load-button');
    await exampleButton.click();
    
    // Wait for navigation to results page
    await this.page.waitForSelector('app-results-viewer', { timeout: 10000 });
  }

  /**
   * Load from index file
   */
  async loadFromIndex(indexUrl: string) {
    const indexInput = this.page.locator('#index-url-input');
    await indexInput.fill(indexUrl);
    
    const loadIndexButton = this.page.locator('#index-load-button');
    await loadIndexButton.click();
    
    // Wait for index to load
    await this.page.waitForSelector('.list-group-item, .alert-danger', { timeout: 10000 });
  }


  /**
   * Check if we're on the results viewer page
   */
  async isOnResultsPage() {
    return await this.page.locator('app-results-viewer').isVisible();
  }

  /**
   * Check if we're on the home page (results/open)
   */
  async isOnHomePage() {
    return await this.page.locator('app-open').isVisible();
  }

  /**
   * Get the current URL with query parameters
   */
  getCurrentUrl() {
    return this.page.url();
  }

  /**
   * Wait for results to be displayed
   */
  async waitForResults() {
    await this.page.waitForSelector('.table, .card', { timeout: 10000 });
  }


  /**
   * Check if error message is displayed
   */
  async hasErrorMessage() {
    return await this.page.locator('.alert-danger').isVisible();
  }

  /**
   * Get error message text
   */
  async getErrorMessage() {
    return await this.page.locator('.alert-danger').textContent();
  }


  /**
   * Apply status filter
   */
  async filterByStatus(status: StatusFilter) {
    const statusSelect = this.page.locator('#status-filter');
    await statusSelect.selectOption(status);
    
    // Trigger change event to ensure Angular picks up the change
    await statusSelect.dispatchEvent('change');
    
    // Wait for filter to apply
    await this.page.waitForTimeout(500);
  }

  /**
   * Apply search filter
   */
  async searchFor(term: string) {
    const searchInput = this.page.locator('#search-input');
    await searchInput.fill(term);
    
    // Trigger change event to ensure Angular picks up the change
    await searchInput.dispatchEvent('change');
    
    // Wait for search to apply
    await this.page.waitForTimeout(500);
  }

  /**
   * Set grouping option
   */
  async setGroupBy(groupBy: GroupByOption) {
    const groupSelect = this.page.locator('#group-by-filter');
    await groupSelect.selectOption(groupBy);
    
    // Wait for grouping to apply
    await this.page.waitForTimeout(500);
  }

  /**
   * Set sorting option
   */
  async setSortBy(sortBy: SortByOption) {
    const sortSelect = this.page.locator('#sort-by-filter');
    await sortSelect.click(); // Click first to ensure focus
    await sortSelect.selectOption(sortBy);
    await sortSelect.dispatchEvent('change'); // Trigger change event
    await this.page.waitForTimeout(500);
  }

  /**
   * Set sort order
   */
  async setSortOrder(order: SortOrder) {
    const orderSelect = this.page.locator('#sort-order-filter');
    await orderSelect.click(); // Click first to ensure focus
    await orderSelect.selectOption(order);
    await orderSelect.dispatchEvent('change'); // Trigger change event
    await this.page.waitForTimeout(500);
  }

  /**
   * Get the number of displayed test results
   */
  async getTestResultCount() {
    const rows = await this.page.locator('[data-testid="test-result-row"]').count();
    return rows;
  }

  /**
   * Get all test result rows (excluding group headers)
   */
  async getTestRows() {
    return this.page.locator('[data-testid="test-result-row"]');
  }

  /**
   * Get all status cell values
   */
  async getStatusCells() {
    return this.page.locator('[data-testid="status-cell"]').allTextContents();
  }

  /**
   * Get all test name cell values
   */
  async getTestNameCells() {
    return this.page.locator('[data-testid="test-name-cell"]').allTextContents();
  }

  /**
   * Get all group cell values
   */
  async getGroupCells() {
    return this.page.locator('[data-testid="group-cell"]').allTextContents();
  }

  /**
   * Get all expression cell values
   */
  async getExpressionCells() {
    return this.page.locator('[data-testid="expression-cell"]').allTextContents();
  }

  /**
   * Clear all filters
   */
  async clearFilters() {
    // Reset status filter
    await this.filterByStatus(StatusFilter.ALL);
    
    // Clear search
    const searchInput = this.page.locator('#search-input');
    await searchInput.clear();
    
    // Reset grouping
    await this.setGroupBy(GroupByOption.NONE);
    
    // Reset sorting
    await this.setSortBy(SortByOption.NAME);
    await this.setSortOrder(SortOrder.ASC);
  }

  /**
   * Navigate to results documentation page
   */
  async goToResultsDocumentation() {
    await this.page.goto('/documentation/results');
    await this.page.waitForLoadState('networkidle');
    await this.page.waitForSelector('h1:has-text("Launching CQL Test Results Viewer")');
  }

  /**
   * Navigate to runner documentation page
   */
  async goToRunnerDocumentation() {
    await this.page.goto('/documentation/runner');
    await this.page.waitForLoadState('networkidle');
    await this.page.waitForSelector('h1:has-text("CQL Test Runner")');
  }

  /**
   * Navigate to runner page
   */
  async goToRunner() {
    const runnerLink = this.page.locator('#runner-nav-link');
    await runnerLink.click();
    await this.page.waitForSelector('h1:has-text("CQL Test Runner")');
  }

  /**
   * Navigate to settings page
   */
  async goToSettings() {
    const settingsLink = this.page.locator('#settings-nav-link');
    await settingsLink.click();
    await this.page.waitForSelector('h4:has-text("Preferences")');
  }


  /**
   * Check if we're on the dashboard page
   */
  async isOnDashboardPage() {
    return await this.page.locator('app-dashboard').isVisible();
  }

  /**
   * Navigate to dashboard page
   */
  async goToDashboard() {
    await this.page.goto('/dashboard');
    await this.waitForAppLoad();
  }

  /**
   * Wait for dashboard to load completely
   */
  async waitForDashboardLoad() {
    await this.page.waitForSelector('app-dashboard', { timeout: 10000 });
    // Wait for either content to load or error to show
    await this.page.waitForSelector('.card, .alert-danger, .spinner-border', { timeout: 15000 });
  }

  /**
   * Check if dashboard is in loading state
   */
  async isDashboardLoading() {
    return await this.page.locator('.spinner-border').isVisible();
  }


  /**
   * Set session storage for dashboard tests
   */
  async setSessionStorage(key: string, value: string) {
    await this.page.evaluate(({ key, value }) => {
      sessionStorage.setItem(key, value);
    }, { key, value });
  }

  /**
   * Clear session storage
   */
  async clearSessionStorage() {
    await this.page.evaluate(() => {
      sessionStorage.clear();
    });
  }
}
