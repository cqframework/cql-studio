// Author: Preston Lee

import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration, ChartData, ChartType } from 'chart.js';
import { SessionStorageKeys } from '../../constants/session-storage.constants';
import { CqlTestResults, TestResult, TestResultsSummary, TestError } from '../../models/cql-test-results.model';

interface DashboardData {
  filename: string;
  summary: TestResultsSummary;
  results: TestResult[];
  engine: string;
  timestamp: string;
}

interface ChartDataPoint {
  label: string;
  value: number;
  color: string;
}

interface ComparisonTest {
  testName: string;
  groupName: string;
  results: {
    filename: string;
    engine: string;
    testStatus: 'pass' | 'fail' | 'skip' | 'error';
    actual?: string;
    expected?: string;
    error?: TestError;
  }[];
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, BaseChartDirective],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss'
})
export class DashboardComponent implements OnInit {
  // Data signals
  dashboardData = signal<DashboardData[]>([]);
  isLoading = signal(false);
  errorMessage = signal('');
  
  // Filter and sort signals
  selectedFiles = signal<string[]>([]);
  statusFilter = signal<string>('all');
  sortBy = signal<string>('filename');
  sortOrder = signal<'asc' | 'desc'>('asc');
  
  // Comparison Matrix filter and sort signals
  matrixStatusFilter = signal<string>('all');
  matrixGroupFilter = signal<string>('all');
  matrixConsistencyFilter = signal<string>('all');
  matrixSearchTerm = signal<string>('');
  matrixSortBy = signal<string>('groupName');
  matrixSortOrder = signal<'asc' | 'desc'>('asc');
  
  // Computed values
  filteredData = computed(() => {
    let data = this.dashboardData();
    
    // Filter by selected files
    if (this.selectedFiles().length > 0) {
      data = data.filter(item => this.selectedFiles().includes(item.filename));
    }
    
    // Filter by status
    if (this.statusFilter() !== 'all') {
      data = data.filter(item => {
        const summary = item.summary;
        switch (this.statusFilter()) {
          case 'pass':
            return summary.passCount > 0;
          case 'fail':
            return summary.failCount > 0;
          case 'skip':
            return summary.skipCount > 0;
          case 'error':
            return summary.errorCount > 0;
          default:
            return true;
        }
      });
    }
    
    // Sort data
    data.sort((a, b) => {
      let aValue: any, bValue: any;
      
      switch (this.sortBy()) {
        case 'engine':
          aValue = a.engine;
          bValue = b.engine;
          break;
        case 'filename':
          aValue = a.filename;
          bValue = b.filename;
          break;
        case 'passCount':
          aValue = a.summary.passCount;
          bValue = b.summary.passCount;
          break;
        case 'failCount':
          aValue = a.summary.failCount;
          bValue = b.summary.failCount;
          break;
        case 'skipCount':
          aValue = a.summary.skipCount;
          bValue = b.summary.skipCount;
          break;
        case 'errorCount':
          aValue = a.summary.errorCount;
          bValue = b.summary.errorCount;
          break;
        case 'totalTests':
          aValue = a.summary.passCount + a.summary.failCount + a.summary.skipCount + a.summary.errorCount;
          bValue = b.summary.passCount + b.summary.failCount + b.summary.skipCount + b.summary.errorCount;
          break;
        case 'timestamp':
          aValue = new Date(a.timestamp).getTime();
          bValue = new Date(b.timestamp).getTime();
          break;
        default:
          aValue = a.filename;
          bValue = b.filename;
      }
      
      if (this.sortOrder() === 'desc') {
        return bValue > aValue ? 1 : -1;
      } else {
        return aValue > bValue ? 1 : -1;
      }
    });
    
    return data;
  });
  
  // Summary totals
  totalPass = computed(() => this.filteredData().reduce((sum, item) => sum + item.summary.passCount, 0));
  totalFail = computed(() => this.filteredData().reduce((sum, item) => sum + item.summary.failCount, 0));
  totalSkip = computed(() => this.filteredData().reduce((sum, item) => sum + item.summary.skipCount, 0));
  totalError = computed(() => this.filteredData().reduce((sum, item) => sum + item.summary.errorCount, 0));
  
  // Comparison matrix data
  comparisonMatrix = computed((): ComparisonTest[] => {
    const data = this.filteredData();
    const selectedFiles = this.selectedFiles();
    const testMap = new Map<string, ComparisonTest>();
    
    // Only include files that are selected for comparison
    const filesToCompare = data.filter(fileData => selectedFiles.includes(fileData.filename));
    
    // Group tests by name and group across selected files
    filesToCompare.forEach(fileData => {
      fileData.results.forEach(test => {
        const key = `${test.groupName}::${test.testName}`;
        
        if (!testMap.has(key)) {
          testMap.set(key, {
            testName: test.testName,
            groupName: test.groupName,
            results: []
          });
        }
        
        testMap.get(key)!.results.push({
          filename: fileData.filename,
          engine: fileData.engine,
          testStatus: test.testStatus,
          actual: test.actual,
          expected: test.expected,
          error: test.error
        });
      });
    });
    
    // Convert to array
    let result = Array.from(testMap.values());
    
    // Apply filters
    result = this.applyMatrixFilters(result);
    
    // Apply sorting
    result = this.applyMatrixSorting(result);
    
    return result;
  });
  
  // Chart configurations
  summaryChartData = computed((): ChartData<'doughnut'> => {
    const data = this.filteredData();
    const totalPass = data.reduce((sum, item) => sum + item.summary.passCount, 0);
    const totalFail = data.reduce((sum, item) => sum + item.summary.failCount, 0);
    const totalSkip = data.reduce((sum, item) => sum + item.summary.skipCount, 0);
    const totalError = data.reduce((sum, item) => sum + item.summary.errorCount, 0);
    
    return {
      labels: ['Pass', 'Fail', 'Skip', 'Error'],
      datasets: [{
        data: [totalPass, totalFail, totalSkip, totalError],
        backgroundColor: ['#28a745', '#dc3545', '#ffc107', '#6c757d'],
        borderWidth: 2,
        borderColor: '#fff'
      }]
    };
  });
  
  summaryChartOptions: ChartConfiguration<'doughnut'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom'
      },
      title: {
        display: true,
        text: 'Overall Test Results Summary'
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            const label = context.label || '';
            const value = context.parsed;
            const total = context.dataset.data.reduce((a: number, b: number) => a + b, 0);
            const percentage = ((value / total) * 100).toFixed(1);
            return `${label}: ${value} tests (${percentage}%)`;
          },
          afterLabel: (context) => {
            const label = context.label || '';
            const data = this.filteredData();
            
            // Get engine breakdown for this category
            const engineBreakdown = data.map(item => {
              let count = 0;
              switch (label) {
                case 'Pass':
                  count = item.summary.passCount;
                  break;
                case 'Fail':
                  count = item.summary.failCount;
                  break;
                case 'Skip':
                  count = item.summary.skipCount;
                  break;
                case 'Error':
                  count = item.summary.errorCount;
                  break;
              }
              return { engine: item.engine, count };
            }).filter(item => item.count > 0);
            
            if (engineBreakdown.length === 0) {
              return `No ${label.toLowerCase()} tests found`;
            }
            
            // Create breakdown text
            const breakdownText = engineBreakdown
              .map(item => `${item.engine}: ${item.count}`)
              .join('\n');
            
            return `Breakdown by Engine:\n${breakdownText}`;
          }
        },
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        titleColor: '#fff',
        bodyColor: '#fff',
        borderColor: '#fff',
        borderWidth: 1,
        cornerRadius: 6,
        displayColors: true,
        titleFont: {
          size: 14,
          weight: 'bold'
        },
        bodyFont: {
          size: 12
        }
      }
    }
  };
  
  fileComparisonChartData = computed((): ChartData<'bar'> => {
    const data = this.filteredData();
    
    return {
      labels: data.map(item => item.engine),
      datasets: [
        {
          label: 'Pass',
          data: data.map(item => item.summary.passCount),
          backgroundColor: '#28a745'
        },
        {
          label: 'Fail',
          data: data.map(item => item.summary.failCount),
          backgroundColor: '#dc3545'
        },
        {
          label: 'Skip',
          data: data.map(item => item.summary.skipCount),
          backgroundColor: '#ffc107'
        },
        {
          label: 'Error',
          data: data.map(item => item.summary.errorCount),
          backgroundColor: '#6c757d'
        }
      ]
    };
  });
  
  fileComparisonChartOptions: ChartConfiguration<'bar'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        stacked: true
      },
      y: {
        stacked: true,
        beginAtZero: true
      }
    },
    plugins: {
      title: {
        display: true,
        text: 'Test Results by Engine'
      }
    }
  };
  
  constructor(private router: Router, private route: ActivatedRoute) {}
  
  ngOnInit(): void {
    // Check if there's an index query parameter and no session storage data
    const indexParam = this.route.snapshot.queryParams['index'];
    const hasSessionData = sessionStorage.getItem(SessionStorageKeys.INDEX_URL) && 
                          sessionStorage.getItem(SessionStorageKeys.INDEX_FILES);
    
    if (indexParam && !hasSessionData) {
      // If there's an index parameter but no session data, load the index file directly
      this.loadIndexFileDirectly(indexParam);
      return;
    }
    
    this.loadDashboardData();
  }
  
  async loadDashboardData(): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set('');
    
    try {
      const indexUrl = sessionStorage.getItem(SessionStorageKeys.INDEX_URL);
      const indexFilesStr = sessionStorage.getItem(SessionStorageKeys.INDEX_FILES);
      
      if (!indexUrl || !indexFilesStr) {
        throw new Error('No index data found. Please load an index file first.');
      }
      
      const indexFiles: string[] = JSON.parse(indexFilesStr);
      const baseUrl = this.getBaseUrlFromIndexUrl(indexUrl);
      
      // Load all files
      const dataPromises = indexFiles.map(filename => this.loadFileData(baseUrl, filename));
      const results = await Promise.allSettled(dataPromises);
      
      const dashboardData: DashboardData[] = [];
      
      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          dashboardData.push(result.value);
        } else {
          console.warn(`Failed to load ${indexFiles[index]}:`, result.status === 'rejected' ? result.reason : 'Unknown error');
        }
      });
      
      if (dashboardData.length === 0) {
        throw new Error('No valid test result files could be loaded.');
      }
      
      this.dashboardData.set(dashboardData);
      this.selectedFiles.set(indexFiles);
    } catch (error) {
      this.errorMessage.set((error as Error).message);
    } finally {
      this.isLoading.set(false);
    }
  }
  
  private async loadIndexFileDirectly(indexUrl: string): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set('');
    
    try {
      // Decode the URL in case it's URL-encoded
      const decodedUrl = decodeURIComponent(indexUrl);
      
      // Load the index file
      const response = await fetch(decodedUrl);
      if (!response.ok) {
        throw new Error(`Failed to load index file: ${response.statusText}`);
      }
      
      const indexData = await response.json();
      
      if (!indexData.files || !Array.isArray(indexData.files)) {
        throw new Error('Invalid index file format: missing or invalid files array');
      }
      
      // Store the index data in session storage
      sessionStorage.setItem(SessionStorageKeys.INDEX_URL, decodedUrl);
      sessionStorage.setItem(SessionStorageKeys.INDEX_FILES, JSON.stringify(indexData.files));
      
      // Now load the dashboard data
      await this.loadDashboardData();
      
    } catch (error) {
      this.errorMessage.set(`Failed to load index file: ${(error as Error).message}`);
    } finally {
      this.isLoading.set(false);
    }
  }
  
  private async loadFileData(baseUrl: string, filename: string): Promise<DashboardData | null> {
    try {
      const fileUrl = `${baseUrl}/${filename}`;
      const response = await fetch(fileUrl);
      
      if (!response.ok) {
        throw new Error(`Failed to load ${filename}: ${response.statusText}`);
      }
      
      const data: CqlTestResults = await response.json();
      
      return {
        filename,
        summary: data.testResultsSummary,
        results: data.results,
        engine: data.cqlengine.cqlEngine || data.cqlengine.apiUrl,
        timestamp: data.testsRunDateTime
      };
    } catch (error) {
      console.error(`Error loading ${filename}:`, error);
      return null;
    }
  }
  
  private getBaseUrlFromIndexUrl(indexUrl: string): string {
    try {
      const urlObj = new URL(indexUrl);
      return `${urlObj.protocol}//${urlObj.host}${urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/'))}`;
    } catch (error) {
      const lastSlashIndex = indexUrl.lastIndexOf('/');
      return lastSlashIndex > 0 ? indexUrl.substring(0, lastSlashIndex) : indexUrl;
    }
  }
  
  onFileSelectionChange(filename: string, checked: boolean): void {
    const selected = this.selectedFiles();
    if (checked) {
      this.selectedFiles.set([...selected, filename]);
    } else {
      this.selectedFiles.set(selected.filter(f => f !== filename));
    }
  }
  
  onSelectAllFiles(): void {
    const allFiles = this.dashboardData().map(item => item.filename);
    this.selectedFiles.set(allFiles);
  }
  
  onDeselectAllFiles(): void {
    this.selectedFiles.set([]);
  }
  
  onStatusFilterChange(status: string): void {
    this.statusFilter.set(status);
  }
  
  onSortChange(sortBy: string): void {
    this.sortBy.set(sortBy);
  }
  
  onSortBy(sortBy: string): void {
    if (this.sortBy() === sortBy) {
      // If clicking the same column, toggle sort order
      this.sortOrder.set(this.sortOrder() === 'asc' ? 'desc' : 'asc');
    } else {
      // If clicking a different column, set new sort field and default to ascending
      this.sortBy.set(sortBy);
      this.sortOrder.set('asc');
    }
  }
  
  onSortOrderChange(): void {
    this.sortOrder.set(this.sortOrder() === 'asc' ? 'desc' : 'asc');
  }
  
  onBackToIndex(): void {
    // Preserve the index query parameter when navigating back
    const indexUrl = sessionStorage.getItem(SessionStorageKeys.INDEX_URL);
    const queryParams: any = {};
    if (indexUrl) {
      queryParams['index'] = indexUrl;
    }
    
    this.router.navigate(['/results/open'], { queryParams });
  }
  
  onViewFile(filename: string): void {
    const indexUrl = sessionStorage.getItem(SessionStorageKeys.INDEX_URL);
    if (indexUrl) {
      const baseUrl = this.getBaseUrlFromIndexUrl(indexUrl);
      const fileUrl = `${baseUrl}/${filename}`;
      this.router.navigate(['/results'], { queryParams: { url: fileUrl } });
    }
  }
  
  getStatusBadgeClass(status: 'pass' | 'fail' | 'skip' | 'error'): string {
    switch (status) {
      case 'pass':
        return 'bg-success';
      case 'fail':
        return 'bg-danger';
      case 'skip':
        return 'bg-warning';
      case 'error':
        return 'bg-secondary';
      default:
        return 'bg-secondary';
    }
  }
  
  getStatusIcon(status: 'pass' | 'fail' | 'skip' | 'error'): string {
    switch (status) {
      case 'pass':
        return 'bi-check-circle-fill';
      case 'fail':
        return 'bi-x-circle-fill';
      case 'skip':
        return 'bi-skip-forward-circle-fill';
      case 'error':
        return 'bi-exclamation-triangle-fill';
      default:
        return 'bi-question-circle-fill';
    }
  }
  
  getConsistencyStatus(test: ComparisonTest): { status: string; badgeClass: string; icon: string; text: string } {
    // Only consider results from files that are selected for comparison
    const selectedFiles = this.selectedFiles();
    const statuses: string[] = [];
    
    // For each file selected for comparison, determine its status
    selectedFiles.forEach(filename => {
      const result = this.getTestResultForFile(test, filename);
      if (result) {
        statuses.push(result.testStatus);
      } else {
        statuses.push('not-found');
      }
    });
    
    const uniqueStatuses = [...new Set(statuses)];
    
    if (uniqueStatuses.length === 0) {
      return {
        status: 'no-data',
        badgeClass: 'bg-secondary',
        icon: 'bi-question-circle',
        text: 'No Data'
      };
    } else if (uniqueStatuses.length === 1) {
      return {
        status: 'consistent',
        badgeClass: 'bg-success',
        icon: 'bi-check-circle',
        text: 'Consistent'
      };
    } else {
      return {
        status: 'inconsistent',
        badgeClass: 'bg-warning',
        icon: 'bi-exclamation-triangle',
        text: 'Inconsistent'
      };
    }
  }
  
  getTestResultForFile(test: ComparisonTest, filename: string): { filename: string; engine: string; testStatus: 'pass' | 'fail' | 'skip' | 'error'; actual?: string; expected?: string; error?: TestError; } | undefined {
    return test.results.find(r => r.filename === filename);
  }
  
  getResultTooltip(result: { filename: string; engine: string; testStatus: 'pass' | 'fail' | 'skip' | 'error'; actual?: string; expected?: string; error?: TestError; }): string {
    let tooltip = `${result.testStatus.toUpperCase()} - ${result.engine}`;
    
    if (result.testStatus === 'fail' && result.actual && result.expected) {
      tooltip += `\nExpected: ${result.expected}\nActual: ${result.actual}`;
    }
    
    if (result.testStatus === 'error' && result.error) {
      tooltip += `\nError: ${result.error.message}`;
    }
    
    return tooltip;
  }
  
  // Files selected for comparison
  filesForComparison = computed(() => {
    const data = this.filteredData();
    const selectedFiles = this.selectedFiles();
    return data.filter(fileData => selectedFiles.includes(fileData.filename));
  });

  // Available groups for matrix filtering
  availableGroups = computed((): string[] => {
    const data = this.filteredData();
    const groups = new Set<string>();
    
    data.forEach(fileData => {
      fileData.results.forEach(test => {
        groups.add(test.groupName);
      });
    });
    
    return Array.from(groups).sort();
  });
  
  // Apply filters to comparison matrix
  private applyMatrixFilters(tests: ComparisonTest[]): ComparisonTest[] {
    let filtered = tests;
    
    // Search filter
    const searchTerm = this.matrixSearchTerm().toLowerCase();
    if (searchTerm) {
      filtered = filtered.filter(test => 
        test.testName.toLowerCase().includes(searchTerm) ||
        test.groupName.toLowerCase().includes(searchTerm)
      );
    }
    
    // Group filter
    const groupFilter = this.matrixGroupFilter();
    if (groupFilter !== 'all') {
      filtered = filtered.filter(test => test.groupName === groupFilter);
    }
    
    // Status filter
    const statusFilter = this.matrixStatusFilter();
    if (statusFilter !== 'all') {
      filtered = filtered.filter(test => {
        const statuses = test.results.map(r => r.testStatus);
        return statuses.includes(statusFilter as 'pass' | 'fail' | 'skip' | 'error');
      });
    }
    
    // Consistency filter
    const consistencyFilter = this.matrixConsistencyFilter();
    if (consistencyFilter !== 'all') {
      filtered = filtered.filter(test => {
        const consistency = this.getConsistencyStatus(test);
        return consistency.status === consistencyFilter;
      });
    }
    
    return filtered;
  }
  
  // Apply sorting to comparison matrix
  private applyMatrixSorting(tests: ComparisonTest[]): ComparisonTest[] {
    const sortBy = this.matrixSortBy();
    const sortOrder = this.matrixSortOrder();
    
    return tests.sort((a, b) => {
      let aValue: any, bValue: any;
      
      switch (sortBy) {
        case 'groupName':
          aValue = a.groupName;
          bValue = b.groupName;
          break;
        case 'testName':
          aValue = a.testName;
          bValue = b.testName;
          break;
        case 'consistency':
          const aConsistency = this.getConsistencyStatus(a);
          const bConsistency = this.getConsistencyStatus(b);
          aValue = aConsistency.status;
          bValue = bConsistency.status;
          break;
        case 'resultCount':
          aValue = a.results.length;
          bValue = b.results.length;
          break;
        default:
          aValue = a.groupName;
          bValue = b.groupName;
      }
      
      if (sortOrder === 'desc') {
        return bValue > aValue ? 1 : -1;
      } else {
        return aValue > bValue ? 1 : -1;
      }
    });
  }
  
  // Matrix filter and sort event handlers
  onMatrixStatusFilterChange(status: string): void {
    this.matrixStatusFilter.set(status);
  }
  
  onMatrixGroupFilterChange(group: string): void {
    this.matrixGroupFilter.set(group);
  }
  
  onMatrixConsistencyFilterChange(consistency: string): void {
    this.matrixConsistencyFilter.set(consistency);
  }
  
  onMatrixSearchChange(searchTerm: string): void {
    this.matrixSearchTerm.set(searchTerm);
  }
  
  onMatrixSortChange(sortBy: string): void {
    this.matrixSortBy.set(sortBy);
  }
  
  onMatrixSortOrderChange(): void {
    this.matrixSortOrder.set(this.matrixSortOrder() === 'asc' ? 'desc' : 'asc');
  }
  
  onMatrixSortBy(sortBy: string): void {
    if (this.matrixSortBy() === sortBy) {
      this.matrixSortOrder.set(this.matrixSortOrder() === 'asc' ? 'desc' : 'asc');
    } else {
      this.matrixSortBy.set(sortBy);
      this.matrixSortOrder.set('asc');
    }
  }
  
  clearMatrixFilters(): void {
    this.matrixStatusFilter.set('all');
    this.matrixGroupFilter.set('all');
    this.matrixConsistencyFilter.set('all');
    this.matrixSearchTerm.set('');
  }
  
  // Download functionality
  downloadMatrixAsCsv(): void {
    const data = this.comparisonMatrix();
    const filesForComparison = this.filesForComparison();
    
    if (data.length === 0) {
      alert('No data to download');
      return;
    }
    
    // Create CSV headers
    const headers = ['Group', 'Test Name', 'Consistency'];
    filesForComparison.forEach(fileData => {
      headers.push(`${fileData.engine} (${fileData.filename})`);
    });
    
    // Create CSV rows
    const rows = data.map(test => {
      const consistency = this.getConsistencyStatus(test);
      const row = [test.groupName, test.testName, consistency.text];
      
      // Add results for each file
      filesForComparison.forEach(fileData => {
        const result = this.getTestResultForFile(test, fileData.filename);
        if (result) {
          row.push(result.testStatus.toUpperCase());
        } else {
          row.push('NOT FOUND');
        }
      });
      
      return row;
    });
    
    // Convert to CSV
    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');
    
    // Download file
    this.downloadFile(csvContent, 'comparison-matrix.csv', 'text/csv');
  }
  
  downloadMatrixAsJson(): void {
    const data = this.comparisonMatrix();
    const filesForComparison = this.filesForComparison();
    
    if (data.length === 0) {
      alert('No data to download');
      return;
    }
    
    // Create JSON structure
    const exportData = {
      metadata: {
        exportDate: new Date().toISOString(),
        totalTests: data.length,
        totalFiles: filesForComparison.length,
        filters: {
          status: this.matrixStatusFilter(),
          group: this.matrixGroupFilter(),
          consistency: this.matrixConsistencyFilter(),
          search: this.matrixSearchTerm()
        },
        sortBy: this.matrixSortBy(),
        sortOrder: this.matrixSortOrder()
      },
      files: filesForComparison.map(fileData => ({
        filename: fileData.filename,
        engine: fileData.engine,
        timestamp: fileData.timestamp
      })),
      tests: data.map(test => {
        const consistency = this.getConsistencyStatus(test);
        const results: { [key: string]: any } = {};
        
        filesForComparison.forEach(fileData => {
          const result = this.getTestResultForFile(test, fileData.filename);
          if (result) {
            results[fileData.filename] = {
              engine: result.engine,
              status: result.testStatus,
              actual: result.actual,
              expected: result.expected,
              error: result.error
            };
          } else {
            results[fileData.filename] = null;
          }
        });
        
        return {
          groupName: test.groupName,
          testName: test.testName,
          consistency: {
            status: consistency.status,
            text: consistency.text
          },
          results: results
        };
      })
    };
    
    // Download file
    const jsonContent = JSON.stringify(exportData, null, 2);
    this.downloadFile(jsonContent, 'comparison-matrix.json', 'application/json');
  }
  
  private downloadFile(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }
}
