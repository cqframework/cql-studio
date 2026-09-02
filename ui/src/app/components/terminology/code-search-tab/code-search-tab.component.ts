// Author: Preston Lee

import { Component, signal, computed, inject, afterNextRender, Injector, ChangeDetectionStrategy } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { firstValueFrom, Subject, debounceTime, distinctUntilChanged, switchMap, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { SettingsService } from '../../../services/settings.service';
import { TerminologyService } from '../../../services/terminology.service';
import { ToastService } from '../../../services/toast.service';
import { ValueSet } from 'fhir/r4';
import { isResourceType } from '../../../services/fhir-resource-type.lib';
import {
  hasTerminologyConfigured,
  terminologyHttpErrorMessage,
} from '../../../services/terminology-ui.lib';
import { CodeSearchDetailsPaneComponent } from '../code-search-details-pane/code-search-details-pane.component';

@Component({
  selector: 'app-code-search-tab',
  imports: [FormsModule, CodeSearchDetailsPaneComponent],
  templateUrl: './code-search-tab.component.html',

  styleUrl: './code-search-tab.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeSearchTabComponent {

  protected readonly valueSetInput = signal<string>('');
  protected readonly valueSetSearchResults = signal<ValueSet[]>([]);
  protected readonly valueSetSearchLoading = signal<boolean>(false);
  protected readonly showValueSetDropdown = signal<boolean>(false);
  protected readonly selectedValueSet = signal<ValueSet | null>(null);
  protected readonly valueSetHighlightedIndex = signal<number>(-1);

  protected readonly filterInput = signal<string>('');
  protected readonly countInput = signal<number>(100);
  protected readonly offsetInput = signal<number>(0);
  protected readonly includeDesignations = signal<boolean>(true);
  protected readonly includeDefinition = signal<boolean>(true);
  protected readonly activeOnly = signal<boolean>(true);

  protected readonly expandedCodes = signal<any[]>([]);
  protected readonly expandLoading = signal<boolean>(false);
  protected readonly expandedRows = signal<Set<string>>(new Set());
  protected readonly expandedCodeDetails = signal<Map<string, any>>(new Map());
  protected readonly loadingDetails = signal<Set<string>>(new Set());

  protected readonly availablePageSizes = [10, 20, 50, 100];

  private readonly valueSetSearchSubject = new Subject<string>();

  protected readonly hasValidConfiguration = computed(() =>
    hasTerminologyConfigured(this.settingsService.getEffectiveTerminologyEndpointAddress())
  );

  protected readonly searchFilterUsed = signal<string>('');

  private settingsService = inject(SettingsService);
  private terminologyService = inject(TerminologyService);
  private toastService = inject(ToastService);
  private injector = inject(Injector);

  constructor() {
    this.valueSetSearchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap(searchTerm => {
        if (!searchTerm || searchTerm.trim().length < 2) {
          this.valueSetSearchResults.set([]);
          this.showValueSetDropdown.set(false);
          return of([]);
        }
        return this.performValueSetSearch(searchTerm).then(results => {
          this.valueSetHighlightedIndex.set(-1);
          return results;
        }).catch(() => []);
      }),
      catchError(() => of([])),
      takeUntilDestroyed()
    ).subscribe();
  }

  private performValueSetSearch(searchTerm: string): Promise<ValueSet[]> {
    if (!this.hasValidConfiguration() || !searchTerm || searchTerm.trim().length < 2) {
      this.valueSetSearchResults.set([]);
      this.showValueSetDropdown.set(false);
      return Promise.resolve([]);
    }
    this.valueSetSearchLoading.set(true);
    const params: any = { name: searchTerm.trim(), _count: 10 };
    return firstValueFrom(this.terminologyService.searchValueSets(params))
      .then(result => {
        const valuesets = result?.entry
          ?.map(e => e.resource)
          .filter((resource): resource is ValueSet => isResourceType(resource, 'ValueSet')) || [];
        this.valueSetSearchResults.set(valuesets);
        this.showValueSetDropdown.set(valuesets.length > 0);
        return valuesets;
      })
      .catch(() => {
        this.valueSetSearchResults.set([]);
        this.showValueSetDropdown.set(false);
        return [];
      })
      .finally(() => this.valueSetSearchLoading.set(false));
  }

  onValueSetInputChange(value: string): void {
    this.valueSetInput.set(value);
    const prev = this.selectedValueSet();
    if (prev && prev.url === value) {
      return;
    }
    this.selectedValueSet.set(null);
    this.valueSetHighlightedIndex.set(-1);
    if (value && value.trim().length >= 2) {
      this.valueSetSearchSubject.next(value);
    } else {
      this.valueSetSearchResults.set([]);
      this.showValueSetDropdown.set(false);
    }
  }

  onValueSetInputFocus(): void {
    if (this.valueSetSearchResults().length > 0 && this.valueSetInput().trim().length >= 2) {
      this.showValueSetDropdown.set(true);
    }
  }

  onValueSetInputBlur(): void {
    this.showValueSetDropdown.set(false);
    this.valueSetHighlightedIndex.set(-1);
  }

  onValueSetInputKeyDown(event: KeyboardEvent): void {
    const results = this.valueSetSearchResults();
    let idx = this.valueSetHighlightedIndex();
    switch (event.key) {
      case 'ArrowDown':
        if (this.showValueSetDropdown() && results.length > 0) {
          event.preventDefault();
          idx = idx < results.length - 1 ? idx + 1 : 0;
          this.valueSetHighlightedIndex.set(idx);
          this.scrollValueSetIntoView(idx);
        }
        break;
      case 'ArrowUp':
        if (this.showValueSetDropdown() && results.length > 0) {
          event.preventDefault();
          idx = idx > 0 ? idx - 1 : results.length - 1;
          this.valueSetHighlightedIndex.set(idx);
          this.scrollValueSetIntoView(idx);
        }
        break;
      case 'Enter':
        event.preventDefault();
        if (this.showValueSetDropdown() && results.length > 0 && idx >= 0 && idx < results.length) {
          this.selectValueSetFromSearch(results[idx]);
        } else {
          this.runSearch();
        }
        break;
      case 'Escape':
        if (this.showValueSetDropdown()) {
          event.preventDefault();
          this.showValueSetDropdown.set(false);
          this.valueSetHighlightedIndex.set(-1);
        }
        break;
    }
  }

  private scrollValueSetIntoView(index: number): void {
    afterNextRender(() => {
      document.getElementById(`code-search-valueset-item-${index}`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, { injector: this.injector });
  }

  selectValueSetFromSearch(valueset: ValueSet): void {
    const url = valueset.url || '';
    this.valueSetInput.set(url);
    this.selectedValueSet.set(valueset);
    this.showValueSetDropdown.set(false);
    this.valueSetHighlightedIndex.set(-1);
  }

  getValueSetDisplayName(vs: ValueSet): string {
    return vs.name || vs.title || vs.url || 'Unnamed ValueSet';
  }

  getValueSetTrackKey(vs: ValueSet, index: number): string {
    const id = vs.id?.trim();
    const url = vs.url?.trim();
    if (id) return `code-search-vs-id-${id}-${index}`;
    if (url) return `code-search-vs-url-${url}-${index}`;
    return `code-search-vs-${index}`;
  }

  async runSearch(): Promise<void> {
    if (!this.hasValidConfiguration()) {
      this.toastService.showWarning('Please configure terminology service settings first.', 'Configuration Required');
      return;
    }
    const vs = this.selectedValueSet();
    const url = this.valueSetInput().trim();
    if (!url) {
      this.toastService.showWarning('Select or enter a ValueSet URL.', 'ValueSet Required');
      return;
    }
    this.expandLoading.set(true);
    this.expandedCodes.set([]);
    this.expandedRows.set(new Set());
    this.expandedCodeDetails.set(new Map());
    this.loadingDetails.set(new Set());
    this.searchFilterUsed.set(this.filterInput().trim());

    try {
      const count = Math.max(1, this.countInput() || 100);
      const offset = Math.max(0, this.offsetInput() ?? 0);
      const params: any = {
        url: vs?.url || url,
        filter: this.filterInput().trim() || undefined,
        count,
        offset,
        includeDesignations: this.includeDesignations(),
        includeDefinition: this.includeDefinition(),
        activeOnly: this.activeOnly()
      };
      if (vs?.id) params.id = vs.id;

      const result = await firstValueFrom(this.terminologyService.expandValueSet(params));
      this.expandedCodes.set(result?.expansion?.contains || []);
      if (!vs && url && result) {
        this.selectedValueSet.set({
          resourceType: 'ValueSet',
          status: result.status ?? 'active',
          url,
          name: result.name,
          title: result.title
        });
      }
    } catch (error) {
      const msg = terminologyHttpErrorMessage(error);
      this.toastService.showError(msg, 'Code Search Failed');
    } finally {
      this.expandLoading.set(false);
    }
  }

  toggleRowExpansion(code: any): void {
    const codeKey = `${code.code}-${code.system}`;
    const expanded = new Set(this.expandedRows());
    if (expanded.has(codeKey)) {
      expanded.delete(codeKey);
    } else {
      expanded.add(codeKey);
      if (!this.expandedCodeDetails().has(codeKey)) {
        this.loadCodeDetails(code, codeKey);
      }
    }
    this.expandedRows.set(expanded);
  }

  private async loadCodeDetails(code: any, codeKey: string): Promise<void> {
    if (!this.hasValidConfiguration()) return;
    const loading = new Set(this.loadingDetails());
    loading.add(codeKey);
    this.loadingDetails.set(loading);
    try {
      const result = await firstValueFrom(this.terminologyService.lookupCode({
        code: code.code,
        system: code.system
      }));
      const details = new Map(this.expandedCodeDetails());
      details.set(codeKey, result);
      this.expandedCodeDetails.set(details);
    } catch (error) {
      const details = new Map(this.expandedCodeDetails());
      details.set(codeKey, { error: terminologyHttpErrorMessage(error) });
      this.expandedCodeDetails.set(details);
    } finally {
      const loading = new Set(this.loadingDetails());
      loading.delete(codeKey);
      this.loadingDetails.set(loading);
    }
  }

}
