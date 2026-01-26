// Author: Preston Lee

import { Component, OnInit, output, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Library, Bundle } from 'fhir/r4';
import { LibraryService } from '../../../services/library.service';
import { SettingsService } from '../../../services/settings.service';

@Component({
  selector: 'app-guidelines-browser',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './guidelines-browser.component.html',
  styleUrl: './guidelines-browser.component.scss'
})
export class GuidelinesBrowserComponent implements OnInit {
  openLibrary = output<Library>();
  testLibrary = output<Library>();
  deleteLibrary = output<Library>();
  createNew = output<void>();

  protected libraries: Library[] = [];
  protected isLoading = false;
  protected searchTerm = '';
  protected currentPage = 1;
  protected totalPages = 0;
  protected totalLibraries = 0;
  protected pageSize = 10;
  protected sortBy: 'name' | 'version' | 'date' = 'name';
  protected sortOrder: 'asc' | 'desc' = 'asc';

  private libraryService = inject(LibraryService);
  public settingsService = inject(SettingsService);

  ngOnInit(): void {
    this.loadLibraries();
  }

  public loadLibraries(): void {
    this.isLoading = true;
    this.libraryService.getAll(this.currentPage, this.pageSize, this.sortBy, this.sortOrder).subscribe({
      next: (bundle: Bundle<Library>) => {
        this.isLoading = false;
        this.libraries = bundle.entry ? bundle.entry.map(entry => entry.resource!).filter((r): r is Library => r !== undefined) : [];
        
        if (bundle.total && bundle.total > 0) {
          this.totalLibraries = bundle.total;
          this.totalPages = Math.ceil(bundle.total / this.pageSize);
        } else {
          const hasNextPage = bundle.link?.some(link => link.relation === 'next');
          if (hasNextPage) {
            this.totalLibraries = (this.currentPage * this.pageSize) + 1;
            this.totalPages = this.currentPage + 1;
          } else {
            this.totalLibraries = (this.currentPage - 1) * this.pageSize + this.libraries.length;
            this.totalPages = this.currentPage;
          }
        }
      },
      error: (error: any) => {
        this.isLoading = false;
        console.error('Error loading libraries:', error);
        this.libraries = [];
        this.totalPages = 0;
        this.totalLibraries = 0;
      }
    });
  }

  onSearch(): void {
    if (this.searchTerm.trim()) {
      this.isLoading = true;
      this.libraryService.search(this.searchTerm).subscribe({
        next: (bundle: Bundle<Library>) => {
          this.isLoading = false;
          this.libraries = bundle.entry ? bundle.entry.map(entry => entry.resource!).filter((r): r is Library => r !== undefined) : [];
          this.totalLibraries = this.libraries.length;
          this.totalPages = 1;
          this.currentPage = 1;
        },
        error: (error: any) => {
          this.isLoading = false;
          console.error('Error searching libraries:', error);
          this.libraries = [];
        }
      });
    } else {
      this.loadLibraries();
    }
  }

  onClearSearch(): void {
    this.searchTerm = '';
    this.currentPage = 1;
    this.loadLibraries();
  }

  onOpenLibrary(library: Library): void {
    this.openLibrary.emit(library);
  }

  onTestLibrary(library: Library): void {
    this.testLibrary.emit(library);
  }

  onCreateNew(): void {
    this.createNew.emit();
  }

  onDeleteLibrary(library: Library): void {
    const libraryName = library.name || library.id || 'this library';
    if (confirm(`Are you sure you want to delete "${libraryName}"? This action cannot be undone.`)) {
      this.deleteLibrary.emit(library);
    }
  }

  goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
      this.loadLibraries();
    }
  }

  onSort(column: 'name' | 'version' | 'date'): void {
    if (this.sortBy === column) {
      this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortBy = column;
      this.sortOrder = 'asc';
    }
    this.currentPage = 1;
    this.loadLibraries();
  }

  protected readonly Math = Math;
}

