// Author: Preston Lee

import { Component, input, computed, signal, effect, inject, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ValueSet, Coding } from 'fhir/r4';
import { ToastService } from '../../../services/toast.service';
import { ClipboardService } from '../../../services/clipboard.service';
import { downloadJson } from '../../../services/download-blob.lib';
import { formatFhirDate, terminologyDownloadFilename } from '../../../services/terminology-ui.lib';

@Component({
  selector: 'app-valueset-details-pane',
  imports: [FormsModule],
  templateUrl: './valueset-details-pane.component.html',

  styleUrl: './valueset-details-pane.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ValueSetDetailsPaneComponent {
  // Inputs
  selectedValueSet = input<ValueSet | null>(null);
  expandLoading = input<boolean>(false);
  expandedCodes = input<any[]>([]);
  expandedRows = input<Set<string>>(new Set());
  expandedCodeDetails = input<Map<string, any>>(new Map());
  loadingDetails = input<Set<string>>(new Set());
  availablePageSizes = input<number[]>([25, 50, 100, 200]);
  onRowToggle = input<(code: any) => void>();
  onDeleteValueSet = input<() => Promise<void> | void>();
  
  // Services
  private toastService = inject(ToastService);
  private clipboardService = inject(ClipboardService);
  
  // Internal pagination state
  protected readonly currentPage = signal<number>(1);
  protected readonly pageSize = signal<number>(50);
  protected readonly showDeleteConfirmationModal = signal<boolean>(false);
  protected readonly deleteInProgress = signal<boolean>(false);

  constructor() {
    // Reset to first page when expanded codes change
    effect(() => {
      this.expandedCodes();
      this.currentPage.set(1);
    });
  }
  
  // Computed properties
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

  // Methods
  setPageSize(size: number): void {
    const currentPage = this.currentPage();
    const totalCodes = this.expandedCodes().length;
    
    this.pageSize.set(size);
    
    // Adjust current page if necessary
    const maxPage = Math.max(1, Math.ceil(totalCodes / size));
    if (currentPage > maxPage) {
      this.currentPage.set(maxPage);
    }
  }

  previousPage(): void {
    if (this.hasPreviousPage()) {
      this.currentPage.set(this.currentPage() - 1);
    }
  }

  nextPage(): void {
    if (this.hasNextPage()) {
      this.currentPage.set(this.currentPage() + 1);
    }
  }

  goToFirstPage(): void {
    this.currentPage.set(1);
  }

  goToLastPage(): void {
    this.currentPage.set(this.totalPages());
  }

  isRowExpanded(code: any): boolean {
    const codeKey = `${code.code}-${code.system}`;
    return this.expandedRows().has(codeKey);
  }

  isLoadingCodeDetails(code: any): boolean {
    const codeKey = `${code.code}-${code.system}`;
    return this.loadingDetails().has(codeKey);
  }

  getCodeDetails(code: any): any {
    const codeKey = `${code.code}-${code.system}`;
    return this.expandedCodeDetails().get(codeKey);
  }

  protected readonly formatFhirDate = formatFhirDate;

  handleRowClick(code: any): void {
    const handler = this.onRowToggle();
    if (handler) {
      handler(code);
    }
  }

  downloadValueSet(): void {
    const valueSet = this.selectedValueSet();
    if (!valueSet) {
      return;
    }

    try {
      downloadJson(valueSet, terminologyDownloadFilename('ValueSet', valueSet));
    } catch (error) {
      console.error('Failed to download ValueSet:', error);
      this.toastService.showError('Failed to download ValueSet', 'Download Error');
    }
  }

  onAddCodeToClipboard(code: any): void {
    if (!code || !code.system || !code.code) {
      this.toastService.showWarning('Code is missing system or code and cannot be added to the clipboard.', 'Clipboard Warning');
      return;
    }

    const coding: Coding = {
      system: code.system,
      code: code.code,
      display: code.display
    };

    try {
      this.clipboardService.addCoding(coding);
      this.toastService.showSuccess('Coding added to clipboard.', 'Clipboard Updated');
    } catch (error) {
      console.error('Failed to add Coding to clipboard:', error);
      this.toastService.showError('Failed to add Coding to clipboard.', 'Clipboard Error');
    }
  }

  openDeleteConfirmationModal(): void {
    this.showDeleteConfirmationModal.set(true);
  }

  closeDeleteConfirmationModal(): void {
    if (this.deleteInProgress()) {
      return;
    }
    this.showDeleteConfirmationModal.set(false);
  }

  async confirmDeleteValueSet(): Promise<void> {
    const handler = this.onDeleteValueSet();
    if (!handler) {
      return;
    }

    this.deleteInProgress.set(true);
    try {
      await handler();
      this.showDeleteConfirmationModal.set(false);
    } catch {
      // Keep modal open so the user can retry or cancel after an error.
    } finally {
      this.deleteInProgress.set(false);
    }
  }
}

