// Author: Preston Lee

import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { SettingsService } from '../../../services/settings.service';
import { TerminologyService } from '../../../services/terminology.service';
import { ToastService } from '../../../services/toast.service';
import { ConceptMap, Bundle } from 'fhir/r4';
import { ConceptMapDetailsPaneComponent } from '../conceptmap-details-pane/conceptmap-details-pane.component';

@Component({
  selector: 'app-conceptmaps-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, ConceptMapDetailsPaneComponent],
  templateUrl: './conceptmaps-tab.component.html',
  styleUrl: './conceptmaps-tab.component.scss'
})
export class ConceptMapsTabComponent implements OnInit {

  // ConceptMap search
  protected readonly conceptmapSearchTerm = signal<string>('');
  protected readonly conceptmapResults = signal<ConceptMap[]>([]);
  protected readonly conceptmapLoading = signal<boolean>(false);
  protected readonly conceptmapError = signal<string | null>(null);
  protected readonly selectedConceptMap = signal<ConceptMap | null>(null);
  
  // Filter and sort
  protected readonly conceptmapFilter = signal<string>('');
  protected readonly conceptmapSortBy = signal<'name' | 'url' | 'title' | 'status'>('name');
  protected readonly conceptmapSortOrder = signal<'asc' | 'desc'>('asc');

  // Pagination for ConceptMaps
  protected readonly conceptmapCurrentPage = signal<number>(1);
  protected readonly conceptmapPageSize = signal<number>(10);
  protected readonly conceptmapTotalCount = signal<number>(0);
  protected readonly conceptmapAvailablePageSizes = [10, 20, 50, 100];
  protected readonly conceptmapBundleLinks = signal<Map<string, string>>(new Map());

  // Filtered and sorted results count (for current page)
  protected readonly conceptmapFilteredCount = computed(() => {
    return this.getFilteredAndSortedConceptMaps().length;
  });

  // Pagination computed properties
  protected readonly conceptmapTotalPages = computed(() => {
    const total = this.conceptmapTotalCount();
    const size = this.conceptmapPageSize();
    return Math.max(1, Math.ceil(total / size));
  });

  protected readonly conceptmapHasPreviousPage = computed(() => {
    return this.conceptmapBundleLinks().has('previous') || this.conceptmapBundleLinks().has('prev');
  });

  protected readonly conceptmapHasNextPage = computed(() => {
    return this.conceptmapBundleLinks().has('next');
  });

  protected readonly conceptmapStartIndex = computed(() => {
    return (this.conceptmapCurrentPage() - 1) * this.conceptmapPageSize() + 1;
  });

  protected readonly conceptmapEndIndex = computed(() => {
    const total = this.conceptmapTotalCount();
    const end = this.conceptmapCurrentPage() * this.conceptmapPageSize();
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
    // Auto-load ConceptMaps when component is initialized
    if (this.hasValidConfiguration() && !this.conceptmapLoading()) {
      this.searchConceptMaps();
    }
  }

  // ConceptMap operations
  async searchConceptMaps(url?: string): Promise<void> {
    if (!this.hasValidConfiguration()) {
      const errorMessage = 'Please configure terminology service settings first.';
      this.conceptmapError.set(errorMessage);
      this.toastService.showWarning(errorMessage, 'Configuration Required');
      return;
    }

    this.conceptmapLoading.set(true);
    this.conceptmapError.set(null);

    try {
      let result: Bundle<ConceptMap>;
      
      if (url) {
        // Use provided URL from Bundle link
        result = await firstValueFrom(this.terminologyService.fetchFromUrl<Bundle<ConceptMap>>(url));
      } else {
        // Initial search or search with new criteria
        const searchTerm = this.conceptmapSearchTerm().trim();
        const pageSize = this.conceptmapPageSize();
        const params: any = {
          _count: pageSize
        };

        if (searchTerm) {
          params.name = searchTerm;
        }

        result = await firstValueFrom(this.terminologyService.searchConceptMaps(params));
        this.conceptmapCurrentPage.set(1);
      }

      this.conceptmapResults.set(result?.entry?.map(e => e.resource!) || []);

      // Extract and store Bundle links
      const linksMap = new Map<string, string>();
      if (result?.link) {
        console.log('Bundle links received (ConceptMap):', result.link);
        for (const link of result.link) {
          if (link.relation && link.url) {
            linksMap.set(link.relation, link.url);
            console.log(`Stored Bundle link: ${link.relation} -> ${link.url}`);
          }
        }
      }
      this.conceptmapBundleLinks.set(linksMap);

      // Update total count from bundle
      if (result?.total !== undefined) {
        this.conceptmapTotalCount.set(result.total);
      } else {
        // Estimate total if not provided based on Bundle links
        const hasNext = linksMap.has('next');
        const currentResults = this.conceptmapResults().length;
        const pageSize = this.conceptmapPageSize();
        const currentPage = this.conceptmapCurrentPage();
        
        if (hasNext) {
          // Might have more results
          this.conceptmapTotalCount.set((currentPage * pageSize) + 1);
        } else {
          // This is likely the last page
          this.conceptmapTotalCount.set((currentPage - 1) * pageSize + currentResults);
        }
      }

      // Update current page based on Bundle links
      // If this is a new search (no URL provided), we're on page 1
      if (!url) {
        this.conceptmapCurrentPage.set(1);
      }
    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
      this.conceptmapError.set(errorMessage);
      this.toastService.showError(errorMessage, 'ConceptMap Search Failed');
    } finally {
      this.conceptmapLoading.set(false);
    }
  }

  selectConceptMap(conceptmap: ConceptMap): void {
    this.selectedConceptMap.set(conceptmap);
  }

  // Pagination methods for ConceptMaps
  conceptmapPreviousPage(): void {
    if (this.conceptmapLoading()) {
      return;
    }
    const links = this.conceptmapBundleLinks();
    const prevUrl = links.get('previous') || links.get('prev');
    if (prevUrl) {
      const currentPage = this.conceptmapCurrentPage();
      this.conceptmapCurrentPage.set(Math.max(1, currentPage - 1));
      this.searchConceptMaps(prevUrl);
    }
  }

  conceptmapNextPage(): void {
    if (this.conceptmapLoading()) {
      return;
    }
    const nextUrl = this.conceptmapBundleLinks().get('next');
    if (nextUrl) {
      const currentPage = this.conceptmapCurrentPage();
      this.conceptmapCurrentPage.set(currentPage + 1);
      this.searchConceptMaps(nextUrl);
    }
  }

  conceptmapGoToFirstPage(): void {
    if (this.conceptmapLoading()) {
      return;
    }
    const firstUrl = this.conceptmapBundleLinks().get('first');
    if (firstUrl) {
      this.conceptmapCurrentPage.set(1);
      this.searchConceptMaps(firstUrl);
    } else {
      // If no first link, do a new search (which will be page 1)
      this.conceptmapCurrentPage.set(1);
      this.searchConceptMaps();
    }
  }

  conceptmapGoToLastPage(): void {
    if (this.conceptmapLoading()) {
      return;
    }
    const lastUrl = this.conceptmapBundleLinks().get('last');
    if (lastUrl) {
      // We don't know the exact page number for last, but we can estimate from total
      const total = this.conceptmapTotalCount();
      const pageSize = this.conceptmapPageSize();
      if (total > 0) {
        this.conceptmapCurrentPage.set(Math.ceil(total / pageSize));
      }
      this.searchConceptMaps(lastUrl);
    }
  }

  setConceptMapPageSize(size: number): void {
    this.conceptmapPageSize.set(size);
    // Reset to first page and re-search with new page size
    this.searchConceptMaps();
  }

  // Reload ConceptMaps (similar to loadCodeSystems)
  loadConceptMaps(): void {
    this.conceptmapSearchTerm.set('');
    this.conceptmapFilter.set('');
    this.searchConceptMaps();
  }

  // Filter and sort methods
  onConceptMapFilterChange(value: string): void {
    this.conceptmapFilter.set(value);
  }

  setConceptMapSortBy(sortBy: 'name' | 'url' | 'title' | 'status'): void {
    this.conceptmapSortBy.set(sortBy);
  }

  toggleConceptMapSortOrder(): void {
    this.conceptmapSortOrder.set(this.conceptmapSortOrder() === 'asc' ? 'desc' : 'asc');
  }

  getFilteredAndSortedConceptMaps(): ConceptMap[] {
    let results = [...this.conceptmapResults()];

    // Apply filter
    const filter = this.conceptmapFilter().toLowerCase();
    if (filter) {
      results = results.filter(cm =>
        cm.name?.toLowerCase().includes(filter) ||
        cm.title?.toLowerCase().includes(filter) ||
        cm.url?.toLowerCase().includes(filter)
      );
    }

    // Apply sorting
    const sortBy = this.conceptmapSortBy();
    const sortOrder = this.conceptmapSortOrder();

    results.sort((a, b) => {
      let aValue = '';
      let bValue = '';

      switch (sortBy) {
        case 'name':
          aValue = a.name || '';
          bValue = b.name || '';
          break;
        case 'url':
          aValue = a.url || '';
          bValue = b.url || '';
          break;
        case 'title':
          aValue = a.title || '';
          bValue = b.title || '';
          break;
        case 'status':
          aValue = a.status || '';
          bValue = b.status || '';
          break;
      }

      const comparison = aValue.localeCompare(bValue);
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return results;
  }

  // Helper methods
  getConceptMapTrackId(conceptmap: ConceptMap, index: number): string {
    // Prioritize id (should be unique in FHIR), then url, then index with prefix
    // Always include index to ensure uniqueness even if id/url are duplicated or empty
    const id = conceptmap.id?.trim();
    const url = conceptmap.url?.trim();
    if (id) {
      return `conceptmap-id-${id}-${index}`;
    } else if (url) {
      return `conceptmap-url-${url}-${index}`;
    } else {
      return `conceptmap-${index}`;
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
