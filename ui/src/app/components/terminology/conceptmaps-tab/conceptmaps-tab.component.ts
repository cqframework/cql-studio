// Author: Preston Lee

import { Component, ChangeDetectionStrategy, signal, computed, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { SettingsService } from '../../../services/settings.service';
import { TerminologyService } from '../../../services/terminology.service';
import { ToastService } from '../../../services/toast.service';
import { ConceptMap, Bundle } from 'fhir/r4';
import { isResourceType } from '../../../services/fhir-resource-type.lib';
import { ConceptMapDetailsPaneComponent } from '../conceptmap-details-pane/conceptmap-details-pane.component';
import { TerminologyResourceOpenerService } from '../../../services/terminology-resource-opener.service';
import {
  bindTerminologyTabDeepLinks,
  openTerminologyFromExternalRequest,
} from '../../../services/terminology-external-open.lib';
import {
  hasTerminologyConfigured,
  parseBundlePage,
  terminologyHttpErrorMessage,
  terminologyResourceTrackId,
} from '../../../services/terminology-ui.lib';
import { BootstrapPaginationComponent } from '../../shared/bootstrap-pagination/bootstrap-pagination.component';
import { TerminologyResourceListItemComponent } from '../terminology-resource-list-item/terminology-resource-list-item.component';

@Component({
  selector: 'app-conceptmaps-tab',
  imports: [FormsModule, ConceptMapDetailsPaneComponent, BootstrapPaginationComponent, TerminologyResourceListItemComponent],
  templateUrl: './conceptmaps-tab.component.html',

  styleUrl: './conceptmaps-tab.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
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

  protected readonly hasValidConfiguration = computed(() =>
    hasTerminologyConfigured(this.settingsService.getEffectiveTerminologyEndpointAddress())
  );

  protected settingsService = inject(SettingsService);
  private terminologyService = inject(TerminologyService);
  private toastService = inject(ToastService);
  private terminologyOpener = inject(TerminologyResourceOpenerService);
  private route = inject(ActivatedRoute);

  private handledOpenKey: string | null = null;

  constructor() {
    bindTerminologyTabDeepLinks('ConceptMap', {
      opener: this.terminologyOpener,
      route: this.route,
      open: (id, url) => void this.openFromExternalRequest(id, url),
    });
  }

  ngOnInit(): void {
    if (this.hasValidConfiguration() && !this.conceptmapLoading()) {
      this.searchConceptMaps();
    }
  }

  private async openFromExternalRequest(id: string, url?: string): Promise<void> {
    await openTerminologyFromExternalRequest({
      resourceType: 'ConceptMap',
      id,
      url,
      getHandledKey: () => this.handledOpenKey,
      setHandledKey: (key) => {
        this.handledOpenKey = key;
      },
      hasValidConfiguration: () => this.hasValidConfiguration(),
      opener: this.terminologyOpener,
      toast: this.toastService,
      onOpened: (resource) => this.selectConceptMap(resource),
    });
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
      let result: Bundle;
      
      if (url) {
        // Use provided URL from Bundle link
        result = await firstValueFrom(this.terminologyService.fetchFromUrl<Bundle>(url));
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

      const page = parseBundlePage<ConceptMap>(result, 'ConceptMap', {
        pageSize: this.conceptmapPageSize(),
        currentPage: this.conceptmapCurrentPage(),
      });
      this.conceptmapResults.set(page.items);
      this.conceptmapBundleLinks.set(page.links);
      this.conceptmapTotalCount.set(page.total);

      if (!url) {
        this.conceptmapCurrentPage.set(1);
      }
    } catch (error) {
      const errorMessage = terminologyHttpErrorMessage(error);
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

  getConceptMapTrackId(conceptmap: ConceptMap, index: number): string {
    return terminologyResourceTrackId('conceptmap', conceptmap, index);
  }
}
