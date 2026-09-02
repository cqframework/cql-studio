// Author: Preston Lee

import { Component, ChangeDetectionStrategy, signal, computed, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { SettingsService } from '../../../services/settings.service';
import { TerminologyService } from '../../../services/terminology.service';
import { ToastService } from '../../../services/toast.service';
import { CodeSystem } from 'fhir/r4';
import { ClipboardService } from '../../../services/clipboard.service';
import { isResourceType } from '../../../services/fhir-resource-type.lib';
import { TerminologyResourceOpenerService } from '../../../services/terminology-resource-opener.service';
import {
  bindTerminologyTabDeepLinks,
  openTerminologyFromExternalRequest,
} from '../../../services/terminology-external-open.lib';
import {
  hasTerminologyConfigured,
  terminologyHttpErrorMessage,
  terminologyResourceTrackId,
} from '../../../services/terminology-ui.lib';
import { BootstrapPaginationComponent } from '../../shared/bootstrap-pagination/bootstrap-pagination.component';
import { CodeSystemDetailsPaneComponent } from '../codesystem-details-pane/codesystem-details-pane.component';
import { TerminologyResourceListItemComponent } from '../terminology-resource-list-item/terminology-resource-list-item.component';

@Component({
  selector: 'app-codesystems-tab',
  imports: [FormsModule, BootstrapPaginationComponent, CodeSystemDetailsPaneComponent, TerminologyResourceListItemComponent],
  templateUrl: './codesystems-tab.component.html',
  styleUrl: './codesystems-tab.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeSystemsTabComponent implements OnInit {
  protected readonly codeSystemsResults = signal<CodeSystem[]>([]);
  protected readonly codeSystemsLoading = signal<boolean>(false);
  protected readonly codeSystemsError = signal<string | null>(null);
  protected readonly codeSystemsFilter = signal<string>('');
  protected readonly codeSystemsSortBy = signal<'name' | 'url' | 'title' | 'version' | 'status'>('name');
  protected readonly codeSystemsSortOrder = signal<'asc' | 'desc'>('asc');

  protected readonly codeSystemsCurrentPage = signal<number>(1);
  protected readonly codeSystemsPageSize = signal<number>(5);
  protected readonly codeSystemsAvailablePageSizes = [5, 10, 20, 50];

  protected readonly selectedCodeSystem = signal<CodeSystem | null>(null);

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
    bindTerminologyTabDeepLinks('CodeSystem', {
      opener: this.terminologyOpener,
      route: this.route,
      open: (id, url) => void this.openFromExternalRequest(id, url),
    });
  }

  ngOnInit(): void {
    if (this.hasValidConfiguration() && !this.codeSystemsLoading()) {
      this.loadCodeSystems();
    }
  }

  private async openFromExternalRequest(id: string, url?: string): Promise<void> {
    await openTerminologyFromExternalRequest({
      resourceType: 'CodeSystem',
      id,
      url,
      getHandledKey: () => this.handledOpenKey,
      setHandledKey: (key) => {
        this.handledOpenKey = key;
      },
      hasValidConfiguration: () => this.hasValidConfiguration(),
      opener: this.terminologyOpener,
      toast: this.toastService,
      onOpened: (resource) => this.selectCodeSystem(resource),
    });
  }

  async loadCodeSystems(): Promise<void> {
    if (!this.hasValidConfiguration()) {
      const errorMessage = 'Please configure terminology service settings first.';
      this.codeSystemsError.set(errorMessage);
      this.toastService.showWarning(errorMessage, 'Configuration Required');
      return;
    }

    this.codeSystemsLoading.set(true);
    this.codeSystemsError.set(null);

    try {
      const result = await firstValueFrom(this.terminologyService.searchCodeSystems({ _count: 1000 }));
      const codeSystems =
        result?.entry
          ?.map((e) => e.resource)
          .filter((resource): resource is CodeSystem => isResourceType(resource, 'CodeSystem')) || [];
      this.codeSystemsResults.set(codeSystems);
      this.codeSystemsCurrentPage.set(1);
    } catch (error) {
      const errorMessage = terminologyHttpErrorMessage(error);
      this.codeSystemsError.set(errorMessage);
      this.toastService.showError(errorMessage, 'Code Systems Load Failed');
    } finally {
      this.codeSystemsLoading.set(false);
    }
  }

  setCodeSystemsSortBy(sortBy: 'name' | 'url' | 'title' | 'version' | 'status'): void {
    this.codeSystemsSortBy.set(sortBy);
  }

  toggleCodeSystemsSortOrder(): void {
    this.codeSystemsSortOrder.set(this.codeSystemsSortOrder() === 'asc' ? 'desc' : 'asc');
  }

  onCodeSystemColumnClick(column: 'name' | 'url' | 'title' | 'version' | 'status'): void {
    if (this.codeSystemsSortBy() === column) {
      this.toggleCodeSystemsSortOrder();
    } else {
      this.codeSystemsSortBy.set(column);
      this.codeSystemsSortOrder.set('asc');
    }
  }

  getFilteredAndSortedCodeSystems(): CodeSystem[] {
    let results = this.codeSystemsResults();
    const filter = this.codeSystemsFilter().toLowerCase();
    if (filter) {
      results = results.filter(
        (cs) =>
          cs.name?.toLowerCase().includes(filter) ||
          cs.title?.toLowerCase().includes(filter) ||
          cs.url?.toLowerCase().includes(filter)
      );
    }

    const sortBy = this.codeSystemsSortBy();
    const sortOrder = this.codeSystemsSortOrder();
    results.sort((a, b) => {
      const aValue = (a[sortBy] as string | undefined) || '';
      const bValue = (b[sortBy] as string | undefined) || '';
      const comparison = aValue.localeCompare(bValue);
      return sortOrder === 'asc' ? comparison : -comparison;
    });
    return results;
  }

  protected readonly codeSystemsTotalCount = computed(() => this.getFilteredAndSortedCodeSystems().length);

  protected readonly codeSystemsTotalPages = computed(() => {
    const total = this.codeSystemsTotalCount();
    const size = this.codeSystemsPageSize();
    return Math.max(1, Math.ceil(total / size));
  });

  protected readonly codeSystemsHasPreviousPage = computed(() => this.codeSystemsCurrentPage() > 1);

  protected readonly codeSystemsHasNextPage = computed(
    () => this.codeSystemsCurrentPage() < this.codeSystemsTotalPages()
  );

  protected readonly codeSystemsStartIndex = computed(
    () => (this.codeSystemsCurrentPage() - 1) * this.codeSystemsPageSize() + 1
  );

  protected readonly codeSystemsEndIndex = computed(() => {
    const total = this.codeSystemsTotalCount();
    const end = this.codeSystemsCurrentPage() * this.codeSystemsPageSize();
    return Math.min(end, total);
  });

  protected readonly paginatedCodeSystems = computed(() => {
    const allResults = this.getFilteredAndSortedCodeSystems();
    const page = this.codeSystemsCurrentPage();
    const size = this.codeSystemsPageSize();
    const startIndex = (page - 1) * size;
    return allResults.slice(startIndex, startIndex + size);
  });

  codeSystemsPreviousPage(): void {
    const currentPage = this.codeSystemsCurrentPage();
    if (currentPage > 1) {
      this.codeSystemsCurrentPage.set(currentPage - 1);
    }
  }

  codeSystemsNextPage(): void {
    const currentPage = this.codeSystemsCurrentPage();
    if (currentPage < this.codeSystemsTotalPages()) {
      this.codeSystemsCurrentPage.set(currentPage + 1);
    }
  }

  codeSystemsGoToFirstPage(): void {
    this.codeSystemsCurrentPage.set(1);
  }

  codeSystemsGoToLastPage(): void {
    this.codeSystemsCurrentPage.set(this.codeSystemsTotalPages());
  }

  setCodeSystemsPageSize(size: number): void {
    this.codeSystemsPageSize.set(size);
    this.codeSystemsCurrentPage.set(1);
  }

  onCodeSystemsFilterChange(value: string): void {
    this.codeSystemsFilter.set(value);
    this.codeSystemsCurrentPage.set(1);
  }

  selectCodeSystem(codeSystem: CodeSystem): void {
    this.selectedCodeSystem.set(codeSystem);
  }

  onAddCodeSystemToClipboard(codeSystem: CodeSystem): void {
    try {
      this.clipboardService.addResource(codeSystem);
      this.toastService.showSuccess('CodeSystem added to clipboard.', 'Clipboard Updated');
    } catch (error) {
      console.error('Failed to add CodeSystem to clipboard:', error);
      this.toastService.showError('Failed to add CodeSystem to clipboard.', 'Clipboard Error');
    }
  }

  getCodeSystemTrackId(codeSystem: CodeSystem, index: number): string {
    return terminologyResourceTrackId('codesystem', codeSystem, index);
  }
}
