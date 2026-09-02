// Author: Preston Lee

import { Component, ChangeDetectionStrategy, signal, computed, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { SettingsService } from '../../../services/settings.service';
import { TerminologyService } from '../../../services/terminology.service';
import { ToastService } from '../../../services/toast.service';
import { ValueSet, Bundle } from 'fhir/r4';
import { isResourceType } from '../../../services/fhir-resource-type.lib';
import { ValueSetDetailsPaneComponent } from '../valueset-details-pane/valueset-details-pane.component';
import { ClipboardService } from '../../../services/clipboard.service';
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
  selector: 'app-valuesets-tab',
  imports: [FormsModule, ValueSetDetailsPaneComponent, BootstrapPaginationComponent, TerminologyResourceListItemComponent],
  templateUrl: './valuesets-tab.component.html',

  styleUrl: './valuesets-tab.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
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

  // Expanded row state for Expanded Codes table
  protected readonly expandedRows = signal<Set<string>>(new Set());
  protected readonly expandedCodeDetails = signal<Map<string, any>>(new Map());
  protected readonly loadingDetails = signal<Set<string>>(new Set());
  protected readonly availablePageSizes = [10, 20, 50, 100];

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

  protected readonly hasValidConfiguration = computed(() =>
    hasTerminologyConfigured(this.settingsService.getEffectiveTerminologyEndpointAddress())
  );

  protected settingsService = inject(SettingsService);
  private terminologyService = inject(TerminologyService);
  private toastService = inject(ToastService);
  private clipboardService = inject(ClipboardService);
  private terminologyOpener = inject(TerminologyResourceOpenerService);
  private route = inject(ActivatedRoute);

  private handledOpenKey: string | null = null;

  constructor() {
    bindTerminologyTabDeepLinks('ValueSet', {
      opener: this.terminologyOpener,
      route: this.route,
      open: (id, url) => void this.openFromExternalRequest(id, url),
    });
  }

  ngOnInit(): void {
    // Auto-load ValueSets when component is initialized
    if (this.hasValidConfiguration() && !this.valuesetLoading()) {
      this.searchValueSets();
    }
  }

  private async openFromExternalRequest(id: string, url?: string): Promise<void> {
    await openTerminologyFromExternalRequest({
      resourceType: 'ValueSet',
      id,
      url,
      getHandledKey: () => this.handledOpenKey,
      setHandledKey: (key) => {
        this.handledOpenKey = key;
      },
      hasValidConfiguration: () => this.hasValidConfiguration(),
      opener: this.terminologyOpener,
      toast: this.toastService,
      onOpened: (resource) => this.selectValueSet(resource),
    });
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
      let result: Bundle;
      
      if (url) {
        // Use provided URL from Bundle link
        result = await firstValueFrom(this.terminologyService.fetchFromUrl<Bundle>(url));
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

      const page = parseBundlePage<ValueSet>(result, 'ValueSet', {
        pageSize: this.valuesetPageSize(),
        currentPage: this.valuesetCurrentPage(),
      });
      this.valuesetResults.set(page.items);
      this.valuesetBundleLinks.set(page.links);
      this.valuesetTotalCount.set(page.total);

      if (!url) {
        this.valuesetCurrentPage.set(1);
      }
    } catch (error) {
      const errorMessage = terminologyHttpErrorMessage(error);
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

    this.selectedValueSet.set(valueset);
    await this.expandValueSet();
  }

  async deleteSelectedValueSet(): Promise<void> {
    const selected = this.selectedValueSet();
    if (!selected) {
      return;
    }

    const selectedId = selected.id?.trim();
    if (!selectedId) {
      this.toastService.showWarning('This ValueSet cannot be deleted because it does not have a server resource id.', 'Delete Not Available');
      return;
    }

    this.valuesetError.set(null);

    try {
      await firstValueFrom(this.terminologyService.deleteValueSet(selectedId));

      this.selectedValueSet.set(null);
      this.expandedValueSet.set(null);
      this.expandedCodes.set([]);
      this.expandedRows.set(new Set());
      this.expandedCodeDetails.set(new Map());
      this.loadingDetails.set(new Set());

      await this.searchValueSets();
      this.toastService.showSuccess('ValueSet deleted successfully.', 'Delete Complete');
    } catch (error) {
      const errorMessage = terminologyHttpErrorMessage(error);
      this.valuesetError.set(errorMessage);
      this.toastService.showError(errorMessage, 'ValueSet Delete Failed');
      throw error;
    }
  }

  onAddValueSetToClipboard(valueset: ValueSet): void {
    try {
      this.clipboardService.addResource(valueset);
      this.toastService.showSuccess('ValueSet added to clipboard.', 'Clipboard Updated');
    } catch (error) {
      console.error('Failed to add ValueSet to clipboard:', error);
      this.toastService.showError('Failed to add ValueSet to clipboard.', 'Clipboard Error');
    }
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
      } else if (valueset.url) {
        // Fall back to URL, decode if encoded (uses POST /ValueSet/$expand)
        const url = decodeURIComponent(valueset.url);
        params.url = url;
      } else {
        throw new Error('No ID or URL available for ValueSet expansion');
      }

      const result = await firstValueFrom(this.terminologyService.expandValueSet(params));
      this.expandedValueSet.set(result || null);
      this.expandedCodes.set(result?.expansion?.contains || []);
    } catch (error) {
      console.error('ValueSet expansion error:', error);

      // If error mentions unknown ValueSet, try alternative approach
      if ((error as any)?.error?.issue?.[0]?.diagnostics?.includes('Unknown ValueSet')) {
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
          return;
        } catch (altError) {
          console.error('Alternative expansion also failed:', altError);
        }
      }

      const errorMessage = terminologyHttpErrorMessage(error) + ' The server might not support expansion of this specific value set.';
      this.valuesetError.set(errorMessage);
      this.toastService.showInfo('The server might not support expansion of this specific value set.', 'ValueSet Not Expanded');
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
      details.set(codeKey, { error: terminologyHttpErrorMessage(error) });
      this.expandedCodeDetails.set(details);
    } finally {
      // Remove from loading set
      const loading = new Set(this.loadingDetails());
      loading.delete(codeKey);
      this.loadingDetails.set(loading);
    }
  }

  getValueSetTrackId(valueset: ValueSet, index: number): string {
    return terminologyResourceTrackId('valueset', valueset, index);
  }
}
