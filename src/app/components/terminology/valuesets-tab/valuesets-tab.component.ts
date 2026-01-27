// Author: Preston Lee

import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { SettingsService } from '../../../services/settings.service';
import { TerminologyService } from '../../../services/terminology.service';
import { ToastService } from '../../../services/toast.service';
import { ValueSet, Bundle } from 'fhir/r4';
import { ValueSetDetailsPaneComponent } from '../valueset-details-pane/valueset-details-pane.component';

@Component({
  selector: 'app-valuesets-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, ValueSetDetailsPaneComponent],
  templateUrl: './valuesets-tab.component.html',
  styleUrl: './valuesets-tab.component.scss'
})
export class ValueSetsTabComponent implements OnInit {

  // ValueSet search
  protected readonly valuesetSearchTerm = signal<string>('');
  protected readonly valuesetResults = signal<ValueSet[]>([]);
  protected readonly valuesetLoading = signal<boolean>(false);
  protected readonly valuesetError = signal<string | null>(null);
  protected readonly selectedValueSet = signal<ValueSet | null>(null);
  protected readonly expandedValueSet = signal<ValueSet | null>(null);
  protected readonly expandedCodes = signal<any[]>([]);
  protected readonly expandLoading = signal<boolean>(false);

  // Pagination for ValueSets
  protected readonly valuesetCurrentPage = signal<number>(1);
  protected readonly valuesetPageSize = signal<number>(5);
  protected readonly valuesetTotalCount = signal<number>(0);
  protected readonly valuesetAvailablePageSizes = [5, 10, 20, 50];
  protected readonly valuesetBundleLinks = signal<Map<string, string>>(new Map());

  // Pagination for Expanded Codes
  protected readonly currentPage = signal<number>(1);
  protected readonly pageSize = signal<number>(10);
  protected readonly availablePageSizes = [10, 20, 50, 100];

  // Expanded row state for Expanded Codes table
  protected readonly expandedRows = signal<Set<string>>(new Set());
  protected readonly expandedCodeDetails = signal<Map<string, any>>(new Map());
  protected readonly loadingDetails = signal<Set<string>>(new Set());

  // Pagination computed properties
  protected readonly paginatedCodes = computed(() => {
    const codes = this.expandedCodes();
    const size = this.pageSize();
    const page = this.currentPage();
    const startIndex = (page - 1) * size;
    const endIndex = startIndex + size;
    return codes.slice(startIndex, endIndex);
  });

  protected readonly totalPages = computed(() => {
    const codes = this.expandedCodes();
    const size = this.pageSize();
    return Math.max(1, Math.ceil(codes.length / size));
  });

  protected readonly hasPreviousPage = computed(() => {
    return this.currentPage() > 1;
  });

  protected readonly hasNextPage = computed(() => {
    return this.currentPage() < this.totalPages();
  });

  protected readonly startIndex = computed(() => {
    return (this.currentPage() - 1) * this.pageSize() + 1;
  });

  protected readonly endIndex = computed(() => {
    const total = this.expandedCodes().length;
    const end = this.currentPage() * this.pageSize();
    return Math.min(end, total);
  });

  // Pagination computed properties for ValueSets
  protected readonly valuesetTotalPages = computed(() => {
    const total = this.valuesetTotalCount();
    const size = this.valuesetPageSize();
    return Math.max(1, Math.ceil(total / size));
  });

  protected readonly valuesetHasPreviousPage = computed(() => {
    return this.valuesetBundleLinks().has('previous') || this.valuesetBundleLinks().has('prev');
  });

  protected readonly valuesetHasNextPage = computed(() => {
    return this.valuesetBundleLinks().has('next');
  });

  protected readonly valuesetStartIndex = computed(() => {
    return (this.valuesetCurrentPage() - 1) * this.valuesetPageSize() + 1;
  });

  protected readonly valuesetEndIndex = computed(() => {
    const total = this.valuesetTotalCount();
    const end = this.valuesetCurrentPage() * this.valuesetPageSize();
    return Math.min(end, total);
  });

  // Configuration status
  protected readonly hasValidConfiguration = computed(() => {
    const baseUrl = this.settingsService.getEffectiveTerminologyBaseUrl();
    return baseUrl.trim() !== '';
  });

  protected settingsService = inject(SettingsService);
  private terminologyService = inject(TerminologyService);
  private toastService = inject(ToastService);

  ngOnInit(): void {
    // Auto-load ValueSets when component is initialized
    if (this.hasValidConfiguration() && !this.valuesetLoading()) {
      this.searchValueSets();
    }
  }

  // ValueSet operations
  async searchValueSets(url?: string): Promise<void> {
    if (!this.hasValidConfiguration()) {
      const errorMessage = 'Please configure terminology service settings first.';
      this.valuesetError.set(errorMessage);
      this.toastService.showWarning(errorMessage, 'Configuration Required');
      return;
    }

    this.valuesetLoading.set(true);
    this.valuesetError.set(null);

    try {
      let result: Bundle<ValueSet>;
      
      if (url) {
        // Use provided URL from Bundle link
        result = await firstValueFrom(this.terminologyService.fetchFromUrl<Bundle<ValueSet>>(url));
      } else {
        // Initial search or search with new criteria
        const searchTerm = this.valuesetSearchTerm().trim();
        const pageSize = this.valuesetPageSize();
        const params: any = {
          _count: pageSize
        };

        if (searchTerm) {
          params.name = searchTerm;
        }

        result = await firstValueFrom(this.terminologyService.searchValueSets(params));
        this.valuesetCurrentPage.set(1);
      }

      this.valuesetResults.set(result?.entry?.map(e => e.resource!) || []);

      // Extract and store Bundle links
      const linksMap = new Map<string, string>();
      if (result?.link) {
        console.log('Bundle links received:', result.link);
        for (const link of result.link) {
          if (link.relation && link.url) {
            linksMap.set(link.relation, link.url);
            console.log(`Stored Bundle link: ${link.relation} -> ${link.url}`);
          }
        }
      }
      this.valuesetBundleLinks.set(linksMap);

      // Update total count from bundle
      if (result?.total !== undefined) {
        this.valuesetTotalCount.set(result.total);
      } else {
        // Estimate total if not provided based on Bundle links
        const hasNext = linksMap.has('next');
        const currentResults = this.valuesetResults().length;
        const pageSize = this.valuesetPageSize();
        const currentPage = this.valuesetCurrentPage();
        
        if (hasNext) {
          // Might have more results
          this.valuesetTotalCount.set((currentPage * pageSize) + 1);
        } else {
          // This is likely the last page
          this.valuesetTotalCount.set((currentPage - 1) * pageSize + currentResults);
        }
      }

      // Update current page based on Bundle links
      // If this is a new search (no URL provided), we're on page 1
      if (!url) {
        this.valuesetCurrentPage.set(1);
      }
    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
      this.valuesetError.set(errorMessage);
      this.toastService.showError(errorMessage, 'ValueSet Search Failed');
    } finally {
      this.valuesetLoading.set(false);
    }
  }

  async selectValueSet(valueset: ValueSet): Promise<void> {
    // Reset all expanded state from previous ValueSet selection
    this.expandedCodes.set([]);
    this.expandedRows.set(new Set());
    this.expandedCodeDetails.set(new Map());
    this.loadingDetails.set(new Set());
    this.expandedValueSet.set(null);
    this.currentPage.set(1);
    
    this.selectedValueSet.set(valueset);
    await this.expandValueSet();
  }

  async expandValueSet(): Promise<void> {
    const valueset = this.selectedValueSet();
    if (!valueset) return;

    this.expandLoading.set(true);

    try {
      // Try different approaches for ValueSet expansion
      let params: any = {
        includeDesignations: true,
        includeDefinition: true,
        activeOnly: true
      };

      // First try with ID if available (uses GET /ValueSet/{id}/$expand)
      if (valueset.id) {
        params.id = valueset.id;
        console.log('Expanding ValueSet with ID:', valueset.id);
      } else if (valueset.url) {
        // Fall back to URL, decode if encoded (uses POST /ValueSet/$expand)
        const url = decodeURIComponent(valueset.url);
        params.url = url;
        console.log('Expanding ValueSet with URL:', url);
      } else {
        throw new Error('No ID or URL available for ValueSet expansion');
      }

      const result = await firstValueFrom(this.terminologyService.expandValueSet(params));
      this.expandedValueSet.set(result || null);
      this.expandedCodes.set(result?.expansion?.contains || []);
      this.currentPage.set(1); // Reset to first page when expanding new ValueSet
    } catch (error) {
      console.error('ValueSet expansion error:', error);

      // If error mentions unknown ValueSet, try alternative approach
      if ((error as any)?.error?.issue?.[0]?.diagnostics?.includes('Unknown ValueSet')) {
        console.log('ValueSet not found, trying alternative approach...');
        try {
          // Try with just the ValueSet name/identifier
          const alternativeParams = {
            valueSet: valueset.name || valueset.id,
            includeDesignations: true,
            includeDefinition: true,
            activeOnly: true
          };

          const result = await firstValueFrom(this.terminologyService.expandValueSet(alternativeParams));
          this.expandedCodes.set(result?.expansion?.contains || []);
          this.currentPage.set(1);
          return;
        } catch (altError) {
          console.error('Alternative expansion also failed:', altError);
        }
      }

      const errorMessage = this.getErrorMessage(error) + ' The server might not support expansion of this specific value set.';
      this.valuesetError.set(errorMessage);
      this.toastService.showWarning(errorMessage, 'ValueSet Expansion Failed');
    } finally {
      this.expandLoading.set(false);
    }
  }

  // Pagination methods for ValueSets
  valuesetPreviousPage(): void {
    if (this.valuesetLoading()) {
      return;
    }
    const links = this.valuesetBundleLinks();
    const prevUrl = links.get('previous') || links.get('prev');
    if (prevUrl) {
      const currentPage = this.valuesetCurrentPage();
      this.valuesetCurrentPage.set(Math.max(1, currentPage - 1));
      this.searchValueSets(prevUrl);
    }
  }

  valuesetNextPage(): void {
    if (this.valuesetLoading()) {
      return;
    }
    const nextUrl = this.valuesetBundleLinks().get('next');
    if (nextUrl) {
      const currentPage = this.valuesetCurrentPage();
      this.valuesetCurrentPage.set(currentPage + 1);
      this.searchValueSets(nextUrl);
    }
  }

  valuesetGoToFirstPage(): void {
    if (this.valuesetLoading()) {
      return;
    }
    const firstUrl = this.valuesetBundleLinks().get('first');
    if (firstUrl) {
      this.valuesetCurrentPage.set(1);
      this.searchValueSets(firstUrl);
    } else {
      // If no first link, do a new search (which will be page 1)
      this.valuesetCurrentPage.set(1);
      this.searchValueSets();
    }
  }

  valuesetGoToLastPage(): void {
    if (this.valuesetLoading()) {
      return;
    }
    const lastUrl = this.valuesetBundleLinks().get('last');
    if (lastUrl) {
      // We don't know the exact page number for last, but we can estimate from total
      const total = this.valuesetTotalCount();
      const pageSize = this.valuesetPageSize();
      if (total > 0) {
        this.valuesetCurrentPage.set(Math.ceil(total / pageSize));
      }
      this.searchValueSets(lastUrl);
    }
  }

  setValueSetPageSize(size: number): void {
    this.valuesetPageSize.set(size);
    // Reset to first page and re-search with new page size
    this.searchValueSets();
  }

  // Row expansion methods for Expanded Codes table
  toggleRowExpansion(code: any): void {
    const codeKey = `${code.code}-${code.system}`;
    const expanded = new Set(this.expandedRows());

    if (expanded.has(codeKey)) {
      expanded.delete(codeKey);
    } else {
      expanded.add(codeKey);
      // Load details if not already loaded
      if (!this.expandedCodeDetails().has(codeKey)) {
        this.loadCodeDetailsForExpansion(code, codeKey);
      }
    }

    this.expandedRows.set(expanded);
  }

  async loadCodeDetailsForExpansion(code: any, codeKey: string): Promise<void> {
    if (!this.hasValidConfiguration()) {
      return;
    }

    // Add to loading set
    const loading = new Set(this.loadingDetails());
    loading.add(codeKey);
    this.loadingDetails.set(loading);

    try {
      const params = {
        code: code.code,
        system: code.system
      };

      const result = await firstValueFrom(this.terminologyService.lookupCode(params));

      // Store the result
      const details = new Map(this.expandedCodeDetails());
      details.set(codeKey, result);
      this.expandedCodeDetails.set(details);

    } catch (error) {
      console.error('Failed to load code details:', error);
      // Store error in details
      const details = new Map(this.expandedCodeDetails());
      details.set(codeKey, { error: this.getErrorMessage(error) });
      this.expandedCodeDetails.set(details);
    } finally {
      // Remove from loading set
      const loading = new Set(this.loadingDetails());
      loading.delete(codeKey);
      this.loadingDetails.set(loading);
    }
  }

  // Helper methods
  formatDate(dateString?: string): string {
    if (!dateString) return '';
    return new Date(dateString).toLocaleDateString();
  }

  getValueSetTrackId(valueset: ValueSet, index: number): string {
    // Prioritize id (should be unique in FHIR), then url, then index with prefix
    // Always include index to ensure uniqueness even if id/url are duplicated or empty
    const id = valueset.id?.trim();
    const url = valueset.url?.trim();
    if (id) {
      return `valueset-id-${id}-${index}`;
    } else if (url) {
      return `valueset-url-${url}-${index}`;
    } else {
      return `valueset-${index}`;
    }
  }

  private getErrorMessage(error: any): string {
    if (error?.status === 401 || error?.status === 403) {
      return 'Authentication failed. The terminology server may require authentication. Please check your authorization bearer token in Settings.';
    }
    if (error?.status === 404) {
      return 'Server responded with 404 error: not found.';
    }
    if (error?.status >= 500) {
      return 'Server error. Please try again later.';
    }
    return error?.message || 'An unexpected error occurred.';
  }
}
