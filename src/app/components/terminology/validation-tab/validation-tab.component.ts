// Author: Preston Lee

import { Component, signal, computed, inject, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom, Subject, debounceTime, distinctUntilChanged, switchMap, of } from 'rxjs';
import { takeUntil, catchError } from 'rxjs/operators';
import { SettingsService } from '../../../services/settings.service';
import { TerminologyService } from '../../../services/terminology.service';
import { ToastService } from '../../../services/toast.service';
import { ValueSet, CodeSystem, Parameters } from 'fhir/r4';

interface ValidationResult {
  valid: boolean;
  message?: string;
  display?: string;
  parameters?: Parameters;
}

@Component({
  selector: 'app-validation-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './validation-tab.component.html',
  styleUrl: './validation-tab.component.scss'
})
export class ValidationTabComponent implements OnDestroy {

  // Code validation
  protected readonly validationCode = signal<string>('');
  protected readonly validationSystem = signal<string>('');
  protected readonly validationValueSet = signal<string>('');
  protected readonly validationResult = signal<ValidationResult | null>(null);
  protected readonly validationLoading = signal<boolean>(false);
  protected readonly validationError = signal<string | null>(null);

  // ValueSet search
  protected readonly valuesetSearchTerm = signal<string>('');
  protected readonly valuesetSearchResults = signal<ValueSet[]>([]);
  protected readonly valuesetSearchLoading = signal<boolean>(false);
  protected readonly showValuesetDropdown = signal<boolean>(false);
  protected readonly selectedValueSetFromSearch = signal<ValueSet | null>(null);
  protected readonly valuesetHighlightedIndex = signal<number>(-1);

  // CodeSystem search
  protected readonly codesystemSearchTerm = signal<string>('');
  protected readonly codesystemSearchResults = signal<CodeSystem[]>([]);
  protected readonly codesystemSearchLoading = signal<boolean>(false);
  protected readonly showCodesystemDropdown = signal<boolean>(false);
  protected readonly selectedCodeSystemFromSearch = signal<CodeSystem | null>(null);
  protected readonly codesystemHighlightedIndex = signal<number>(-1);

  private readonly valuesetSearchSubject = new Subject<string>();
  private readonly codesystemSearchSubject = new Subject<string>();
  private readonly destroy$ = new Subject<void>();

  // Configuration status
  protected readonly hasValidConfiguration = computed(() => {
    const baseUrl = this.settingsService.getEffectiveTerminologyBaseUrl();
    return baseUrl.trim() !== '';
  });

  protected settingsService = inject(SettingsService);
  private terminologyService = inject(TerminologyService);
  private toastService = inject(ToastService);

  constructor() {
    // Set up debounced ValueSet search
    this.valuesetSearchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap(searchTerm => {
        if (!searchTerm || searchTerm.trim().length < 2) {
          this.valuesetSearchResults.set([]);
          this.showValuesetDropdown.set(false);
          return of([]);
        }
        return this.performValueSetSearch(searchTerm).then(results => {
          this.valuesetHighlightedIndex.set(-1);
          return results;
        }).catch(() => []);
      }),
      catchError(() => of([])),
      takeUntil(this.destroy$)
    ).subscribe();

    // Set up debounced CodeSystem search
    this.codesystemSearchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      switchMap(searchTerm => {
        if (!searchTerm || searchTerm.trim().length < 2) {
          this.codesystemSearchResults.set([]);
          this.showCodesystemDropdown.set(false);
          return of([]);
        }
        return this.performCodeSystemSearch(searchTerm).then(results => {
          this.codesystemHighlightedIndex.set(-1);
          return results;
        }).catch(() => []);
      }),
      catchError(() => of([])),
      takeUntil(this.destroy$)
    ).subscribe();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Code validation operations
  async validateCode(): Promise<void> {
    if (!this.hasValidConfiguration()) {
      const errorMessage = 'Please configure terminology service settings first.';
      this.validationError.set(errorMessage);
      this.toastService.showWarning(errorMessage, 'Configuration Required');
      return;
    }

    const code = this.validationCode().trim();
    const system = this.validationSystem().trim();
    const valueset = this.validationValueSet().trim();

    if (!code || !system) {
      const errorMessage = 'Please enter both code and system.';
      this.validationError.set(errorMessage);
      this.toastService.showWarning(errorMessage, 'Validation Input Required');
      return;
    }

    this.validationLoading.set(true);
    this.validationError.set(null);

    try {
      const params: any = {
        code: code,
        system: system
      };

      if (valueset) {
        params.url = valueset;
      }

      const result = await firstValueFrom(this.terminologyService.validateCode(params));

      // Parse validation result
      const validParam = result?.parameter?.find(p => p.name === 'result');
      const messageParam = result?.parameter?.find(p => p.name === 'message');
      const displayParam = result?.parameter?.find(p => p.name === 'display');

      this.validationResult.set({
        valid: validParam?.valueBoolean || false,
        message: messageParam?.valueString || (validParam?.valueBoolean ? 'Code is valid' : 'Code is not valid'),
        display: displayParam?.valueString,
        parameters: result
      });
    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
      this.validationError.set(errorMessage);
      this.toastService.showError(errorMessage, 'Code Validation Failed');
    } finally {
      this.validationLoading.set(false);
    }
  }

  // ValueSet search operations
  private performValueSetSearch(searchTerm: string): Promise<ValueSet[]> {
    if (!this.hasValidConfiguration() || !searchTerm || searchTerm.trim().length < 2) {
      this.valuesetSearchResults.set([]);
      this.showValuesetDropdown.set(false);
      return Promise.resolve([]);
    }

    this.valuesetSearchLoading.set(true);

    const params: any = {
      name: searchTerm.trim(),
      _count: 10
    };

    return firstValueFrom(this.terminologyService.searchValueSets(params))
      .then(result => {
        const valuesets = result?.entry?.map(e => e.resource!).filter(vs => vs !== null) || [];
        this.valuesetSearchResults.set(valuesets);
        this.showValuesetDropdown.set(valuesets.length > 0);
        return valuesets;
      })
      .catch(error => {
        // Silently fail for search - don't show errors for live search
        this.valuesetSearchResults.set([]);
        this.showValuesetDropdown.set(false);
        return [];
      })
      .finally(() => {
        this.valuesetSearchLoading.set(false);
      });
  }

  onValueSetInputChange(value: string): void {
    this.validationValueSet.set(value);
    const previousSelected = this.selectedValueSetFromSearch();
    
    // If the value matches the selected ValueSet URL, don't trigger search
    if (previousSelected && previousSelected.url === value) {
      this.valuesetSearchTerm.set(value);
      return;
    }
    
    // User is typing something new
    this.selectedValueSetFromSearch.set(null);
    this.valuesetSearchTerm.set(value);
    this.valuesetHighlightedIndex.set(-1);
    
    // Trigger search if user is typing (not selecting from dropdown)
    if (value && value.trim().length >= 2) {
      this.valuesetSearchSubject.next(value);
    } else {
      this.valuesetSearchResults.set([]);
      this.showValuesetDropdown.set(false);
    }
  }

  onValueSetInputFocus(): void {
    if (this.valuesetSearchResults().length > 0 && this.valuesetSearchTerm().trim().length >= 2) {
      this.showValuesetDropdown.set(true);
    }
  }

  onValueSetInputBlur(): void {
    // Delay hiding dropdown to allow click on results
    setTimeout(() => {
      this.showValuesetDropdown.set(false);
      this.valuesetHighlightedIndex.set(-1);
    }, 200);
  }

  onValueSetInputKeyDown(event: KeyboardEvent): void {
    const results = this.valuesetSearchResults();
    let currentIndex = this.valuesetHighlightedIndex();

    switch (event.key) {
      case 'ArrowDown':
        if (this.showValuesetDropdown() && results.length > 0) {
          event.preventDefault();
          currentIndex = currentIndex < results.length - 1 ? currentIndex + 1 : 0;
          this.valuesetHighlightedIndex.set(currentIndex);
          this.scrollValueSetIntoView(currentIndex);
        }
        break;
      case 'ArrowUp':
        if (this.showValuesetDropdown() && results.length > 0) {
          event.preventDefault();
          currentIndex = currentIndex > 0 ? currentIndex - 1 : results.length - 1;
          this.valuesetHighlightedIndex.set(currentIndex);
          this.scrollValueSetIntoView(currentIndex);
        }
        break;
      case 'Enter':
        event.preventDefault();
        if (this.showValuesetDropdown() && results.length > 0 && currentIndex >= 0 && currentIndex < results.length) {
          // Select from dropdown if highlighted
          this.selectValueSetFromSearch(results[currentIndex]);
        } else {
          // Otherwise, trigger validation
          this.validateCode();
        }
        break;
      case 'Escape':
        if (this.showValuesetDropdown()) {
          event.preventDefault();
          this.showValuesetDropdown.set(false);
          this.valuesetHighlightedIndex.set(-1);
        }
        break;
    }
  }

  private scrollValueSetIntoView(index: number): void {
    setTimeout(() => {
      const element = document.getElementById(`valueset-item-${index}`);
      if (element) {
        element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }, 0);
  }

  selectValueSetFromSearch(valueset: ValueSet): void {
    const url = valueset.url || '';
    this.validationValueSet.set(url);
    this.valuesetSearchTerm.set(url);
    this.selectedValueSetFromSearch.set(valueset);
    this.showValuesetDropdown.set(false);
    this.valuesetHighlightedIndex.set(-1);
  }

  getValueSetDisplayName(valueset: ValueSet): string {
    return valueset.name || valueset.title || valueset.url || 'Unnamed ValueSet';
  }

  getValueSetTrackKey(valueset: ValueSet, index: number): string {
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

  // CodeSystem search operations
  private performCodeSystemSearch(searchTerm: string): Promise<CodeSystem[]> {
    if (!this.hasValidConfiguration() || !searchTerm || searchTerm.trim().length < 2) {
      this.codesystemSearchResults.set([]);
      this.showCodesystemDropdown.set(false);
      return Promise.resolve([]);
    }

    this.codesystemSearchLoading.set(true);

    const params: any = {
      name: searchTerm.trim(),
      _count: 10
    };

    return firstValueFrom(this.terminologyService.searchCodeSystems(params))
      .then(result => {
        const codesystems = result?.entry?.map(e => e.resource!).filter(cs => cs !== null) || [];
        this.codesystemSearchResults.set(codesystems);
        this.showCodesystemDropdown.set(codesystems.length > 0);
        return codesystems;
      })
      .catch(error => {
        // Silently fail for search - don't show errors for live search
        this.codesystemSearchResults.set([]);
        this.showCodesystemDropdown.set(false);
        return [];
      })
      .finally(() => {
        this.codesystemSearchLoading.set(false);
      });
  }

  onCodeSystemInputChange(value: string): void {
    this.validationSystem.set(value);
    const previousSelected = this.selectedCodeSystemFromSearch();
    
    // If the value matches the selected CodeSystem URL, don't trigger search
    if (previousSelected && previousSelected.url === value) {
      this.codesystemSearchTerm.set(value);
      return;
    }
    
    // User is typing something new
    this.selectedCodeSystemFromSearch.set(null);
    this.codesystemSearchTerm.set(value);
    this.codesystemHighlightedIndex.set(-1);
    
    // Trigger search if user is typing (not selecting from dropdown)
    if (value && value.trim().length >= 2) {
      this.codesystemSearchSubject.next(value);
    } else {
      this.codesystemSearchResults.set([]);
      this.showCodesystemDropdown.set(false);
    }
  }

  onCodeSystemInputFocus(): void {
    if (this.codesystemSearchResults().length > 0 && this.codesystemSearchTerm().trim().length >= 2) {
      this.showCodesystemDropdown.set(true);
    }
  }

  onCodeSystemInputBlur(): void {
    // Delay hiding dropdown to allow click on results
    setTimeout(() => {
      this.showCodesystemDropdown.set(false);
      this.codesystemHighlightedIndex.set(-1);
    }, 200);
  }

  onCodeSystemInputKeyDown(event: KeyboardEvent): void {
    const results = this.codesystemSearchResults();
    let currentIndex = this.codesystemHighlightedIndex();

    switch (event.key) {
      case 'ArrowDown':
        if (this.showCodesystemDropdown() && results.length > 0) {
          event.preventDefault();
          currentIndex = currentIndex < results.length - 1 ? currentIndex + 1 : 0;
          this.codesystemHighlightedIndex.set(currentIndex);
          this.scrollCodeSystemIntoView(currentIndex);
        }
        break;
      case 'ArrowUp':
        if (this.showCodesystemDropdown() && results.length > 0) {
          event.preventDefault();
          currentIndex = currentIndex > 0 ? currentIndex - 1 : results.length - 1;
          this.codesystemHighlightedIndex.set(currentIndex);
          this.scrollCodeSystemIntoView(currentIndex);
        }
        break;
      case 'Enter':
        event.preventDefault();
        if (this.showCodesystemDropdown() && results.length > 0 && currentIndex >= 0 && currentIndex < results.length) {
          // Select from dropdown if highlighted
          this.selectCodeSystemFromSearch(results[currentIndex]);
        } else {
          // Otherwise, trigger validation
          this.validateCode();
        }
        break;
      case 'Escape':
        if (this.showCodesystemDropdown()) {
          event.preventDefault();
          this.showCodesystemDropdown.set(false);
          this.codesystemHighlightedIndex.set(-1);
        }
        break;
    }
  }

  onCodeInputEnter(event: Event): void {
    event.preventDefault();
    this.validateCode();
  }

  private scrollCodeSystemIntoView(index: number): void {
    setTimeout(() => {
      const element = document.getElementById(`codesystem-item-${index}`);
      if (element) {
        element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }, 0);
  }

  selectCodeSystemFromSearch(codesystem: CodeSystem): void {
    const url = codesystem.url || '';
    this.validationSystem.set(url);
    this.codesystemSearchTerm.set(url);
    this.selectedCodeSystemFromSearch.set(codesystem);
    this.showCodesystemDropdown.set(false);
    this.codesystemHighlightedIndex.set(-1);
  }

  getCodeSystemDisplayName(codesystem: CodeSystem): string {
    return codesystem.name || codesystem.title || codesystem.url || 'Unnamed CodeSystem';
  }

  getCodeSystemTrackKey(codesystem: CodeSystem, index: number): string {
    const id = codesystem.id?.trim();
    const url = codesystem.url?.trim();
    if (id) {
      return `codesystem-id-${id}-${index}`;
    } else if (url) {
      return `codesystem-url-${url}-${index}`;
    } else {
      return `codesystem-${index}`;
    }
  }

  // Validation result formatting
  getValidationParameters(): Array<{ name: string; value: string; type: string }> {
    const params = this.validationResult()?.parameters?.parameter || [];
    const formatted: Array<{ name: string; value: string; type: string }> = [];

    for (const param of params) {
      if (!param.name) continue;

      let value = '';
      let type = '';

      if (param.valueBoolean !== undefined) {
        value = String(param.valueBoolean);
        type = 'Boolean';
      } else if (param.valueString) {
        value = param.valueString;
        type = 'String';
      } else if (param.valueCode) {
        value = param.valueCode;
        type = 'Code';
      } else if (param.valueUri) {
        value = param.valueUri;
        type = 'URI';
      } else if (param.valueInteger !== undefined) {
        value = String(param.valueInteger);
        type = 'Integer';
      } else if (param.valueDecimal !== undefined) {
        value = String(param.valueDecimal);
        type = 'Decimal';
      } else if (param.valueDateTime) {
        value = param.valueDateTime;
        type = 'DateTime';
      } else if (param.valueDate) {
        value = param.valueDate;
        type = 'Date';
      } else if (param.valueCoding) {
        value = `${param.valueCoding.system || ''}${param.valueCoding.code ? '|' + param.valueCoding.code : ''}${param.valueCoding.display ? ' "' + param.valueCoding.display + '"' : ''}`.trim();
        type = 'Coding';
      } else if (param.valueCodeableConcept) {
        const codings = param.valueCodeableConcept.coding?.map(c => 
          `${c.system || ''}${c.code ? '|' + c.code : ''}${c.display ? ' "' + c.display + '"' : ''}`.trim()
        ).filter(c => c) || [];
        value = codings.length > 0 ? codings.join(', ') : 'N/A';
        type = 'CodeableConcept';
      } else {
        continue;
      }

      formatted.push({ name: param.name, value, type });
    }

    return formatted;
  }

  getParameterDisplayName(name: string): string {
    const displayNames: Record<string, string> = {
      'result': 'Result',
      'message': 'Message',
      'display': 'Display',
      'code': 'Code',
      'system': 'System',
      'version': 'Version',
      'abstract': 'Abstract',
      'inactive': 'Inactive',
      'codeableConcept': 'Codeable Concept',
      'coding': 'Coding'
    };
    return displayNames[name] || name.charAt(0).toUpperCase() + name.slice(1);
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
