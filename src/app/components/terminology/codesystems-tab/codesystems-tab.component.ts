// Author: Preston Lee

import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { SettingsService } from '../../../services/settings.service';
import { TerminologyService } from '../../../services/terminology.service';
import { ToastService } from '../../../services/toast.service';
import { CodeSystem } from 'fhir/r4';
import { ClipboardService } from '../../../services/clipboard.service';

@Component({
  selector: 'app-codesystems-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './codesystems-tab.component.html',
  styleUrl: './codesystems-tab.component.scss'
})
export class CodeSystemsTabComponent implements OnInit {

  // Code Systems tab
  protected readonly codeSystemsResults = signal<CodeSystem[]>([]);
  protected readonly codeSystemsLoading = signal<boolean>(false);
  protected readonly codeSystemsError = signal<string | null>(null);
  protected readonly codeSystemsFilter = signal<string>('');
  protected readonly codeSystemsSortBy = signal<'name' | 'url' | 'title' | 'version' | 'status'>('name');
  protected readonly codeSystemsSortOrder = signal<'asc' | 'desc'>('asc');
  protected readonly codeSystemsDeleting = signal<Set<string>>(new Set());

  // Pagination for Code Systems
  protected readonly codeSystemsCurrentPage = signal<number>(1);
  protected readonly codeSystemsPageSize = signal<number>(5);
  protected readonly codeSystemsAvailablePageSizes = [5, 10, 20, 50];

  // CodeSystem selection state
  protected readonly selectedCodeSystem = signal<CodeSystem | null>(null);

  // Configuration status
  protected readonly hasValidConfiguration = computed(() => {
    const baseUrl = this.settingsService.getEffectiveTerminologyBaseUrl();
    return baseUrl.trim() !== '';
  });

  protected settingsService = inject(SettingsService);
  private terminologyService = inject(TerminologyService);
  private toastService = inject(ToastService);
  private clipboardService = inject(ClipboardService);

  ngOnInit(): void {
    // Auto-load Code Systems when component is initialized
    if (this.hasValidConfiguration() && !this.codeSystemsLoading()) {
      this.loadCodeSystems();
    }
  }

  // Code Systems operations
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
      // Request a large count to get all code systems for client-side pagination
      const result = await firstValueFrom(this.terminologyService.searchCodeSystems({ _count: 1000 }));
      const codeSystems = result?.entry?.map(e => e.resource).filter(r => r !== undefined) || [];
      this.codeSystemsResults.set(codeSystems);
      
      // Reset to first page when loading new data
      this.codeSystemsCurrentPage.set(1);
    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
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

  // Handle column header clicks for sorting
  onCodeSystemColumnClick(column: 'name' | 'url' | 'title' | 'version' | 'status'): void {
    const currentSortBy = this.codeSystemsSortBy();

    if (currentSortBy === column) {
      // Same column clicked - toggle sort order
      this.toggleCodeSystemsSortOrder();
    } else {
      // Different column clicked - set new column and default to ascending
      this.codeSystemsSortBy.set(column);
      this.codeSystemsSortOrder.set('asc');
    }
  }

  getFilteredAndSortedCodeSystems(): CodeSystem[] {
    let results = this.codeSystemsResults();

    // Apply filter
    const filter = this.codeSystemsFilter().toLowerCase();
    if (filter) {
      results = results.filter(cs =>
        cs.name?.toLowerCase().includes(filter) ||
        cs.title?.toLowerCase().includes(filter) ||
        cs.url?.toLowerCase().includes(filter)
      );
    }

    // Apply sorting
    const sortBy = this.codeSystemsSortBy();
    const sortOrder = this.codeSystemsSortOrder();

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
        case 'version':
          aValue = a.version || '';
          bValue = b.version || '';
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

  // Pagination computed properties for Code Systems
  protected readonly codeSystemsTotalCount = computed(() => {
    return this.getFilteredAndSortedCodeSystems().length;
  });

  protected readonly codeSystemsTotalPages = computed(() => {
    const total = this.codeSystemsTotalCount();
    const size = this.codeSystemsPageSize();
    return Math.max(1, Math.ceil(total / size));
  });

  protected readonly codeSystemsHasPreviousPage = computed(() => {
    return this.codeSystemsCurrentPage() > 1;
  });

  protected readonly codeSystemsHasNextPage = computed(() => {
    return this.codeSystemsCurrentPage() < this.codeSystemsTotalPages();
  });

  protected readonly codeSystemsStartIndex = computed(() => {
    return (this.codeSystemsCurrentPage() - 1) * this.codeSystemsPageSize() + 1;
  });

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
    const endIndex = startIndex + size;
    return allResults.slice(startIndex, endIndex);
  });

  // Pagination methods for Code Systems
  codeSystemsPreviousPage(): void {
    const currentPage = this.codeSystemsCurrentPage();
    if (currentPage > 1) {
      this.codeSystemsCurrentPage.set(currentPage - 1);
    }
  }

  codeSystemsNextPage(): void {
    const currentPage = this.codeSystemsCurrentPage();
    const totalPages = this.codeSystemsTotalPages();
    if (currentPage < totalPages) {
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

  // CodeSystem selection method
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

  // CodeSystem Download Method
  downloadCodeSystem(codeSystem: CodeSystem): void {
    try {
      const jsonString = JSON.stringify(codeSystem, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const filename = codeSystem.id 
        ? `CodeSystem-${codeSystem.id}.json`
        : codeSystem.url 
          ? `CodeSystem-${codeSystem.url.replace(/[^a-zA-Z0-9]/g, '_')}.json`
          : 'CodeSystem.json';
      
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download CodeSystem:', error);
      this.toastService.showError('Failed to download CodeSystem', 'Download Error');
    }
  }

  // Helper methods
  formatDate(dateString?: string): string {
    if (!dateString) return '';
    return new Date(dateString).toLocaleDateString();
  }

  getCodeSystemTrackId(codeSystem: CodeSystem, index: number): string {
    // Prioritize id (should be unique in FHIR), then url, then index with prefix
    // Use nullish coalescing to handle empty strings properly
    // Always include index to ensure uniqueness even if id/url are duplicated or empty
    const id = codeSystem.id?.trim();
    const url = codeSystem.url?.trim();
    if (id) {
      return `codesystem-id-${id}-${index}`;
    } else if (url) {
      return `codesystem-url-${url}-${index}`;
    } else {
      return `codesystem-${index}`;
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
