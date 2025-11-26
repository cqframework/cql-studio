// Author: Preston Lee

import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CqlTestResults, TestResult, Capability } from '../../models/cql-test-results.model';
import { BaseChartDirective } from 'ng2-charts';
import { Chart, registerables } from 'chart.js';
import { FileLoaderService } from '../../services/file-loader.service';
import { SchemaValidationService } from '../../services/schema-validation.service';
import { SettingsService } from '../../services/settings.service';
import { SessionStorageKeys } from '../../constants/session-storage.constants';
import { SyntaxHighlighterComponent } from '../shared/syntax-highlighter/syntax-highlighter.component';
import { 
  StatusFilter, 
  GroupByOption, 
  SortByOption, 
  SortOrder,
  isValidStatusFilter,
  isValidGroupByOption,
  isValidSortByOption,
  isValidSortOrder
} from '../../models/query-params.model';
import { interval, Subscription } from 'rxjs';
import { 
  COLOR_SUCCESS, 
  COLOR_DANGER, 
  COLOR_WARNING, 
  COLOR_SECONDARY,
  COLOR_SUCCESS_DARK,
  COLOR_DANGER_DARK,
  COLOR_WARNING_DARK,
  COLOR_SECONDARY_DARK,
  COLOR_BG_DARK,
  COLOR_TEXT_LIGHT
} from '../../constants/colors.constants';

// Register Chart.js components
Chart.register(...registerables);

@Component({
  selector: 'app-results-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule, BaseChartDirective, SyntaxHighlighterComponent],
  templateUrl: './results-viewer.component.html',
  styleUrl: './results-viewer.component.scss'
})
export class ResultsViewerComponent implements OnInit, OnDestroy {
  testResults = signal<CqlTestResults | null>(null);
  filteredResults = signal<TestResult[]>([]);
  selectedStatus = signal<StatusFilter>(StatusFilter.ALL);
  searchTerm = signal<string>('');
  expandedResults = signal<Set<string>>(new Set());
  showAllDetails = signal<boolean>(false);
  
  // Grouping and sorting controls
  groupBy = signal<GroupByOption>(GroupByOption.NONE);
  sortBy = signal<SortByOption>(SortByOption.NAME);
  sortOrder = signal<SortOrder>(SortOrder.ASC);
  
  // Expose enums to template
  readonly StatusFilter = StatusFilter;
  readonly GroupByOption = GroupByOption;
  readonly SortByOption = SortByOption;
  readonly SortOrder = SortOrder;
  
  // Store the original URL parameter to preserve it
  private originalUrl: string | null = null;
  
  // Polling for new results
  private pollingSubscription?: Subscription;
  private lastResultsHash: string | null = null;

  // Chart data properties
  pieChartData: any = {
    labels: ['Passed', 'Failed', 'Skipped', 'Errors'],
    datasets: [{
      data: [0, 0, 0, 0],
      backgroundColor: [COLOR_SUCCESS, COLOR_DANGER, COLOR_WARNING, COLOR_SECONDARY],
      borderColor: [COLOR_SUCCESS_DARK, COLOR_DANGER_DARK, COLOR_WARNING_DARK, COLOR_SECONDARY_DARK],
      borderWidth: 0
    }]
  };

  pieChartOptions: any = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          padding: 20,
          usePointStyle: true
        }
      },
      tooltip: {
        enabled: true,
        backgroundColor: COLOR_BG_DARK,
        titleColor: COLOR_TEXT_LIGHT,
        bodyColor: COLOR_TEXT_LIGHT,
        borderColor: COLOR_TEXT_LIGHT,
        borderWidth: 1,
        cornerRadius: 6,
        displayColors: true,
        padding: 12,
        callbacks: {
          title: function(context: any) {
            return 'Test Results Summary';
          },
          label: function(context: any) {
            const total = context.dataset.data.reduce((a: number, b: number) => a + b, 0);
            const percentage = ((context.parsed / total) * 100).toFixed(1);
            const statusIcon = context.label === 'Passed' ? '✓' : 
                             context.label === 'Failed' ? '✗' : 
                             context.label === 'Skipped' ? '⊘' : '⚠';
            return `${statusIcon} ${context.label}: ${context.parsed} tests (${percentage}%)`;
          },
          footer: function(context: any) {
            const total = context.dataset.data.reduce((a: number, b: number) => a + b, 0);
            return `Total Tests: ${total}`;
          }
        }
      }
    }
  };

  barChartData: any = {
    labels: [],
    datasets: [
      {
        label: 'Passed',
        data: [],
        backgroundColor: COLOR_SUCCESS,
        borderColor: COLOR_SUCCESS_DARK,
        borderWidth: 1
      },
      {
        label: 'Failed',
        data: [],
        backgroundColor: COLOR_DANGER,
        borderColor: COLOR_DANGER_DARK,
        borderWidth: 1
      },
      {
        label: 'Skipped',
        data: [],
        backgroundColor: COLOR_WARNING,
        borderColor: COLOR_WARNING_DARK,
        borderWidth: 1
      },
      {
        label: 'Errors',
        data: [],
        backgroundColor: COLOR_SECONDARY,
        borderColor: COLOR_SECONDARY_DARK,
        borderWidth: 1
      }
    ]
  };

  barChartOptions: any = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        stacked: true
      },
      y: {
        stacked: true,
        beginAtZero: true,
        ticks: {
          stepSize: 1
        }
      }
    },
    plugins: {
      legend: {
        display: true,
        position: 'bottom',
        labels: {
          padding: 20,
          usePointStyle: true
        }
      },
      tooltip: {
        enabled: true,
        mode: 'index',
        intersect: false,
        backgroundColor: COLOR_BG_DARK,
        titleColor: COLOR_TEXT_LIGHT,
        bodyColor: COLOR_TEXT_LIGHT,
        borderColor: COLOR_TEXT_LIGHT,
        borderWidth: 1,
        cornerRadius: 6,
        displayColors: true,
        padding: 12,
        callbacks: {
          title: function(context: any) {
            // Handle both array and single object cases
            const items = Array.isArray(context) ? context : [context];
            return `Group: ${items[0]?.label || 'Unknown'}`;
          },
          label: function(context: any) {
            // Handle both array and single object cases
            const items = Array.isArray(context) ? context : [context];
            const currentItem = items[0];
            
            if (!currentItem) return '';
            
            const groupTotal = items.map((item: any) => item.parsed.y).reduce((a: number, b: number) => a + b, 0);
            const percentage = groupTotal > 0 ? ((currentItem.parsed.y / groupTotal) * 100).toFixed(1) : '0.0';
            const statusIcon = currentItem.dataset.label === 'Passed' ? '✓' : 
                             currentItem.dataset.label === 'Failed' ? '✗' : 
                             currentItem.dataset.label === 'Skipped' ? '⊘' : '⚠';
            return `${statusIcon} ${currentItem.dataset.label}: ${currentItem.parsed.y} tests (${percentage}%)`;
          },
          footer: function(context: any) {
            // Handle both array and single object cases
            const items = Array.isArray(context) ? context : [context];
            const groupTotal = items.reduce((sum: number, item: any) => sum + item.parsed.y, 0);
            const passCount = items.find((item: any) => item.dataset.label === 'Passed')?.parsed.y || 0;
            const passRate = groupTotal > 0 ? ((passCount / groupTotal) * 100).toFixed(1) : '0.0';
            return [`Total Tests: ${groupTotal}`, `Pass Rate: ${passRate}%`];
          }
        }
      }
    }
  };

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private fileLoader: FileLoaderService,
    private schemaValidation: SchemaValidationService,
    private settingsService: SettingsService
  ) {}

  ngOnInit(): void {
    this.loadResults();
    this.startPolling();
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  private loadResults(): void {
    const storedData = sessionStorage.getItem(SessionStorageKeys.CQL_TEST_RESULTS);
    if (storedData) {
      try {
        const data = JSON.parse(storedData) as CqlTestResults;
        this.testResults.set(data);
        
        // Load initial parameters from URL or sessionStorage
        this.loadInitialParameters();
        
        // Apply filters with initial values
        this.applyFilters();
        this.updateChartData(); // Initial chart data load
        
        // Ensure URL parameter is set in the browser address bar after initialization
        this.updateUrlWithPreservedParams();
        
        // Update the hash for change detection
        this.lastResultsHash = this.generateResultsHash(data);
      } catch (error) {
        console.error('Error parsing stored data:', error);
        this.router.navigate(['/results/open']);
      }
    } else {
      // Check if there's a URL parameter to load data from
      const params = this.route.snapshot.queryParams;
      if (params['url']) {
        this.loadFromUrl(params['url']);
      } else {
        this.router.navigate(['/results/open']);
      }
    }
  }

  private loadInitialParameters(): void {
    // Get current query parameters
    const params = this.route.snapshot.queryParams;
    
    // Handle URL parameter (for files loaded from index)
    if (params['url']) {
      // Store the URL for potential future use
      sessionStorage.setItem(SessionStorageKeys.CURRENT_FILE_URL, params['url']);
      // Store the URL in component property to preserve it
      this.originalUrl = params['url'];
    }
    
    // Priority: URL params > sessionStorage > defaults
    const initialStatus = params['status'] || sessionStorage.getItem(SessionStorageKeys.INITIAL_STATUS);
    const initialSearch = params['search'] || sessionStorage.getItem(SessionStorageKeys.INITIAL_SEARCH);
    const initialGroupBy = params['groupBy'] || sessionStorage.getItem(SessionStorageKeys.INITIAL_GROUP_BY);
    const initialSortBy = params['sortBy'] || sessionStorage.getItem(SessionStorageKeys.INITIAL_SORT_BY);
    const initialSortOrder = params['sortOrder'] || sessionStorage.getItem(SessionStorageKeys.INITIAL_SORT_ORDER);
    
    // Validate and set status filter
    if (initialStatus) {
      if (isValidStatusFilter(initialStatus)) {
        this.selectedStatus.set(initialStatus);
      } else {
        console.warn(`Invalid status parameter: ${initialStatus}. Using default: '${StatusFilter.ALL}'`);
        this.selectedStatus.set(StatusFilter.ALL);
      }
      if (sessionStorage.getItem(SessionStorageKeys.INITIAL_STATUS)) {
        sessionStorage.removeItem(SessionStorageKeys.INITIAL_STATUS); // Clean up after use
      }
    }
    
    // Validate and set search term
    if (initialSearch) {
      // Search term can be any string, but we'll trim it
      this.searchTerm.set(initialSearch.trim());
      if (sessionStorage.getItem(SessionStorageKeys.INITIAL_SEARCH)) {
        sessionStorage.removeItem(SessionStorageKeys.INITIAL_SEARCH); // Clean up after use
      }
    }
    
    // Validate and set group by filter
    if (initialGroupBy) {
      if (isValidGroupByOption(initialGroupBy)) {
        this.groupBy.set(initialGroupBy);
      } else {
        console.warn(`Invalid groupBy parameter: ${initialGroupBy}. Using default: '${GroupByOption.NONE}'`);
        this.groupBy.set(GroupByOption.NONE);
      }
      if (sessionStorage.getItem(SessionStorageKeys.INITIAL_GROUP_BY)) {
        sessionStorage.removeItem(SessionStorageKeys.INITIAL_GROUP_BY); // Clean up after use
      }
    }
    
    // Validate and set sort by filter
    if (initialSortBy) {
      if (isValidSortByOption(initialSortBy)) {
        this.sortBy.set(initialSortBy);
      } else {
        console.warn(`Invalid sortBy parameter: ${initialSortBy}. Using default: '${SortByOption.NAME}'`);
        this.sortBy.set(SortByOption.NAME);
      }
      if (sessionStorage.getItem(SessionStorageKeys.INITIAL_SORT_BY)) {
        sessionStorage.removeItem(SessionStorageKeys.INITIAL_SORT_BY); // Clean up after use
      }
    }
    
    // Validate and set sort order filter
    if (initialSortOrder) {
      if (isValidSortOrder(initialSortOrder)) {
        this.sortOrder.set(initialSortOrder);
      } else {
        console.warn(`Invalid sortOrder parameter: ${initialSortOrder}. Using default: '${SortOrder.ASC}'`);
        this.sortOrder.set(SortOrder.ASC);
      }
      if (sessionStorage.getItem(SessionStorageKeys.INITIAL_SORT_ORDER)) {
        sessionStorage.removeItem(SessionStorageKeys.INITIAL_SORT_ORDER); // Clean up after use
      }
    }
  }

  getValidationErrors(): string[] {
    const storedErrors = sessionStorage.getItem(SessionStorageKeys.VALIDATION_ERRORS);
    if (storedErrors) {
      try {
        return JSON.parse(storedErrors);
      } catch (error) {
        console.error('Error parsing validation errors:', error);
        return [];
      }
    }
    return [];
  }

  onStatusFilterChange(event: Event): void {
    const target = event.target as HTMLSelectElement;
    const value = target.value;
    if (isValidStatusFilter(value)) {
      this.selectedStatus.set(value);
    } else {
      console.warn(`Invalid status value: ${value}. Using default: '${StatusFilter.ALL}'`);
      this.selectedStatus.set(StatusFilter.ALL);
      // Reset the select element to the default value
      target.value = StatusFilter.ALL;
    }
    
    this.applyFilters();
    this.updateChartData(); // Only update charts for status filter changes
    this.updateUrlWithPreservedParams();
  }

  onSearchChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.searchTerm.set(target.value);
    this.applyFilters();
    this.updateChartData(); // Only update charts for search changes
    this.updateUrlWithPreservedParams();
  }

  onGroupByChange(event: Event): void {
    const target = event.target as HTMLSelectElement;
    const value = target.value;
    if (isValidGroupByOption(value)) {
      this.groupBy.set(value);
    } else {
      console.warn(`Invalid groupBy value: ${value}. Using default: '${GroupByOption.NONE}'`);
      this.groupBy.set(GroupByOption.NONE);
      // Reset the select element to the default value
      target.value = GroupByOption.NONE;
    }
    
    this.applyFilters();
    this.updateUrlWithPreservedParams();
    // No chart update needed for grouping changes
  }

  onSortByChange(event: Event): void {
    console.log('onSortByChange called!');
    const target = event.target as HTMLSelectElement;
    const value = target.value;
    console.log('Sort by value:', value);
    if (isValidSortByOption(value)) {
      this.sortBy.set(value);
    } else {
      console.warn(`Invalid sortBy value: ${value}. Using default: '${SortByOption.NAME}'`);
      this.sortBy.set(SortByOption.NAME);
      // Reset the select element to the default value
      target.value = SortByOption.NAME;
    }
    
    this.applyFilters();
    this.updateUrlWithPreservedParams();
    // No chart update needed for sorting changes
  }

  onSortOrderChange(event: Event): void {
    console.log('onSortOrderChange called!');
    const target = event.target as HTMLSelectElement;
    const value = target.value;
    console.log('Sort order value:', value);
    if (isValidSortOrder(value)) {
      this.sortOrder.set(value);
    } else {
      console.warn(`Invalid sortOrder value: ${value}. Using default: '${SortOrder.ASC}'`);
      this.sortOrder.set(SortOrder.ASC);
      // Reset the select element to the default value
      target.value = SortOrder.ASC;
    }
    
    this.applyFilters();
    this.updateUrlWithPreservedParams();
    // No chart update needed for sort order changes
  }

  private applyFilters(): void {
    const results = this.testResults()?.results || [];
    let filtered = results;

    // Filter by status
    if (this.selectedStatus() !== StatusFilter.ALL) {
      filtered = filtered.filter(result => result.testStatus === this.selectedStatus());
    }

    // Filter by search term
    const searchTerm = this.searchTerm().toLowerCase();
    if (searchTerm) {
      filtered = filtered.filter(result => 
        result.testName.toLowerCase().includes(searchTerm) ||
        result.groupName.toLowerCase().includes(searchTerm) ||
        result.testsName.toLowerCase().includes(searchTerm) ||
        result.expression.toLowerCase().includes(searchTerm)
      );
    }

    // Sort results
    filtered = this.sortResults(filtered);

    this.filteredResults.set(filtered);
  }

  private sortResults(results: TestResult[]): TestResult[] {
    const sortBy = this.sortBy();
    const sortOrder = this.sortOrder();
    
    return [...results].sort((a, b) => {
      let comparison = 0;
      
      switch (sortBy) {
        case SortByOption.NAME:
          comparison = a.testName.localeCompare(b.testName);
          break;
        case SortByOption.GROUP:
          comparison = a.groupName.localeCompare(b.groupName);
          break;
        case SortByOption.STATUS:
          comparison = a.testStatus.localeCompare(b.testStatus);
          break;
        case SortByOption.EXPRESSION:
          comparison = a.expression.localeCompare(b.expression);
          break;
        case SortByOption.TESTS_NAME:
          comparison = a.testsName.localeCompare(b.testsName);
          break;
        default:
          comparison = 0;
      }
      
      return sortOrder === SortOrder.DESC ? -comparison : comparison;
    });
  }

  getGroupedResults(): { group: string; results: TestResult[] }[] {
    const results = this.filteredResults();
    const groupBy = this.groupBy();
    
    if (groupBy === GroupByOption.NONE) {
      // Ensure results are sorted even when not grouped
      return [{ group: 'All Results', results: this.sortResults(results) }];
    }
    
    const groups = new Map<string, TestResult[]>();
    
    results.forEach(result => {
      const groupKey = groupBy === GroupByOption.GROUP ? result.groupName : 
                      groupBy === GroupByOption.STATUS ? result.testStatus :
                      groupBy === GroupByOption.TESTS_NAME ? result.testsName : 'Ungrouped';
      
      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey)!.push(result);
    });
    
    // Sort groups alphabetically and preserve sorting within each group
    return Array.from(groups.entries())
      .map(([group, groupResults]) => ({ 
        group, 
        results: this.sortResults(groupResults) // Apply sorting within each group
      }))
      .sort((a, b) => a.group.localeCompare(b.group));
  }

  getStatusClass(status: string): string {
    switch (status) {
      case 'pass': return 'text-success';
      case 'fail': return 'text-danger';
      case 'skip': return 'text-warning';
      case 'error': return 'text-danger';
      default: return 'text-muted';
    }
  }

  getStatusIcon(status: string): string {
    switch (status) {
      case 'pass': return '✓';
      case 'fail': return '✗';
      case 'skip': return '⊘';
      case 'error': return '⚠';
      default: return '?';
    }
  }

  getTotalTests(): number {
    const summary = this.testResults()?.testResultsSummary;
    if (!summary) return 0;
    return summary.passCount + summary.failCount + summary.skipCount + summary.errorCount;
  }

  getPassRate(): number {
    const summary = this.testResults()?.testResultsSummary;
    if (!summary) return 0;
    const total = this.getTotalTests();
    return total > 0 ? (summary.passCount / total) * 100 : 0;
  }

  goBack(): void {
    this.router.navigate(['/results/open']);
  }

  goBackToIndex(): void {
    const indexUrl = sessionStorage.getItem(SessionStorageKeys.INDEX_URL);
    if (indexUrl) {
      this.router.navigate(['/results/open'], { queryParams: { index: indexUrl } });
    } else {
      this.router.navigate(['/results/open']);
    }
  }

  hasIndexUrl(): boolean {
    return !!sessionStorage.getItem(SessionStorageKeys.INDEX_URL);
  }

  hasDetailedInfo(): boolean {
    return this.filteredResults().some(r => r.error || r.actual || r.expected);
  }

  toggleResultDetails(resultId: string): void {
    const expanded = new Set(this.expandedResults());
    if (expanded.has(resultId)) {
      expanded.delete(resultId);
    } else {
      expanded.add(resultId);
    }
    this.expandedResults.set(expanded);
  }

  isResultExpanded(resultId: string): boolean {
    return this.expandedResults().has(resultId) || this.showAllDetails();
  }

  toggleAllDetails(): void {
    this.showAllDetails.set(!this.showAllDetails());
  }

  getResultId(result: TestResult): string {
    return `${result.testName}-${result.groupName}-${result.expression}`;
  }

  hasResultDetails(result: TestResult): boolean {
    return !!(result.error || result.actual || result.expected || (result.capabilities && result.capabilities.length > 0));
  }

  formatCapabilityValue(value: any): string {
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value, null, 2);
    }
    return String(value);
  }

  isObjectValue(value: any): boolean {
    return value !== null && typeof value === 'object' && !Array.isArray(value) || Array.isArray(value);
  }

  hasCapabilityField(capabilities: Capability[] | undefined, field: 'system' | 'display' | 'version'): boolean {
    if (!capabilities || capabilities.length === 0) {
      return false;
    }
    return capabilities.some(c => c[field] !== undefined && c[field] !== null && c[field] !== '');
  }

  private updateChartData(): void {
    this.updatePieChartData();
    this.updateBarChartData();
  }

  private updatePieChartData(): void {
    const summary = this.testResults()?.testResultsSummary;
    if (!summary) return;

    this.pieChartData = {
      ...this.pieChartData,
      datasets: [{
        ...this.pieChartData.datasets[0],
        data: [summary.passCount, summary.failCount, summary.skipCount, summary.errorCount]
      }]
    };
  }

  private updateBarChartData(): void {
    const results = this.filteredResults();
    const groupCounts = new Map<string, { pass: number; fail: number; skip: number; error: number }>();

    // Count tests by group and result type
    results.forEach(result => {
      const group = result.groupName || 'Ungrouped';
      if (!groupCounts.has(group)) {
        groupCounts.set(group, { pass: 0, fail: 0, skip: 0, error: 0 });
      }
      
      const counts = groupCounts.get(group)!;
      switch (result.testStatus) {
        case 'pass':
          counts.pass++;
          break;
        case 'fail':
          counts.fail++;
          break;
        case 'skip':
          counts.skip++;
          break;
        case 'error':
          counts.error++;
          break;
      }
    });

    // Sort groups by total count (descending) and limit to top 10
    const sortedGroups = Array.from(groupCounts.entries())
      .map(([group, counts]) => ({
        group,
        counts,
        total: counts.pass + counts.fail + counts.skip + counts.error
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    this.barChartData = {
      labels: sortedGroups.map(item => item.group),
      datasets: [
        {
          ...this.barChartData.datasets[0],
          data: sortedGroups.map(item => item.counts.pass)
        },
        {
          ...this.barChartData.datasets[1],
          data: sortedGroups.map(item => item.counts.fail)
        },
        {
          ...this.barChartData.datasets[2],
          data: sortedGroups.map(item => item.counts.skip)
        },
        {
          ...this.barChartData.datasets[3],
          data: sortedGroups.map(item => item.counts.error)
        }
      ]
    };
  }

  private updateUrlWithPreservedParams(): void {
    const queryParams: any = {};
    
    // Always include the original URL parameter if it exists
    if (this.originalUrl) {
      queryParams.url = this.originalUrl;
    }
    
    // Only add parameters that are not default values
    if (this.selectedStatus() !== StatusFilter.ALL) {
      queryParams.status = this.selectedStatus();
    }
    
    if (this.searchTerm().trim()) {
      queryParams.search = this.searchTerm().trim();
    }
    
    if (this.groupBy() !== GroupByOption.NONE) {
      queryParams.groupBy = this.groupBy();
    }
    
    if (this.sortBy() !== SortByOption.NAME) {
      queryParams.sortBy = this.sortBy();
    }
    
    if (this.sortOrder() !== SortOrder.ASC) {
      queryParams.sortOrder = this.sortOrder();
    }
    
    // Update URL without triggering navigation
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: queryParams,
      queryParamsHandling: 'replace',
      replaceUrl: true
    });
  }

  private async loadFromUrl(url: string): Promise<void> {
    try {
      const data = await this.fileLoader.loadFromUrl(url);
      
      // Check if schema validation is enabled
      if (this.settingsService.settings().validateSchema) {
        const validation = await this.schemaValidation.validateResults(data);
        
        if (validation.isValid) {
          sessionStorage.setItem(SessionStorageKeys.CQL_TEST_RESULTS, JSON.stringify(data));
          this.testResults.set(data);
          this.loadInitialParameters();
          this.applyFilters();
          this.updateChartData();
          this.updateUrlWithPreservedParams();
        } else {
          console.error('Validation errors:', validation.errors);
          // Still load results but show validation errors
          sessionStorage.setItem(SessionStorageKeys.CQL_TEST_RESULTS, JSON.stringify(data));
          sessionStorage.setItem(SessionStorageKeys.VALIDATION_ERRORS, JSON.stringify(validation.errors));
          this.testResults.set(data);
          this.loadInitialParameters();
          this.applyFilters();
          this.updateChartData();
          this.updateUrlWithPreservedParams();
        }
      } else {
        // Skip validation, just store and load
        sessionStorage.setItem(SessionStorageKeys.CQL_TEST_RESULTS, JSON.stringify(data));
        this.testResults.set(data);
        this.loadInitialParameters();
        this.applyFilters();
        this.updateChartData();
        this.updateUrlWithPreservedParams();
      }
    } catch (error) {
      console.error('Error loading from URL:', error);
      this.router.navigate(['/results/open']);
    }
  }

  /**
   * Start polling for new results in sessionStorage
   */
  private startPolling(): void {
    this.pollingSubscription = interval(1000) // Check every second
      .subscribe(() => {
        this.checkForNewResults();
      });
  }

  /**
   * Stop polling for new results
   */
  private stopPolling(): void {
    if (this.pollingSubscription) {
      this.pollingSubscription.unsubscribe();
      this.pollingSubscription = undefined;
    }
  }

  /**
   * Check if there are new results in sessionStorage
   */
  private checkForNewResults(): void {
    const storedData = sessionStorage.getItem(SessionStorageKeys.CQL_TEST_RESULTS);
    if (storedData) {
      try {
        const data = JSON.parse(storedData) as CqlTestResults;
        const currentHash = this.generateResultsHash(data);
        
        // If the hash has changed, reload the results
        if (this.lastResultsHash !== currentHash) {
          console.log('New results detected, refreshing...');
          this.testResults.set(data);
          this.applyFilters();
          this.updateChartData();
          this.lastResultsHash = currentHash;
        }
      } catch (error) {
        console.error('Error parsing stored data during polling:', error);
      }
    }
  }

  /**
   * Generate a simple hash for the results data to detect changes
   */
  private generateResultsHash(data: CqlTestResults): string {
    // Create a simple hash based on the results data
    const resultsString = JSON.stringify(data.results || []);
    const summaryString = JSON.stringify(data.testResultsSummary || {});
    return btoa(resultsString + summaryString).substring(0, 16);
  }
}
