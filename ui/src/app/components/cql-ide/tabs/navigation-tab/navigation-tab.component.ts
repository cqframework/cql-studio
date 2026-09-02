// Author: Preston Lee

import {Component, ChangeDetectionStrategy, OnInit, inject, signal, effect} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { Library, Patient, Group } from 'fhir/r4';
import { LibraryService } from '../../../../services/library.service';
import { PatientService } from '../../../../services/patient.service';
import { GroupService } from '../../../../services/group.service';
import { IdeContextService } from '../../../../services/ide-context.service';
import { IdeContextType } from '../../../../models/ide-context.model';
import { IdeStateService, TabDataScope } from '../../../../services/ide-state.service';
import { CqlIdeLibraryOpenerService } from '../../../../services/cql-ide-library-opener.service';
import { isResourceType } from '../../../../services/fhir-resource-type.lib';
import { describeFhirHttpFailure } from '../../../../services/fhir-http-error.lib';
import { buildNewLibraryCql } from '../../../../services/new-cql-library.lib';
import { displayNameFromFhirResource } from '../../../../services/workspace-resource-link.lib';
import { NewLibraryModalComponent } from '../../new-library-modal/new-library-modal.component';

@Component({
  selector: 'app-navigation-tab',
  imports: [FormsModule, NewLibraryModalComponent],
  templateUrl: './navigation-tab.component.html',

  styleUrls: ['./navigation-tab.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NavigationTabComponent implements OnInit {
  private readonly libraryService = inject(LibraryService);
  protected readonly patientService = inject(PatientService);
  protected readonly groupService = inject(GroupService);
  protected readonly ideContextService = inject(IdeContextService);
  private readonly ideStateService = inject(IdeStateService);
  private readonly libraryOpenerService = inject(CqlIdeLibraryOpenerService);

  protected readonly paginatedLibraries = signal<Library[]>([]);
  protected readonly currentPage = signal(1);
  protected readonly totalPages = signal(0);
  protected readonly totalLibraries = signal(0);
  protected readonly pageSize = signal(5);
  protected readonly librarySortBy = signal<'name' | 'version' | 'date'>('name');
  protected readonly librarySortOrder = signal<'asc' | 'desc'>('asc');
  protected readonly isLoadingLibraries = signal(false);
  protected readonly libraryListSearchTerm = signal('');

  protected readonly patientSearchTerm = signal('');
  protected readonly patientSearchResults = signal<Patient[]>([]);
  protected readonly isSearchingPatients = signal(false);
  protected readonly showPatientSearchResults = signal(false);

  protected readonly groupSearchTerm = signal('');
  protected readonly groupSearchResults = signal<Group[]>([]);
  protected readonly isSearchingGroups = signal(false);
  protected readonly showGroupSearchResults = signal(false);

  protected readonly contextType = this.ideContextService.contextType;
  protected readonly showNewLibraryModal = signal(false);

  public Math = Math;

  private lastSeenLibraryListInvalidation = 0;
  private patientSearchGeneration = 0;
  private groupSearchGeneration = 0;

  constructor() {
    effect(() => {
      const inv = this.ideStateService.tabDataInvalidation();
      const count = inv[TabDataScope.LibraryList] ?? 0;
      if (count > this.lastSeenLibraryListInvalidation) {
        this.lastSeenLibraryListInvalidation = count;
        this.loadLibraries();
      }
    });
  }

  ngOnInit(): void {
    this.loadPaginatedLibraries();
  }

  openNewLibraryModal(): void {
    this.showNewLibraryModal.set(true);
  }

  onNewLibraryModalCancel(): void {
    this.showNewLibraryModal.set(false);
  }

  onNewLibraryCreate(title: string): void {
    this.showNewLibraryModal.set(false);

    const cqlContent = buildNewLibraryCql(title);
    const libraryResource = {
      id: title,
      name: title,
      title,
      version: '1.0.0',
      description: 'New library',
      url: this.libraryService.urlFor(title),
      cqlContent,
      originalContent: cqlContent,
      isActive: false,
      isDirty: false,
      library: null
    };

    this.ideStateService.addLibraryResource(libraryResource);
    this.ideStateService.selectLibraryResource(title);
  }

  async loadPaginatedLibraries(): Promise<void> {
    this.isLoadingLibraries.set(true);
    try {
      const bundle = await firstValueFrom(
        this.libraryService.getAll(
          this.currentPage(),
          this.pageSize(),
          this.librarySortBy(),
          this.librarySortOrder()
        )
      );
      this.isLoadingLibraries.set(false);
      const libraries = bundle.entry
        ? bundle.entry
            .map(entry => entry.resource)
            .filter((resource): resource is Library => isResourceType(resource, 'Library'))
        : [];
      this.paginatedLibraries.set(libraries);

      const hasNextPage = bundle.link?.some(link => link.relation === 'next');

      if (bundle.total && bundle.total > 0) {
        this.totalLibraries.set(bundle.total);
        this.totalPages.set(Math.ceil(bundle.total / this.pageSize()));
      } else if (hasNextPage) {
        this.totalLibraries.set(this.currentPage() * this.pageSize() + 1);
        this.totalPages.set(this.currentPage() + 1);
      } else {
        this.totalLibraries.set((this.currentPage() - 1) * this.pageSize() + libraries.length);
        this.totalPages.set(this.currentPage());
      }
    } catch (error: unknown) {
      this.isLoadingLibraries.set(false);
      this.ideStateService.addErrorOutput(
        'Library List Error',
        `Failed to load libraries from server: ${describeFhirHttpFailure(error)}`
      );
      this.paginatedLibraries.set([]);
      this.totalPages.set(0);
      this.totalLibraries.set(0);
    }
  }

  loadLibraries(): void {
    if (this.libraryListSearchTerm().trim()) {
      this.loadSearchedLibraries();
    } else {
      this.loadPaginatedLibraries();
    }
  }

  goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages() && page !== this.currentPage()) {
      this.currentPage.set(page);
      this.loadLibraries();
    }
  }

  nextPage(): void {
    if (this.currentPage() < this.totalPages()) {
      this.goToPage(this.currentPage() + 1);
    }
  }

  previousPage(): void {
    if (this.currentPage() > 1) {
      this.goToPage(this.currentPage() - 1);
    }
  }

  changePageSize(newPageSize: number): void {
    this.pageSize.set(newPageSize);
    this.currentPage.set(1);
    this.loadLibraries();
  }

  changeSorting(sortBy: 'name' | 'version' | 'date'): void {
    if (this.librarySortBy() === sortBy) {
      this.librarySortOrder.set(this.librarySortOrder() === 'asc' ? 'desc' : 'asc');
    } else {
      this.librarySortBy.set(sortBy);
      this.librarySortOrder.set('asc');
    }
    this.currentPage.set(1);
    this.loadLibraries();
  }

  addLibraryFromPaginatedList(library: Library): void {
    if (library.id) {
      void this.libraryOpenerService.openLibraryFromServer(library);
    }
  }

  onLibraryListSearch(): void {
    if (this.libraryListSearchTerm().trim()) {
      this.currentPage.set(1);
      this.loadSearchedLibraries();
    } else {
      this.loadPaginatedLibraries();
    }
  }

  async loadSearchedLibraries(): Promise<void> {
    this.isLoadingLibraries.set(true);
    try {
      const bundle = await firstValueFrom(
        this.libraryService.searchPaginated(
          this.libraryListSearchTerm(),
          this.currentPage(),
          this.pageSize(),
          this.librarySortBy(),
          this.librarySortOrder()
        )
      );
      this.isLoadingLibraries.set(false);
      const libraries = bundle.entry
        ? bundle.entry
            .map(entry => entry.resource)
            .filter((resource): resource is Library => isResourceType(resource, 'Library'))
        : [];
      this.paginatedLibraries.set(libraries);

      const hasNextPage = bundle.link?.some(link => link.relation === 'next');

      if (bundle.total && bundle.total > 0) {
        this.totalLibraries.set(bundle.total);
        this.totalPages.set(Math.ceil(bundle.total / this.pageSize()));
      } else if (hasNextPage) {
        this.totalLibraries.set(this.currentPage() * this.pageSize() + 1);
        this.totalPages.set(this.currentPage() + 1);
      } else {
        this.totalLibraries.set((this.currentPage() - 1) * this.pageSize() + libraries.length);
        this.totalPages.set(this.currentPage());
      }
    } catch (error: unknown) {
      this.isLoadingLibraries.set(false);
      this.ideStateService.addErrorOutput(
        'Library List Error',
        `Failed to search libraries on server: ${describeFhirHttpFailure(error)}`
      );
      this.paginatedLibraries.set([]);
      this.totalPages.set(0);
      this.totalLibraries.set(0);
    }
  }

  getLibraryDisplayName(library: Library): string {
    return displayNameFromFhirResource(library) ?? 'Unknown';
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
    const total = this.totalPages();
    const current = this.currentPage();
    
    if (total <= maxVisiblePages) {
      for (let i = 1; i <= total; i++) {
        pages.push(i);
      }
    } else {
      pages.push(1);
      
      if (current > 3) {
        pages.push('...');
      }
      
      const start = Math.max(2, current - 1);
      const end = Math.min(total - 1, current + 1);
      
      for (let i = start; i <= end; i++) {
        if (i !== 1 && i !== total) {
          pages.push(i);
        }
      }
      
      if (current < total - 2) {
        pages.push('...');
      }
      
      if (total > 1) {
        pages.push(total);
      }
    }
    
    return pages;
  }

  onPageClick(page: number | string): void {
    if (typeof page === 'number') {
      this.goToPage(page);
    }
  }

  setContextType(type: IdeContextType): void {
    this.ideContextService.setContextType(type);
    this.clearPatientSearch();
    this.clearGroupSearch();
  }

  async onPatientSearchInput(event: Event): Promise<void> {
    const searchTerm = (event.target as HTMLInputElement).value;
    this.patientSearchTerm.set(searchTerm);
    const generation = ++this.patientSearchGeneration;

    if (searchTerm.trim()) {
      this.isSearchingPatients.set(true);
      try {
        const bundle = await firstValueFrom(this.patientService.search(searchTerm));
        if (generation !== this.patientSearchGeneration) {
          return;
        }
        this.isSearchingPatients.set(false);
        if (bundle.entry && bundle.entry.length > 0) {
          this.patientSearchResults.set(
            bundle.entry
              .map(entry => entry.resource)
              .filter((resource): resource is Patient => isResourceType(resource, 'Patient'))
          );
          this.showPatientSearchResults.set(true);
        } else {
          this.patientSearchResults.set([]);
          this.showPatientSearchResults.set(true);
        }
      } catch (error: any) {
        if (generation !== this.patientSearchGeneration) {
          return;
        }
        this.isSearchingPatients.set(false);
        console.error('Error searching patients:', error);
      }
    } else {
      this.isSearchingPatients.set(false);
      this.showPatientSearchResults.set(false);
      this.patientSearchResults.set([]);
    }
  }

  selectPatient(patient: Patient): void {
    if (patient.id) {
      this.patientService.addPatient(patient);
      this.ideContextService.notifySelectionChanged();
      this.showPatientSearchResults.set(false);
      this.patientSearchTerm.set('');
      this.patientSearchResults.set([]);
    }
  }

  clearPatientSearch(): void {
    this.patientSearchGeneration++;
    this.patientSearchTerm.set('');
    this.patientSearchResults.set([]);
    this.showPatientSearchResults.set(false);
    this.isSearchingPatients.set(false);
  }

  clearPatientSelection(): void {
    this.patientService.clearSelection();
    this.ideContextService.notifySelectionChanged();
    this.clearPatientSearch();
  }

  removePatient(patientId: string): void {
    this.patientService.removePatient(patientId);
    this.ideContextService.notifySelectionChanged();
  }

  getPatientDisplayName(patient: Patient): string {
    return this.patientService.getDisplayName(patient);
  }

  async onGroupSearchInput(event: Event): Promise<void> {
    const searchTerm = (event.target as HTMLInputElement).value;
    this.groupSearchTerm.set(searchTerm);
    const generation = ++this.groupSearchGeneration;

    if (searchTerm.trim()) {
      this.isSearchingGroups.set(true);
      try {
        const bundle = await firstValueFrom(this.groupService.search(searchTerm));
        if (generation !== this.groupSearchGeneration) {
          return;
        }
        this.isSearchingGroups.set(false);
        if (bundle.entry && bundle.entry.length > 0) {
          this.groupSearchResults.set(
            bundle.entry
              .map(entry => entry.resource)
              .filter((resource): resource is Group => isResourceType(resource, 'Group'))
          );
          this.showGroupSearchResults.set(true);
        } else {
          this.groupSearchResults.set([]);
          this.showGroupSearchResults.set(true);
        }
      } catch (error: unknown) {
        if (generation !== this.groupSearchGeneration) {
          return;
        }
        this.isSearchingGroups.set(false);
        console.error('Error searching groups:', error);
      }
    } else {
      this.isSearchingGroups.set(false);
      this.showGroupSearchResults.set(false);
      this.groupSearchResults.set([]);
    }
  }

  selectGroup(group: Group): void {
    if (group.id) {
      this.groupService.addGroup(group);
      this.ideContextService.notifySelectionChanged();
      this.showGroupSearchResults.set(false);
      this.groupSearchTerm.set('');
      this.groupSearchResults.set([]);
    }
  }

  clearGroupSearch(): void {
    this.groupSearchGeneration++;
    this.groupSearchTerm.set('');
    this.groupSearchResults.set([]);
    this.showGroupSearchResults.set(false);
    this.isSearchingGroups.set(false);
  }

  clearGroupSelection(): void {
    this.groupService.clearSelection();
    this.ideContextService.notifySelectionChanged();
    this.clearGroupSearch();
  }

  removeGroup(groupId: string): void {
    this.groupService.removeGroup(groupId);
    this.ideContextService.notifySelectionChanged();
  }

  getGroupDisplayName(group: Group): string {
    return this.groupService.getDisplayName(group);
  }

  trackByLibraryId(index: number, library: Library): string {
    return library.id || index.toString();
  }

  trackByPatientId(index: number, patient: Patient): string {
    return patient.id || index.toString();
  }

  trackByGroupId(index: number, group: Group): string {
    return group.id || index.toString();
  }
}
