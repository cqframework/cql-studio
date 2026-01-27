// Author: Preston Lee

import { Component, input, computed, signal, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ValueSet } from 'fhir/r4';
import { ToastService } from '../../../services/toast.service';

@Component({
  selector: 'app-valueset-details-pane',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './valueset-details-pane.component.html',
  styleUrl: './valueset-details-pane.component.scss'
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
  
  // Services
  private toastService = inject(ToastService);
  
  // Internal pagination state
  protected readonly currentPage = signal<number>(1);
  protected readonly pageSize = signal<number>(50);

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

  // Getter/setter for pageSize binding with ngModel
  get currentPageSize(): number {
    return this.pageSize();
  }

  set currentPageSize(value: number) {
    this.setPageSize(value);
  }

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
      const jsonString = JSON.stringify(valueSet, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const filename = valueSet.id 
        ? `ValueSet-${valueSet.id}.json`
        : valueSet.url 
          ? `ValueSet-${valueSet.url.replace(/[^a-zA-Z0-9]/g, '_')}.json`
          : 'ValueSet.json';
      
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download ValueSet:', error);
      this.toastService.showError('Failed to download ValueSet', 'Download Error');
    }
  }
}

