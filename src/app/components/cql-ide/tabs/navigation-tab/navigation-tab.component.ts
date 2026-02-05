// Author: Preston Lee

import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Library, Patient, Bundle } from 'fhir/r4';
import { LibraryService } from '../../../../services/library.service';
import { PatientService } from '../../../../services/patient.service';
import { IdeStateService } from '../../../../services/ide-state.service';
import { SettingsService } from '../../../../services/settings.service';

@Component({
  selector: 'app-navigation-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './navigation-tab.component.html',
  styleUrls: ['./navigation-tab.component.scss']
})
export class NavigationTabComponent implements OnInit {
  // Paginated Library List
  public paginatedLibraries: Library[] = [];
  public currentPage: number = 1;
  public totalPages: number = 0;
  public totalLibraries: number = 0;
  public pageSize: number = 5;
  public librarySortBy: 'name' | 'version' | 'date' = 'name';
  public librarySortOrder: 'asc' | 'desc' = 'asc';
  public isLoadingLibraries: boolean = false;
  public libraryListSearchTerm: string = '';

  // Patient search
  public patientSearchTerm: string = '';
  public patientSearchResults: Patient[] = [];
  public isSearchingPatients: boolean = false;
  public showPatientSearchResults: boolean = false;

  // Expose Math for template use
  public Math = Math;

  constructor(
    public libraryService: LibraryService,
    public patientService: PatientService,
    public ideStateService: IdeStateService,
    public settingsService: SettingsService
  ) {}

  ngOnInit(): void {
    this.loadPaginatedLibraries();
  }

  createNewLibraryResource(): void {
    const newId = `new-library-${Date.now()}`;
    const effectiveFhirBaseUrl = this.settingsService.getEffectiveFhirBaseUrl();
    const canonicalUrl = `${effectiveFhirBaseUrl}/Library/${newId}`;
    
    const libraryResource = {
      id: newId,
      name: 'NewLibrary',
      title: 'New Library',
      version: '1.0.0',
      description: 'New library',
      url: canonicalUrl,
      cqlContent: '',
      originalContent: '',
      isActive: false,
      isDirty: false,
      library: null
    };
    
    this.ideStateService.addLibraryResource(libraryResource);
    this.ideStateService.selectLibraryResource(newId);
  }

  // Paginated library methods
  public loadPaginatedLibraries(): void {
    this.isLoadingLibraries = true;
    this.libraryService.getAll(this.currentPage, this.pageSize, this.librarySortBy, this.librarySortOrder).subscribe({
      next: (bundle: Bundle<Library>) => {
        this.isLoadingLibraries = false;
        this.paginatedLibraries = bundle.entry ? bundle.entry.map(entry => entry.resource!) : [];
        
        // Check for next page using FHIR bundle links
        const hasNextPage = bundle.link?.some(link => link.relation === 'next');
        const hasPreviousPage = bundle.link?.some(link => link.relation === 'previous');
        
        if (bundle.total && bundle.total > 0) {
          this.totalLibraries = bundle.total;
          this.totalPages = Math.ceil(bundle.total / this.pageSize);
        } else {
          // Use FHIR links to determine pagination
          if (hasNextPage) {
            // There are more pages, estimate total
            this.totalLibraries = (this.currentPage * this.pageSize) + 1;
            this.totalPages = this.currentPage + 1;
          } else {
            // No next page, this is the last page
            this.totalLibraries = (this.currentPage - 1) * this.pageSize + this.paginatedLibraries.length;
            this.totalPages = this.currentPage;
          }
        }
      },
      error: (error: any) => {
        this.isLoadingLibraries = false;
        console.error('Error loading paginated libraries:', error);
        const errorMessage = error?.message || error?.error?.message || 'Unable to connect to server';
        this.ideStateService.addErrorOutput(
          'Library List Error',
          `Failed to load libraries from server: ${errorMessage}`
        );
        this.paginatedLibraries = [];
        this.totalPages = 0;
        this.totalLibraries = 0;
      }
    });
  }

  private loadLibraries(): void {
    if (this.libraryListSearchTerm.trim()) {
      this.loadSearchedLibraries();
    } else {
      this.loadPaginatedLibraries();
    }
  }

  goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages && page !== this.currentPage) {
      this.currentPage = page;
      this.loadLibraries();
    }
  }

  nextPage(): void {
    if (this.currentPage < this.totalPages) {
      this.goToPage(this.currentPage + 1);
    }
  }

  previousPage(): void {
    if (this.currentPage > 1) {
      this.goToPage(this.currentPage - 1);
    }
  }

  changePageSize(newPageSize: number): void {
    this.pageSize = newPageSize;
    this.currentPage = 1;
    this.loadLibraries();
  }

  changeSorting(sortBy: 'name' | 'version' | 'date'): void {
    if (this.librarySortBy === sortBy) {
      this.librarySortOrder = this.librarySortOrder === 'asc' ? 'desc' : 'asc';
    } else {
      this.librarySortBy = sortBy;
      this.librarySortOrder = 'asc';
    }
    this.currentPage = 1;
    this.loadLibraries();
  }

  addLibraryFromPaginatedList(library: Library): void {
    if (library.id) {
      const existingLibrary = this.ideStateService.libraryResources().find(lib => lib.id === library.id);
      
      if (existingLibrary) {
        this.ideStateService.selectLibraryResource(library.id);
        return;
      }

      this.libraryService.get(library.id).subscribe({
        next: (freshLibrary) => {
          if (!freshLibrary.id) return;
          const cqlAttachment = freshLibrary.content?.find(c => c.contentType === 'text/cql');
          const fromUrl = !!(cqlAttachment?.url && !cqlAttachment?.data);

          if (fromUrl) {
            const libraryResource = {
              id: freshLibrary.id,
              name: freshLibrary.name || freshLibrary.id,
              title: freshLibrary.title || freshLibrary.name || freshLibrary.id,
              version: freshLibrary.version || '1.0.0',
              description: freshLibrary.description || `Library ${freshLibrary.name || freshLibrary.id}`,
              url: freshLibrary.url || this.libraryService.urlFor(freshLibrary.id),
              cqlContent: '',
              originalContent: '',
              isActive: false,
              isDirty: false,
              library: freshLibrary,
              contentLoading: true,
              isReadOnly: true
            };
            this.ideStateService.addLibraryResource(libraryResource);
            this.ideStateService.selectLibraryResource(freshLibrary.id);
          }

          this.libraryService.getCqlContent(freshLibrary).subscribe({
            next: ({ cqlContent }) => {
              if (fromUrl) {
                this.ideStateService.updateLibraryResource(freshLibrary.id!, {
                  cqlContent,
                  originalContent: cqlContent,
                  contentLoading: false,
                  contentLoadError: undefined
                });
                this.ideStateService.triggerReload(freshLibrary.id!);
              } else {
                const libraryResource = {
                  id: freshLibrary.id!,
                  name: freshLibrary.name || freshLibrary.id!,
                  title: freshLibrary.title || freshLibrary.name || freshLibrary.id!,
                  version: freshLibrary.version || '1.0.0',
                  description: freshLibrary.description || `Library ${freshLibrary.name || freshLibrary.id}`,
                  url: freshLibrary.url || this.libraryService.urlFor(freshLibrary.id!),
                  cqlContent,
                  originalContent: cqlContent,
                  isActive: false,
                  isDirty: false,
                  library: freshLibrary,
                  contentLoading: false,
                  isReadOnly: false
                };
                this.ideStateService.addLibraryResource(libraryResource);
                this.ideStateService.selectLibraryResource(freshLibrary.id!);
              }
            },
            error: (err) => {
              const message = err?.message ?? String(err);
              if (fromUrl) {
                const errorMessage = `Could not load CQL from URL for library "${freshLibrary.name || freshLibrary.id}". ${message}`;
                this.ideStateService.updateLibraryResource(freshLibrary.id!, {
                  contentLoading: false,
                  contentLoadError: errorMessage
                });
                this.ideStateService.addTextOutput(
                  'Library Load Failed',
                  errorMessage,
                  'error'
                );
              } else {
                this.addLibraryFromCachedData(library);
              }
            }
          });
        },
        error: (error) => {
          console.error('Error fetching library from server:', error);
          this.addLibraryFromCachedData(library);
        }
      });
    }
  }
  
  private addLibraryFromCachedData(library: Library): void {
    const id = library.id;
    if (!id) return;
    const cqlAttachment = library.content?.find(c => c.contentType === 'text/cql');
    const fromUrl = !!(cqlAttachment?.url && !cqlAttachment?.data);

    if (fromUrl) {
      const libraryResource = {
        id,
        name: library.name || id,
        title: library.title || library.name || id,
        version: library.version || '1.0.0',
        description: library.description || `Library ${library.name || id}`,
        url: library.url || this.libraryService.urlFor(id),
        cqlContent: '',
        originalContent: '',
        isActive: false,
        isDirty: false,
        library,
        contentLoading: true,
        isReadOnly: true
      };
      this.ideStateService.addLibraryResource(libraryResource);
      this.ideStateService.selectLibraryResource(id);
    }

    this.libraryService.getCqlContent(library).subscribe({
      next: ({ cqlContent }) => {
        if (fromUrl) {
          this.ideStateService.updateLibraryResource(id, {
            cqlContent,
            originalContent: cqlContent,
            contentLoading: false,
            contentLoadError: undefined
          });
          this.ideStateService.triggerReload(id);
        } else {
          const libraryResource = {
            id,
            name: library.name || id,
            title: library.title || library.name || id,
            version: library.version || '1.0.0',
            description: library.description || `Library ${library.name || id}`,
            url: library.url || this.libraryService.urlFor(id),
            cqlContent,
            originalContent: cqlContent,
            isActive: false,
            isDirty: false,
            library,
            contentLoading: false,
            isReadOnly: false
          };
          this.ideStateService.addLibraryResource(libraryResource);
          this.ideStateService.selectLibraryResource(id);
        }
      },
      error: (err) => {
        const message = err?.message ?? String(err);
        if (fromUrl) {
          const errorMessage = `Could not load CQL from URL for library "${library.name || id}". ${message}`;
          this.ideStateService.updateLibraryResource(id, {
            contentLoading: false,
            contentLoadError: errorMessage
          });
          this.ideStateService.addTextOutput(
            'Library Load Failed',
            errorMessage,
            'error'
          );
        }
      }
    });
  }

  onLibraryListSearch(): void {
    if (this.libraryListSearchTerm.trim()) {
      // Perform server-side search
      this.currentPage = 1;
      this.loadSearchedLibraries();
    } else {
      // Clear search and load paginated list
      this.loadPaginatedLibraries();
    }
  }

  loadSearchedLibraries(): void {
    this.isLoadingLibraries = true;
    this.libraryService.searchPaginated(
      this.libraryListSearchTerm,
      this.currentPage,
      this.pageSize,
      this.librarySortBy,
      this.librarySortOrder
    ).subscribe({
      next: (bundle: Bundle<Library>) => {
        this.isLoadingLibraries = false;
        this.paginatedLibraries = bundle.entry ? bundle.entry.map(entry => entry.resource!) : [];
        
        // Check for next page using FHIR bundle links
        const hasNextPage = bundle.link?.some(link => link.relation === 'next');
        const hasPreviousPage = bundle.link?.some(link => link.relation === 'previous');
        
        if (bundle.total && bundle.total > 0) {
          this.totalLibraries = bundle.total;
          this.totalPages = Math.ceil(bundle.total / this.pageSize);
        } else {
          // Use FHIR links to determine pagination
          if (hasNextPage) {
            // There are more pages, estimate total
            this.totalLibraries = (this.currentPage * this.pageSize) + 1;
            this.totalPages = this.currentPage + 1;
          } else {
            // No next page, this is the last page
            this.totalLibraries = (this.currentPage - 1) * this.pageSize + this.paginatedLibraries.length;
            this.totalPages = this.currentPage;
          }
        }
      },
      error: (error: any) => {
        this.isLoadingLibraries = false;
        console.error('Error searching libraries:', error);
        this.paginatedLibraries = [];
        this.totalPages = 0;
        this.totalLibraries = 0;
      }
    });
  }

  getLibraryDisplayName(library: Library): string {
    return library.name || library.id || 'Unknown';
  }

  getLibraryVersion(library: Library): string {
    return library.version || 'N/A';
  }

  getLibraryDescription(library: Library): string {
    return library.description || 'No description available';
  }

  getPageNumbers(): (number | string)[] {
    const pages: (number | string)[] = [];
    const maxVisiblePages = 5;
    
    if (this.totalPages <= maxVisiblePages) {
      for (let i = 1; i <= this.totalPages; i++) {
        pages.push(i);
      }
    } else {
      pages.push(1);
      
      if (this.currentPage > 3) {
        pages.push('...');
      }
      
      const start = Math.max(2, this.currentPage - 1);
      const end = Math.min(this.totalPages - 1, this.currentPage + 1);
      
      for (let i = start; i <= end; i++) {
        if (i !== 1 && i !== this.totalPages) {
          pages.push(i);
        }
      }
      
      if (this.currentPage < this.totalPages - 2) {
        pages.push('...');
      }
      
      if (this.totalPages > 1) {
        pages.push(this.totalPages);
      }
    }
    
    return pages;
  }

  onPageClick(page: number | string): void {
    if (typeof page === 'number') {
      this.goToPage(page);
    }
  }

  // Patient search methods
  onPatientSearchInput(event: any): void {
    const searchTerm = event.target.value;
    this.patientSearchTerm = searchTerm;
    
    if (searchTerm.trim()) {
      this.isSearchingPatients = true;
      this.patientService.search(searchTerm).subscribe({
        next: (bundle: Bundle<Patient>) => {
          this.isSearchingPatients = false;
          if (bundle.entry && bundle.entry.length > 0) {
            this.patientSearchResults = bundle.entry.map(entry => entry.resource!);
            this.showPatientSearchResults = true;
          } else {
            this.patientSearchResults = [];
            this.showPatientSearchResults = true;
          }
        },
        error: (error: any) => {
          this.isSearchingPatients = false;
          console.error('Error searching patients:', error);
        }
      });
    } else {
      this.isSearchingPatients = false;
      this.showPatientSearchResults = false;
      this.patientSearchResults = [];
    }
  }

  selectPatient(patient: Patient): void {
    if (patient.id) {
      this.patientService.addPatient(patient);
      this.showPatientSearchResults = false;
      this.patientSearchTerm = '';
      this.patientSearchResults = [];
    }
  }

  clearPatientSearch(): void {
    this.patientSearchTerm = '';
    this.patientSearchResults = [];
    this.showPatientSearchResults = false;
    this.isSearchingPatients = false;
  }

  clearPatientSelection(): void {
    this.patientService.clearSelection();
    this.clearPatientSearch();
  }

  removePatient(patientId: string): void {
    this.patientService.removePatient(patientId);
  }

  getPatientDisplayName(patient: Patient): string {
    // Try multiple approaches to get patient name
    if (patient.name && patient.name.length > 0) {
      const name = patient.name[0];
      const given = name.given ? name.given.join(' ') : '';
      const family = name.family || '';
      const result = `${given} ${family}`.trim();
      if (result) {
        return result;
      }
    }
    
    // Try alternative name fields
    if (patient.text && patient.text.div) {
      // Extract name from text field if available
      const textMatch = patient.text.div.match(/<div[^>]*>([^<]+)<\/div>/);
      if (textMatch && textMatch[1]) {
        return textMatch[1].trim();
      }
    }
    
    // Try identifier fields
    if (patient.identifier && patient.identifier.length > 0) {
      const identifier = patient.identifier[0];
      if (identifier.value) {
        return identifier.value;
      }
    }
    
    // Fall back to ID
    return patient.id || 'Unknown';
  }

  trackByLibraryId(index: number, library: Library): string {
    return library.id || index.toString();
  }

  trackByPatientId(index: number, patient: Patient): string {
    return patient.id || index.toString();
  }
}
