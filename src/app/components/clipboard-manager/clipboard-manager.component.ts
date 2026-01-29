// Author: Preston Lee

import { Component, OnInit, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { FhirCapabilityService, CapabilitySearchParam } from '../../services/fhir-capability.service';
import { FhirSearchService } from '../../services/fhir-search.service';
import { ClipboardService, ClipboardItem, ClipboardSortBy, ClipboardSortOrder } from '../../services/clipboard.service';
import { SettingsService } from '../../services/settings.service';
import { ToastService } from '../../services/toast.service';
import { Resource } from 'fhir/r4';

@Component({
  selector: 'app-clipboard-manager',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './clipboard-manager.component.html',
  styleUrl: './clipboard-manager.component.scss'
})
export class ClipboardManagerComponent implements OnInit {
  private readonly capabilityService = inject(FhirCapabilityService);
  private readonly searchService = inject(FhirSearchService);
  private readonly clipboardService = inject(ClipboardService);
  private readonly settingsService = inject(SettingsService);
  private readonly toastService = inject(ToastService);

  readonly selectedResourceType = signal<string>('');
  readonly searchParamValues = signal<Record<string, string>>({});
  readonly searchLoading = signal<boolean>(false);
  readonly searchError = signal<string | null>(null);
  readonly searchResults = signal<Resource[]>([]);
  readonly searchTotalCount = signal<number>(0);
  readonly searchCurrentPage = signal<number>(1);
  readonly searchPageSize = signal<number>(5);
  readonly searchBundleLinks = signal<Map<string, string>>(new Map());
  readonly searchHasRun = signal<boolean>(false);
  readonly availablePageSizes = [1, 5, 10, 20];

  readonly clipboardSearchTerm = signal<string>('');
  readonly clipboardTypeFilters = signal<string[]>([]);
  readonly clipboardSortBy = signal<ClipboardSortBy>('addedAt');
  readonly clipboardSortOrder = signal<ClipboardSortOrder>('desc');
  readonly expandedClipboardId = signal<string | null>(null);

  readonly resourceTypes = this.capabilityService.resourceTypes;
  readonly capabilityLoading = this.capabilityService.loading;
  readonly capabilityError = this.capabilityService.error;

  readonly searchParamsForSelectedType = computed<CapabilitySearchParam[]>(() => {
    const type = this.selectedResourceType();
    return type ? this.capabilityService.getSearchParamsForType(type) : [];
  });

  readonly clipboardDistinctTypes = computed<string[]>(() => {
    const items = this.clipboardService.list();
    const types = new Set(items.map((i) => i.fhirType));
    return Array.from(types).sort();
  });

  readonly clipboardItems = computed<ClipboardItem[]>(() => {
    const filtered = this.clipboardService.query({
      search: this.clipboardSearchTerm(),
      sortBy: this.clipboardSortBy(),
      sortOrder: this.clipboardSortOrder()
    });
    const typeFilters = this.clipboardTypeFilters();
    if (typeFilters.length === 0) {
      return filtered;
    }
    const set = new Set(typeFilters);
    return filtered.filter((item) => set.has(item.fhirType));
  });

  readonly searchTotalPages = computed(() => {
    const total = this.searchTotalCount();
    const size = this.searchPageSize();
    return Math.max(1, Math.ceil(total / size));
  });

  readonly searchHasPreviousPage = computed(
    () => this.searchBundleLinks().has('previous') || this.searchBundleLinks().has('prev')
  );

  readonly searchHasNextPage = computed(() => this.searchBundleLinks().has('next'));

  readonly searchStartIndex = computed(
    () => (this.searchCurrentPage() - 1) * this.searchPageSize() + 1
  );

  readonly searchEndIndex = computed(() => {
    const total = this.searchTotalCount();
    const end = this.searchCurrentPage() * this.searchPageSize();
    return Math.min(end, total);
  });

  constructor() {
    effect(() => {
      const types = this.capabilityService.resourceTypes();
      const current = this.selectedResourceType();
      if (types.length > 0 && (!current || !types.includes(current))) {
        const defaultType = types.includes('Patient') ? 'Patient' : types[0];
        this.selectedResourceType.set(defaultType);
      }
    });
  }

  ngOnInit(): void {
    this.capabilityService.loadMetadata();
  }

  setSearchParamValue(name: string, value: string): void {
    this.searchParamValues.update((prev) => ({ ...prev, [name]: value }));
  }

  getSearchParamValue(name: string): string {
    return this.searchParamValues()[name] ?? '';
  }

  getSearchParamInputType(param: CapabilitySearchParam): string {
    const t = (param.type ?? 'string').toLowerCase();
    if (t === 'number') return 'number';
    if (t === 'date' || t === 'datetime') return 'date';
    return 'text';
  }

  async runSearch(url?: string): Promise<void> {
    const baseUrl = this.settingsService.getEffectiveFhirBaseUrl()?.trim() ?? '';
    if (!baseUrl) {
      this.searchError.set('FHIR base URL is not configured.');
      return;
    }

    this.searchLoading.set(true);
    this.searchError.set(null);

    try {
      const resourceType = this.selectedResourceType();
      if (!resourceType) {
        this.searchError.set('Select a resource type.');
        this.searchLoading.set(false);
        return;
      }

      let bundle;
      if (url) {
        bundle = await firstValueFrom(this.searchService.fetchFromUrl(url));
      } else {
        this.searchCurrentPage.set(1);
        const params: Record<string, string> = {};
        for (const [key, value] of Object.entries(this.searchParamValues())) {
          if (value != null && String(value).trim() !== '') {
            params[key] = String(value).trim();
          }
        }
        const pageSize = this.searchPageSize();
        const offset = 0;
        bundle = await firstValueFrom(
          this.searchService.search(resourceType, params, { count: pageSize, offset })
        );
      }

      const entries = bundle?.entry?.map((e) => e.resource).filter((r): r is Resource => r != null) ?? [];
      this.searchResults.set(entries);

      const linksMap = new Map<string, string>();
      if (bundle?.link) {
        for (const link of bundle.link) {
          if (link.relation && link.url) {
            linksMap.set(link.relation, link.url);
          }
        }
      }
      this.searchBundleLinks.set(linksMap);

      if (bundle?.total !== undefined) {
        this.searchTotalCount.set(bundle.total);
      } else {
        const hasNext = linksMap.has('next');
        const currentResults = entries.length;
        const pageSize = this.searchPageSize();
        const currentPage = this.searchCurrentPage();
        if (hasNext) {
          this.searchTotalCount.set(currentPage * pageSize + 1);
        } else {
          this.searchTotalCount.set((currentPage - 1) * pageSize + currentResults);
        }
      }
    } catch (err) {
      this.searchError.set(this.getErrorMessage(err));
      this.searchResults.set([]);
      this.searchTotalCount.set(0);
      this.searchBundleLinks.set(new Map());
    } finally {
      this.searchLoading.set(false);
      this.searchHasRun.set(true);
    }
  }

  private getErrorMessage(err: unknown): string {
    if (err && typeof err === 'object' && 'error' in err) {
      const e = (err as { error?: unknown }).error;
      if (e && typeof e === 'object' && 'message' in e) {
        return String((e as { message: unknown }).message);
      }
    }
    if (err instanceof Error) return err.message;
    return 'Search failed';
  }

  searchFirstPage(): void {
    const firstUrl = this.searchBundleLinks().get('first');
    if (firstUrl) {
      this.searchCurrentPage.set(1);
      this.runSearch(firstUrl);
    } else {
      this.searchCurrentPage.set(1);
      this.runSearch();
    }
  }

  searchPreviousPage(): void {
    const prevUrl = this.searchBundleLinks().get('previous') ?? this.searchBundleLinks().get('prev');
    if (prevUrl) {
      this.searchCurrentPage.update((p) => Math.max(1, p - 1));
      this.runSearch(prevUrl);
    }
  }

  searchNextPage(): void {
    const nextUrl = this.searchBundleLinks().get('next');
    if (nextUrl) {
      this.searchCurrentPage.update((p) => p + 1);
      this.runSearch(nextUrl);
    }
  }

  searchLastPage(): void {
    const lastUrl = this.searchBundleLinks().get('last');
    if (lastUrl) {
      const total = this.searchTotalCount();
      const size = this.searchPageSize();
      if (total > 0) {
        this.searchCurrentPage.set(Math.ceil(total / size));
      }
      this.runSearch(lastUrl);
    }
  }

  setSearchPageSize(size: number): void {
    this.searchPageSize.set(size);
    this.searchCurrentPage.set(1);
    this.runSearch();
  }

  getResourceSummary(resource: Resource): string {
    const r = resource as unknown as Record<string, unknown>;
    const id = typeof r['id'] === 'string' ? r['id'] : '';
    const name = typeof r['name'] === 'string' ? r['name'] : Array.isArray(r['name']) && typeof (r['name'] as unknown[])[0] === 'string' ? (r['name'] as unknown[])[0] as string : undefined;
    const title = typeof r['title'] === 'string' ? r['title'] : undefined;
    const parts = [id].filter(Boolean);
    if (name) parts.push(name);
    else if (title) parts.push(title);
    return parts.length > 0 ? parts.join(' – ') : resource.resourceType + (id ? ' ' + id : '');
  }

  addToClipboard(resource: Resource): void {
    try {
      this.clipboardService.addResource(resource);
      this.toastService.showSuccess('Resource added to clipboard.', 'Clipboard');
    } catch {
      this.toastService.showError('Failed to add resource to clipboard.', 'Clipboard');
    }
  }

  toggleClipboardSortOrder(): void {
    this.clipboardSortOrder.set(this.clipboardSortOrder() === 'asc' ? 'desc' : 'asc');
  }

  isClipboardTypeFilterSelected(type: string): boolean {
    return this.clipboardTypeFilters().includes(type);
  }

  toggleClipboardTypeFilter(type: string): void {
    this.clipboardTypeFilters.update((prev) => {
      const set = new Set(prev);
      if (set.has(type)) {
        set.delete(type);
      } else {
        set.add(type);
      }
      return Array.from(set);
    });
  }

  clearClipboardTypeFilters(): void {
    this.clipboardTypeFilters.set([]);
  }

  onClearClipboard(): void {
    this.clipboardService.clear();
    this.expandedClipboardId.set(null);
  }

  onRemoveClipboardItem(item: ClipboardItem, event?: MouseEvent): void {
    event?.stopPropagation();
    event?.preventDefault();
    this.clipboardService.remove(item.id);
    if (this.expandedClipboardId() === item.id) {
      this.expandedClipboardId.set(null);
    }
  }

  toggleClipboardItemExpanded(item: ClipboardItem): void {
    const current = this.expandedClipboardId();
    this.expandedClipboardId.set(current === item.id ? null : item.id);
  }

  isClipboardItemExpanded(item: ClipboardItem): boolean {
    return this.expandedClipboardId() === item.id;
  }

  getClipboardItemJson(item: ClipboardItem): string {
    try {
      return JSON.stringify(item.payload, null, 2);
    } catch {
      return '{}';
    }
  }

  getIconForItem(item: ClipboardItem): string {
    const resource = item.payload as Record<string, unknown> | undefined;
    if (item.kind === 'coding') return '123';
    const rt = resource?.['resourceType'] as string | undefined;
    switch (rt) {
      case 'ValueSet': return 'collection';
      case 'CodeSystem': return 'database';
      case 'Library': return 'book';
      case 'Patient': return 'person';
      default: return 'file-earmark';
    }
  }

  getTypeLabel(item: ClipboardItem): string {
    const resource = item.payload as Record<string, unknown> | undefined;
    if (item.kind === 'coding') return 'Coding';
    return (resource?.['resourceType'] as string) || item.fhirType || 'Resource';
  }

  getAddedAtLabel(item: ClipboardItem): string {
    try {
      const dt = new Date(item.addedAt);
      return isNaN(dt.getTime()) ? '' : dt.toLocaleString();
    } catch {
      return '';
    }
  }
}
