// Author: Preston Lee

import { Component, input, computed, signal, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ValueSet, Coding } from 'fhir/r4';
import { ToastService } from '../../../services/toast.service';
import { ClipboardService } from '../../../services/clipboard.service';

@Component({
  selector: 'app-code-search-details-pane',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './code-search-details-pane.component.html',
  styleUrl: './code-search-details-pane.component.scss'
})
export class CodeSearchDetailsPaneComponent {
  searchValueSet = input<ValueSet | null>(null);
  searchFilter = input<string>('');
  expandLoading = input<boolean>(false);
  expandedCodes = input<any[]>([]);
  expandedRows = input<Set<string>>(new Set());
  expandedCodeDetails = input<Map<string, any>>(new Map());
  loadingDetails = input<Set<string>>(new Set());
  availablePageSizes = input<number[]>([25, 50, 100, 200]);
  onRowToggle = input<(code: any) => void>();

  private toastService = inject(ToastService);
  private clipboardService = inject(ClipboardService);

  protected readonly currentPage = signal<number>(1);
  protected readonly pageSize = signal<number>(50);

  constructor() {
    effect(() => {
      this.expandedCodes();
      this.currentPage.set(1);
    });
  }

  protected readonly paginatedCodes = computed(() => {
    const codes = this.expandedCodes();
    const size = this.pageSize();
    const page = this.currentPage();
    const startIndex = (page - 1) * size;
    const endIndex = startIndex + size;
    return codes.slice(startIndex, endIndex);
  });

  protected readonly totalPages = computed(() => {
    const codes = this.expandedCodes().length;
    const size = this.pageSize();
    return Math.max(1, Math.ceil(codes / size));
  });

  protected readonly hasPreviousPage = computed(() => this.currentPage() > 1);
  protected readonly hasNextPage = computed(() => this.currentPage() < this.totalPages());
  protected readonly startIndex = computed(() => (this.currentPage() - 1) * this.pageSize() + 1);
  protected readonly endIndex = computed(() => {
    const total = this.expandedCodes().length;
    const end = this.currentPage() * this.pageSize();
    return Math.min(end, total);
  });

  get currentPageSize(): number {
    return this.pageSize();
  }
  set currentPageSize(value: number) {
    this.setPageSize(value);
  }

  setPageSize(size: number): void {
    this.pageSize.set(size);
    const maxPage = Math.max(1, Math.ceil(this.expandedCodes().length / size));
    if (this.currentPage() > maxPage) {
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

  formatDate(dateString?: string): string {
    if (!dateString) return '';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return dateString;
      return date.toLocaleString();
    } catch {
      return dateString;
    }
  }

  handleRowClick(code: any): void {
    const handler = this.onRowToggle();
    if (handler) handler(code);
  }

  onAddCodeToClipboard(code: any): void {
    if (!code?.system || !code?.code) {
      this.toastService.showWarning('Code is missing system or code and cannot be added to the clipboard.', 'Clipboard Warning');
      return;
    }
    const coding: Coding = { system: code.system, code: code.code, display: code.display };
    try {
      this.clipboardService.addCoding(coding);
      this.toastService.showSuccess('Coding added to clipboard.', 'Clipboard Updated');
    } catch (error) {
      this.toastService.showError('Failed to add Coding to clipboard.', 'Clipboard Error');
    }
  }
}
