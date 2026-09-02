// Author: Preston Lee

import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  inject,
  signal,
  computed,
  input,
  output,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Bundle, Library } from 'fhir/r4';
import { firstValueFrom } from 'rxjs';
import { LibraryService } from '../../../services/library.service';
import { isResourceType } from '../../../services/fhir-resource-type.lib';
import { describeFhirHttpFailure } from '../../../services/fhir-http-error.lib';
import { displayNameFromFhirResource } from '../../../services/workspace-resource-link.lib';
import { BootstrapPaginationComponent } from '../../shared/bootstrap-pagination/bootstrap-pagination.component';

@Component({
  selector: 'app-sql-library-list-panel',
  imports: [FormsModule, BootstrapPaginationComponent],
  templateUrl: './sql-library-list-panel.component.html',
  styleUrl: './sql-library-list-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SqlLibraryListPanelComponent implements OnInit {
  private readonly libraryService = inject(LibraryService);

  readonly selectedLibraryId = input<string | null>(null);
  readonly librarySelected = output<Library>();

  protected readonly paginatedLibraries = signal<Library[]>([]);
  protected readonly currentPage = signal(1);
  protected readonly totalPages = signal(0);
  protected readonly totalLibraries = signal(0);
  protected readonly pageSize = signal(5);
  protected readonly librarySortBy = signal<'name' | 'version' | 'date'>('name');
  protected readonly librarySortOrder = signal<'asc' | 'desc'>('asc');
  protected readonly isLoadingLibraries = signal(false);
  protected readonly libraryListSearchTerm = signal('');
  protected readonly listError = signal<string | null>(null);

  protected readonly hasPreviousPage = computed(() => this.currentPage() > 1);
  protected readonly hasNextPage = computed(() => this.currentPage() < this.totalPages());

  protected readonly startIndex = computed(() => {
    if (this.totalLibraries() === 0) {
      return 0;
    }
    return (this.currentPage() - 1) * this.pageSize() + 1;
  });

  protected readonly endIndex = computed(() => {
    const total = this.totalLibraries();
    const end = this.currentPage() * this.pageSize();
    return Math.min(end, total);
  });

  ngOnInit(): void {
    this.loadPaginatedLibraries();
  }

  protected async loadPaginatedLibraries(): Promise<void> {
    this.isLoadingLibraries.set(true);
    this.listError.set(null);
    try {
      const bundle = await firstValueFrom(
        this.libraryService.getAll(
          this.currentPage(),
          this.pageSize(),
          this.librarySortBy(),
          this.librarySortOrder(),
        ),
      );
      this.isLoadingLibraries.set(false);
      this.paginatedLibraries.set(
        bundle.entry
          ? bundle.entry
              .map(e => e.resource)
              .filter((resource): resource is Library => isResourceType(resource, 'Library'))
          : [],
      );
      this.applyBundlePagination(bundle);
    } catch (err: unknown) {
      this.isLoadingLibraries.set(false);
      this.listError.set(this.errorMessage(err));
      this.paginatedLibraries.set([]);
      this.totalPages.set(0);
      this.totalLibraries.set(0);
    }
  }

  private applyBundlePagination(bundle: Bundle): void {
    const entries = bundle.entry?.length ?? 0;
    const hasNextPage = bundle.link?.some(l => l.relation === 'next');
    if (bundle.total != null && bundle.total > 0) {
      this.totalLibraries.set(bundle.total);
      this.totalPages.set(Math.ceil(bundle.total / this.pageSize()));
    } else if (hasNextPage) {
      this.totalLibraries.set(this.currentPage() * this.pageSize() + 1);
      this.totalPages.set(this.currentPage() + 1);
    } else {
      this.totalLibraries.set((this.currentPage() - 1) * this.pageSize() + entries);
      this.totalPages.set(this.currentPage());
    }
  }

  protected loadLibraries(): void {
    if (this.libraryListSearchTerm().trim()) {
      this.loadSearchedLibraries();
    } else {
      this.loadPaginatedLibraries();
    }
  }

  protected async loadSearchedLibraries(): Promise<void> {
    this.isLoadingLibraries.set(true);
    this.listError.set(null);
    try {
      const bundle = await firstValueFrom(
        this.libraryService.searchPaginated(
          this.libraryListSearchTerm(),
          this.currentPage(),
          this.pageSize(),
          this.librarySortBy(),
          this.librarySortOrder(),
        ),
      );
      this.isLoadingLibraries.set(false);
      this.paginatedLibraries.set(
        bundle.entry
          ? bundle.entry
              .map(e => e.resource)
              .filter((resource): resource is Library => isResourceType(resource, 'Library'))
          : [],
      );
      this.applyBundlePagination(bundle);
    } catch (err: unknown) {
      this.isLoadingLibraries.set(false);
      this.listError.set(this.errorMessage(err));
      this.paginatedLibraries.set([]);
      this.totalPages.set(0);
      this.totalLibraries.set(0);
    }
  }

  private errorMessage(err: unknown): string {
    return describeFhirHttpFailure(err) || 'Unable to load libraries from server';
  }

  protected onLibraryListSearch(): void {
    this.currentPage.set(1);
    if (this.libraryListSearchTerm().trim()) {
      this.loadSearchedLibraries();
    } else {
      this.loadPaginatedLibraries();
    }
  }

  protected goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages() && page !== this.currentPage()) {
      this.currentPage.set(page);
      this.loadLibraries();
    }
  }

  protected goFirst(): void {
    this.goToPage(1);
  }

  protected goPrevious(): void {
    if (this.currentPage() > 1) {
      this.goToPage(this.currentPage() - 1);
    }
  }

  protected goNext(): void {
    if (this.currentPage() < this.totalPages()) {
      this.goToPage(this.currentPage() + 1);
    }
  }

  protected goLast(): void {
    this.goToPage(this.totalPages());
  }

  protected changePageSize(newPageSize: number): void {
    this.pageSize.set(Number(newPageSize));
    this.currentPage.set(1);
    this.loadLibraries();
  }

  protected changeSortField(value: string): void {
    this.changeSorting(value as 'name' | 'version' | 'date');
  }

  protected changeSorting(sortBy: 'name' | 'version' | 'date'): void {
    if (this.librarySortBy() === sortBy) {
      this.librarySortOrder.update(o => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      this.librarySortBy.set(sortBy);
      this.librarySortOrder.set('asc');
    }
    this.currentPage.set(1);
    this.loadLibraries();
  }

  protected onLibraryClick(library: Library): void {
    this.librarySelected.emit(library);
  }

  protected getLibraryDisplayName(library: Library): string {
    return displayNameFromFhirResource(library) ?? 'Unknown';
  }

  protected getLibraryVersion(library: Library): string {
    return library.version || 'N/A';
  }

  protected trackByLibraryId(_index: number, library: Library): string {
    return library.id ?? _index.toString();
  }
}
