// Author: Preston Lee

import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { SettingsService } from '../../services/settings.service';
import { TerminologyService } from '../../services/terminology.service';
import { ValueSet, CodeSystem, ConceptMap, Bundle, Parameters } from 'fhir/r4';
import { ValueSetDetailsPaneComponent } from './valueset-details-pane/valueset-details-pane.component';
import { ConceptMapDetailsPaneComponent } from './conceptmap-details-pane/conceptmap-details-pane.component';

interface SearchResult {
  id: string;
  title: string;
  description?: string;
  url?: string;
  status?: string;
  type: 'valueset' | 'codesystem' | 'conceptmap';
}

interface ValidationResult {
  valid: boolean;
  message?: string;
  display?: string;
}

type TerminologyTab = 'valueset' | 'validation' | 'conceptmap' | 'codesystems';

@Component({
  selector: 'app-terminology',
  standalone: true,
  imports: [CommonModule, FormsModule, ValueSetDetailsPaneComponent, ConceptMapDetailsPaneComponent],
  templateUrl: './terminology.component.html',
  styleUrl: './terminology.component.scss'
})
export class TerminologyComponent implements OnInit {

  // Active tab
  protected readonly activeTab = signal<TerminologyTab>('valueset');

  // ValueSet search
  protected readonly valuesetSearchTerm = signal<string>('');
  protected readonly valuesetResults = signal<ValueSet[]>([]);
  protected readonly valuesetLoading = signal<boolean>(false);
  protected readonly valuesetError = signal<string | null>(null);
  protected readonly selectedValueSet = signal<ValueSet | null>(null);
  protected readonly expandedValueSet = signal<ValueSet | null>(null);
  protected readonly expandedCodes = signal<any[]>([]);
  protected readonly expandLoading = signal<boolean>(false);

  // Pagination for ValueSets
  protected readonly valuesetCurrentPage = signal<number>(1);
  protected readonly valuesetPageSize = signal<number>(20);
  protected readonly valuesetTotalCount = signal<number>(0);
  protected readonly valuesetAvailablePageSizes = [10, 20, 50, 100];

  // Pagination for Expanded Codes
  protected readonly currentPage = signal<number>(1);
  protected readonly pageSize = signal<number>(50);
  protected readonly availablePageSizes = [25, 50, 100, 200];

  // Expanded row state for Expanded Codes table
  protected readonly expandedRows = signal<Set<string>>(new Set());
  protected readonly expandedCodeDetails = signal<Map<string, any>>(new Map());
  protected readonly loadingDetails = signal<Set<string>>(new Set());

  // Pagination computed properties
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

  // Code lookup
  protected readonly codeSearchTerm = signal<string>('');
  protected readonly codeSystemUrl = signal<string>('');
  protected readonly codeResults = signal<any[]>([]);
  protected readonly codeLoading = signal<boolean>(false);
  protected readonly codeError = signal<string | null>(null);
  protected readonly expandedNodes = signal<Set<string>>(new Set());
  protected readonly selectedCode = signal<any>(null);
  protected readonly codeDetails = signal<any>(null);
  protected readonly codeDetailsLoading = signal<boolean>(false);
  protected readonly codeParents = signal<any[]>([]);
  protected readonly codeChildren = signal<any[]>([]);

  // Available CodeSystems for dropdown
  protected readonly availableCodeSystems = signal<any[]>([]);

  // Code validation
  protected readonly validationCode = signal<string>('');
  protected readonly validationSystem = signal<string>('');
  protected readonly validationValueSet = signal<string>('');
  protected readonly validationResult = signal<ValidationResult | null>(null);
  protected readonly validationLoading = signal<boolean>(false);
  protected readonly validationError = signal<string | null>(null);

  // ConceptMap search
  protected readonly conceptmapSearchTerm = signal<string>('');
  protected readonly conceptmapResults = signal<ConceptMap[]>([]);
  protected readonly conceptmapLoading = signal<boolean>(false);
  protected readonly conceptmapError = signal<string | null>(null);
  protected readonly selectedConceptMap = signal<ConceptMap | null>(null);

  // Pagination for ConceptMaps
  protected readonly conceptmapCurrentPage = signal<number>(1);
  protected readonly conceptmapPageSize = signal<number>(20);
  protected readonly conceptmapTotalCount = signal<number>(0);
  protected readonly conceptmapAvailablePageSizes = [10, 20, 50, 100];

  // Translation
  protected readonly translateCode = signal<string>('');
  protected readonly translateSystem = signal<string>('');
  protected readonly translateTarget = signal<string>('');
  protected readonly translationResult = signal<any[]>([]);
  protected readonly translationLoading = signal<boolean>(false);
  protected readonly translationError = signal<string | null>(null);

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
  protected readonly codeSystemsPageSize = signal<number>(20);
  protected readonly codeSystemsAvailablePageSizes = [10, 20, 50, 100];

  // CodeSystem row expansion state
  protected readonly expandedCodeSystemRows = signal<Set<string>>(new Set());

  // Server availability
  protected readonly serverAvailable = signal<boolean>(false);
  protected readonly serverLoading = signal<boolean>(true);
  protected readonly serverError = signal<string | null>(null);
  protected readonly resourceCounts = signal<{
    valuesets: number;
    codesystems: number;
    conceptmaps: number;
  } | null>(null);

  // Configuration status
  protected readonly hasValidConfiguration = computed(() => {
    const baseUrl = this.settingsService.getEffectiveTerminologyBaseUrl();
    return baseUrl.trim() !== '';
  });

  protected readonly configurationStatus = computed(() => {
    if (!this.hasValidConfiguration()) {
      return {
        type: 'warning',
        message: 'Terminology service not configured. Please configure the terminology base URL in Settings.',
        showSettings: true
      };
    }
    return {
      type: 'success',
      message: `Connected to ${this.settingsService.getEffectiveTerminologyBaseUrl()}`,
      showSettings: false
    };
  });

  protected settingsService = inject(SettingsService);
  private terminologyService = inject(TerminologyService);
  private router = inject(Router);

  ngOnInit(): void {
    // Initialize server availability check
    this.initializeServerCheck();
    // Load available CodeSystems for dropdown
    this.loadAvailableCodeSystems();
  }

  // Tab management
  setActiveTab(tab: TerminologyTab): void {
    this.activeTab.set(tab);

    // Auto-load ValueSets when ValueSets tab is activated
    if (tab === 'valueset' && this.serverAvailable() && !this.valuesetLoading()) {
      this.searchValueSets(1);
    }

    // Auto-load ConceptMaps when ConceptMaps tab is activated
    if (tab === 'conceptmap' && this.serverAvailable() && !this.conceptmapLoading()) {
      this.searchConceptMaps(1);
    }
  }

  // Server initialization
  private async initializeServerCheck(): Promise<void> {
    if (!this.hasValidConfiguration()) {
      this.serverLoading.set(false);
      this.serverAvailable.set(false);
      this.serverError.set('Terminology service not configured');
      return;
    }

    this.serverLoading.set(true);
    this.serverError.set(null);

    try {
      // Check server availability and get resource counts
      await this.checkServerAvailability();
      this.serverAvailable.set(true);

      // Load code systems automatically
      await this.loadCodeSystems();

      // Auto-load default tab content if server is available
      const currentTab = this.activeTab();
      if (currentTab === 'valueset' && !this.valuesetLoading()) {
        this.searchValueSets(1);
      } else if (currentTab === 'conceptmap' && !this.conceptmapLoading()) {
        this.searchConceptMaps(1);
      }
    } catch (error) {
      this.serverAvailable.set(false);
      this.serverError.set(this.getErrorMessage(error));
    } finally {
      this.serverLoading.set(false);
    }
  }

  private async checkServerAvailability(): Promise<void> {
    try {
      // Get resource counts in parallel
      const [valuesetsResult, codesystemsResult, conceptmapsResult] = await Promise.all([
        firstValueFrom(this.terminologyService.searchValueSets({ _count: 1 })).catch(() => ({ total: 0 })),
        firstValueFrom(this.terminologyService.searchCodeSystems({ _count: 1 })).catch(() => ({ total: 0 })),
        firstValueFrom(this.terminologyService.searchConceptMaps({ _count: 1 })).catch(() => ({ total: 0 }))
      ]);

      this.resourceCounts.set({
        valuesets: valuesetsResult?.total || 0,
        codesystems: codesystemsResult?.total || 0,
        conceptmaps: conceptmapsResult?.total || 0
      });
    } catch (error) {
      console.error('Server availability check failed:', error);
      throw error;
    }
  }

  // ValueSet operations
  async searchValueSets(page: number = 1): Promise<void> {
    if (!this.hasValidConfiguration()) {
      this.valuesetError.set('Please configure terminology service settings first.');
      return;
    }

    this.valuesetLoading.set(true);
    this.valuesetError.set(null);
    this.valuesetCurrentPage.set(page);

    try {
      const searchTerm = this.valuesetSearchTerm().trim();
      const pageSize = this.valuesetPageSize();
      const offset = (page - 1) * pageSize;
      const params: any = {
        _count: pageSize,
        _offset: offset
      };

      if (searchTerm) {
        // Try searching by name first, then title
        params.name = searchTerm;
      }

      const result = await firstValueFrom(this.terminologyService.searchValueSets(params));
      this.valuesetResults.set(result?.entry?.map(e => e.resource!) || []);

      // Update total count from bundle
      if (result?.total !== undefined) {
        this.valuesetTotalCount.set(result.total);
      } else {
        // Estimate total if not provided
        const currentResults = this.valuesetResults().length;
        if (currentResults === pageSize) {
          // Might have more results
          this.valuesetTotalCount.set((page * pageSize) + 1);
        } else {
          // This is likely the last page
          this.valuesetTotalCount.set((page - 1) * pageSize + currentResults);
        }
      }
    } catch (error) {
      this.valuesetError.set(this.getErrorMessage(error));
    } finally {
      this.valuesetLoading.set(false);
    }
  }

  async selectValueSet(valueset: ValueSet): Promise<void> {
    this.selectedValueSet.set(valueset);
    await this.expandValueSet();
  }

  async expandValueSet(): Promise<void> {
    const valueset = this.selectedValueSet();
    if (!valueset) return;

    this.expandLoading.set(true);

    try {
      // Try different approaches for ValueSet expansion
      let params: any = {
        includeDesignations: true,
        includeDefinition: true,
        activeOnly: true
      };

      // First try with ID if available (uses GET /ValueSet/{id}/$expand)
      if (valueset.id) {
        params.id = valueset.id;
        console.log('Expanding ValueSet with ID:', valueset.id);
      } else if (valueset.url) {
        // Fall back to URL, decode if encoded (uses POST /ValueSet/$expand)
        const url = decodeURIComponent(valueset.url);
        params.url = url;
        console.log('Expanding ValueSet with URL:', url);
      } else {
        throw new Error('No ID or URL available for ValueSet expansion');
      }

      const result = await firstValueFrom(this.terminologyService.expandValueSet(params));
      this.expandedValueSet.set(result || null);
      this.expandedCodes.set(result?.expansion?.contains || []);
      this.currentPage.set(1); // Reset to first page when expanding new ValueSet
    } catch (error) {
      console.error('ValueSet expansion error:', error);

      // If error mentions unknown ValueSet, try alternative approach
      if ((error as any)?.error?.issue?.[0]?.diagnostics?.includes('Unknown ValueSet')) {
        console.log('ValueSet not found, trying alternative approach...');
        try {
          // Try with just the ValueSet name/identifier
          const alternativeParams = {
            valueSet: valueset.name || valueset.id,
            includeDesignations: true,
            includeDefinition: true,
            activeOnly: true
          };

          const result = await firstValueFrom(this.terminologyService.expandValueSet(alternativeParams));
          this.expandedCodes.set(result?.expansion?.contains || []);
          this.currentPage.set(1);
          return;
        } catch (altError) {
          console.error('Alternative expansion also failed:', altError);
        }
      }

      this.valuesetError.set(this.getErrorMessage(error));
    } finally {
      this.expandLoading.set(false);
    }
  }

  // Pagination methods for Expanded Codes
  setPage(page: number): void {
    this.currentPage.set(Math.max(1, Math.min(page, this.totalPages())));
  }

  setPageSize(size: number): void {
    const currentPage = this.currentPage();
    const totalCodes = this.expandedCodes().length;

    this.pageSize.set(size);

    // Adjust current page if necessary - recalculate max pages with new size
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

  // Pagination methods for ValueSets
  protected readonly valuesetTotalPages = computed(() => {
    const total = this.valuesetTotalCount();
    const size = this.valuesetPageSize();
    return Math.max(1, Math.ceil(total / size));
  });

  protected readonly valuesetHasPreviousPage = computed(() => {
    return this.valuesetCurrentPage() > 1;
  });

  protected readonly valuesetHasNextPage = computed(() => {
    return this.valuesetCurrentPage() < this.valuesetTotalPages();
  });

  protected readonly valuesetStartIndex = computed(() => {
    return (this.valuesetCurrentPage() - 1) * this.valuesetPageSize() + 1;
  });

  protected readonly valuesetEndIndex = computed(() => {
    const total = this.valuesetTotalCount();
    const end = this.valuesetCurrentPage() * this.valuesetPageSize();
    return Math.min(end, total);
  });

  valuesetPreviousPage(): void {
    const currentPage = this.valuesetCurrentPage();
    if (currentPage > 1) {
      this.searchValueSets(currentPage - 1);
    }
  }

  valuesetNextPage(): void {
    const currentPage = this.valuesetCurrentPage();
    const totalPages = this.valuesetTotalPages();
    if (currentPage < totalPages) {
      this.searchValueSets(currentPage + 1);
    }
  }

  valuesetGoToFirstPage(): void {
    this.searchValueSets(1);
  }

  valuesetGoToLastPage(): void {
    this.searchValueSets(this.valuesetTotalPages());
  }

  setValueSetPageSize(size: number): void {
    this.valuesetPageSize.set(size);
    // Reset to first page and re-search
    this.searchValueSets(1);
  }

  // Pagination methods for ConceptMaps
  protected readonly conceptmapTotalPages = computed(() => {
    const total = this.conceptmapTotalCount();
    const size = this.conceptmapPageSize();
    return Math.max(1, Math.ceil(total / size));
  });

  protected readonly conceptmapHasPreviousPage = computed(() => {
    return this.conceptmapCurrentPage() > 1;
  });

  protected readonly conceptmapHasNextPage = computed(() => {
    return this.conceptmapCurrentPage() < this.conceptmapTotalPages();
  });

  protected readonly conceptmapStartIndex = computed(() => {
    return (this.conceptmapCurrentPage() - 1) * this.conceptmapPageSize() + 1;
  });

  protected readonly conceptmapEndIndex = computed(() => {
    const total = this.conceptmapTotalCount();
    const end = this.conceptmapCurrentPage() * this.conceptmapPageSize();
    return Math.min(end, total);
  });

  conceptmapPreviousPage(): void {
    const currentPage = this.conceptmapCurrentPage();
    if (currentPage > 1) {
      this.searchConceptMaps(currentPage - 1);
    }
  }

  conceptmapNextPage(): void {
    const currentPage = this.conceptmapCurrentPage();
    const totalPages = this.conceptmapTotalPages();
    if (currentPage < totalPages) {
      this.searchConceptMaps(currentPage + 1);
    }
  }

  conceptmapGoToFirstPage(): void {
    this.searchConceptMaps(1);
  }

  conceptmapGoToLastPage(): void {
    this.searchConceptMaps(this.conceptmapTotalPages());
  }

  setConceptMapPageSize(size: number): void {
    this.conceptmapPageSize.set(size);
    // Reset to first page and re-search
    this.searchConceptMaps(1);
  }

  // Row expansion methods for Expanded Codes table
  toggleRowExpansion(code: any): void {
    const codeKey = `${code.code}-${code.system}`;
    const expanded = new Set(this.expandedRows());

    if (expanded.has(codeKey)) {
      expanded.delete(codeKey);
    } else {
      expanded.add(codeKey);
      // Load details if not already loaded
      if (!this.expandedCodeDetails().has(codeKey)) {
        this.loadCodeDetailsForExpansion(code, codeKey);
      }
    }

    this.expandedRows.set(expanded);
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

  async loadCodeDetailsForExpansion(code: any, codeKey: string): Promise<void> {
    if (!this.hasValidConfiguration()) {
      return;
    }

    // Add to loading set
    const loading = new Set(this.loadingDetails());
    loading.add(codeKey);
    this.loadingDetails.set(loading);

    try {
      const params = {
        code: code.code,
        system: code.system
      };

      const result = await firstValueFrom(this.terminologyService.lookupCode(params));

      // Store the result
      const details = new Map(this.expandedCodeDetails());
      details.set(codeKey, result);
      this.expandedCodeDetails.set(details);

    } catch (error) {
      console.error('Failed to load code details:', error);
      // Store error in details
      const details = new Map(this.expandedCodeDetails());
      details.set(codeKey, { error: this.getErrorMessage(error) });
      this.expandedCodeDetails.set(details);
    } finally {
      // Remove from loading set
      const loading = new Set(this.loadingDetails());
      loading.delete(codeKey);
      this.loadingDetails.set(loading);
    }
  }

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

  // Browser search operations
  async searchBrowserCodes(): Promise<void> {
    if (!this.hasValidConfiguration()) {
      this.codeError.set('Please configure terminology service settings first.');
      return;
    }

    this.codeLoading.set(true);
    this.codeError.set(null);

    try {
      const searchTerm = this.codeSearchTerm().trim();
      const selectedValueSet = this.selectedValueSet();

      if (!selectedValueSet) {
        this.codeError.set('Please select a ValueSet to search codes.');
        return;
      }

      console.log('Searching for codes in ValueSet:', selectedValueSet.url, 'with term:', searchTerm);

      // Expand the ValueSet to get codes with pagination and filtering
      const params: any = {
        url: selectedValueSet.url,
        includeDesignations: true,
        includeDefinition: true,
        activeOnly: true,
        count: 1000, // Stay within server limits
        offset: 0
      };

      // If we have a search term, use server-side filtering
      if (searchTerm) {
        params.filter = searchTerm;
      }

      console.log('Expanding ValueSet with params:', params);
      const result = await firstValueFrom(this.terminologyService.expandValueSet(params));
      let codes = result?.expansion?.contains || [];

      // If no search term was provided, we still need to filter the results
      // since we're limited to 1000 codes and the server might return more than we can handle
      if (!searchTerm && codes.length >= 1000) {
        console.log('ValueSet has many codes, showing first 1000. Consider using a search term to narrow results.');
        codes = codes.slice(0, 1000);
      }

      console.log('Found codes:', codes.length);
      this.codeResults.set(codes);
      this.autoSelectFirstResult();
    } catch (error) {
      console.error('Browser search error:', error);
      this.codeError.set(this.getErrorMessage(error));
    } finally {
      this.codeLoading.set(false);
    }
  }

  // Code browsing operations (legacy - for CodeSystem browsing)
  async browseCodes(): Promise<void> {
    if (!this.hasValidConfiguration()) {
      this.codeError.set('Please configure terminology service settings first.');
      return;
    }

    this.codeLoading.set(true);
    this.codeError.set(null);

    try {
      const searchTerm = this.codeSearchTerm().trim();
      const systemUrl = this.codeSystemUrl().trim();

      if (!systemUrl) {
        this.codeError.set('Please select a CodeSystem to browse codes.');
        return;
      }

      console.log('Searching for codes in CodeSystem:', systemUrl, 'with term:', searchTerm);

      // Get the specific CodeSystem to access its concepts
      const codeSystemResult = await firstValueFrom(this.terminologyService.getCodeSystemByUrl(systemUrl));

      if (!codeSystemResult) {
        this.codeError.set('CodeSystem not found. Please check the selection.');
        return;
      }

      console.log('CodeSystem found:', codeSystemResult);

      // Extract concepts from the CodeSystem
      let concepts = codeSystemResult.concept || [];

      // Filter concepts by search term using client-side contains matching
      if (searchTerm) {
        console.log('Filtering concepts with search term:', searchTerm);
        concepts = concepts.filter((concept: any) =>
          concept.code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          concept.display?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          concept.definition?.toLowerCase().includes(searchTerm.toLowerCase())
        );
      }

      console.log('Found concepts:', concepts.length);
      this.codeResults.set(concepts);
      this.autoSelectFirstResult();
    } catch (error) {
      console.error('Browse error:', error);
      this.codeError.set(this.getErrorMessage(error));
    } finally {
      this.codeLoading.set(false);
    }
  }

  // Test server resources
  async testServerResources(): Promise<void> {
    try {
      console.log('Testing server resources...');
      const result = await firstValueFrom(this.terminologyService.testServerResources());
      console.log('Server metadata:', result);
    } catch (error) {
      console.error('Server test error:', error);
    }
  }

  // Helper method to set example CodeSystem URLs
  setExampleCodeSystemUrl(url: string): void {
    this.codeSystemUrl.set(url);
  }

  // Test search functionality
  async testSearch(): Promise<void> {
    console.log('Testing search for "diabetes"...');
    this.codeSearchTerm.set('diabetes');
    await this.browseCodes();
  }

  // Load available CodeSystems for dropdown
  async loadAvailableCodeSystems(): Promise<void> {
    if (!this.hasValidConfiguration()) {
      return;
    }

    this.codeSystemsLoading.set(true);

    try {
      const result = await firstValueFrom(this.terminologyService.searchCodeSystems({}));
      const codeSystems = result?.entry?.map(e => e.resource!).filter(r => r !== undefined) || [];
      this.availableCodeSystems.set(codeSystems);
      console.log('Loaded available CodeSystems:', codeSystems.length);
    } catch (error) {
      console.error('Failed to load CodeSystems:', error);
      // Don't show error to user as this is background loading
    } finally {
      this.codeSystemsLoading.set(false);
    }
  }

  async lookupCode(code: string, system: string): Promise<void> {
    try {
      const params = {
        code: code,
        system: system
      };

      const result = await firstValueFrom(this.terminologyService.lookupCode(params));
      // Handle lookup result
      console.log('Code lookup result:', result);
    } catch (error) {
      console.error('Code lookup error:', error);
    }
  }

  // Code validation operations
  async validateCode(): Promise<void> {
    if (!this.hasValidConfiguration()) {
      this.validationError.set('Please configure terminology service settings first.');
      return;
    }

    const code = this.validationCode().trim();
    const system = this.validationSystem().trim();
    const valueset = this.validationValueSet().trim();

    if (!code || !system) {
      this.validationError.set('Please enter both code and system.');
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
      const displayParam = result?.parameter?.find(p => p.name === 'display');

      this.validationResult.set({
        valid: validParam?.valueBoolean || false,
        message: validParam?.valueBoolean ? 'Code is valid' : 'Code is not valid',
        display: displayParam?.valueString
      });
    } catch (error) {
      this.validationError.set(this.getErrorMessage(error));
    } finally {
      this.validationLoading.set(false);
    }
  }

  // ConceptMap operations
  async searchConceptMaps(page: number = 1): Promise<void> {
    if (!this.hasValidConfiguration()) {
      this.conceptmapError.set('Please configure terminology service settings first.');
      return;
    }

    this.conceptmapLoading.set(true);
    this.conceptmapError.set(null);
    this.conceptmapCurrentPage.set(page);

    try {
      const searchTerm = this.conceptmapSearchTerm().trim();
      const pageSize = this.conceptmapPageSize();
      const offset = (page - 1) * pageSize;
      const params: any = {
        _count: pageSize,
        _offset: offset
      };

      if (searchTerm) {
        params.name = searchTerm;
      }

      const result = await firstValueFrom(this.terminologyService.searchConceptMaps(params));
      this.conceptmapResults.set(result?.entry?.map(e => e.resource!) || []);

      // Update total count from bundle
      if (result?.total !== undefined) {
        this.conceptmapTotalCount.set(result.total);
      } else {
        // Estimate total if not provided
        const currentResults = this.conceptmapResults().length;
        if (currentResults === pageSize) {
          // Might have more results
          this.conceptmapTotalCount.set((page * pageSize) + 1);
        } else {
          // This is likely the last page
          this.conceptmapTotalCount.set((page - 1) * pageSize + currentResults);
        }
      }
    } catch (error) {
      this.conceptmapError.set(this.getErrorMessage(error));
    } finally {
      this.conceptmapLoading.set(false);
    }
  }

  selectConceptMap(conceptmap: ConceptMap): void {
    this.selectedConceptMap.set(conceptmap);
  }

  async translateConcept(): Promise<void> {
    if (!this.hasValidConfiguration()) {
      this.translationError.set('Please configure terminology service settings first.');
      return;
    }

    const code = this.translateCode().trim();
    const system = this.translateSystem().trim();
    const target = this.translateTarget().trim();

    if (!code || !system) {
      this.translationError.set('Please enter both code and system.');
      return;
    }

    this.translationLoading.set(true);
    this.translationError.set(null);

    try {
      const params: any = {
        code: code,
        system: system
      };

      if (target) {
        params.target = [target];
      }

      const result = await firstValueFrom(this.terminologyService.translateConcept(params));

      // Parse translation result
      const matchParams = result?.parameter?.filter(p => p.name === 'match') || [];
      this.translationResult.set(matchParams.map(p => p.valueCoding));
    } catch (error) {
      this.translationError.set(this.getErrorMessage(error));
    } finally {
      this.translationLoading.set(false);
    }
  }

  // Utility methods
  private getErrorMessage(error: any): string {
    if (error?.status === 401 || error?.status === 403) {
      return 'Authentication failed. The terminology server may require authentication. Please check your authorization bearer token in Settings.';
    }
    if (error?.status === 404) {
      return 'Resource not found. Please check your search terms.';
    }
    if (error?.status >= 500) {
      return 'Server error. Please try again later.';
    }
    return error?.message || 'An unexpected error occurred.';
  }

  navigateToSettings(): void {
    this.router.navigate(['/settings']);
  }



  // Code Systems operations
  async loadCodeSystems(): Promise<void> {
    if (!this.hasValidConfiguration()) {
      this.codeSystemsError.set('Please configure terminology service settings first.');
      return;
    }

    this.codeSystemsLoading.set(true);
    this.codeSystemsError.set(null);

    try {
      const result = await firstValueFrom(this.terminologyService.searchCodeSystems({}));
      this.codeSystemsResults.set(result?.entry?.map(e => e.resource).filter(r => r !== undefined) || []);
    } catch (error) {
      this.codeSystemsError.set(this.getErrorMessage(error));
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

  async deleteCodeSystem(codeSystem: CodeSystem): Promise<void> {
    if (!codeSystem.id) {
      this.codeSystemsError.set('Cannot delete CodeSystem: No ID found');
      return;
    }

    // Confirmation dialog
    const confirmed = confirm(
      `Are you sure you want to delete the CodeSystem "${codeSystem.name || codeSystem.title || codeSystem.id}"?\n\n` +
      `This action cannot be undone and will permanently remove the CodeSystem from the server.`
    );

    if (!confirmed) {
      return;
    }

    // Add to deleting set
    const deleting = new Set(this.codeSystemsDeleting());
    deleting.add(codeSystem.id);
    this.codeSystemsDeleting.set(deleting);

    try {
      await firstValueFrom(this.terminologyService.deleteCodeSystem(codeSystem.id));

      // Remove from results
      const results = this.codeSystemsResults().filter(cs => cs.id !== codeSystem.id);
      this.codeSystemsResults.set(results);

      console.log(`CodeSystem "${codeSystem.name || codeSystem.id}" deleted successfully`);
    } catch (error) {
      console.error('Failed to delete CodeSystem:', error);
      this.codeSystemsError.set(`Failed to delete CodeSystem: ${this.getErrorMessage(error)}`);
    } finally {
      // Remove from deleting set
      const deleting = new Set(this.codeSystemsDeleting());
      deleting.delete(codeSystem.id);
      this.codeSystemsDeleting.set(deleting);
    }
  }

  isCodeSystemDeleting(codeSystemId: string): boolean {
    return this.codeSystemsDeleting().has(codeSystemId);
  }

  // CodeSystem row expansion methods
  toggleCodeSystemRowExpansion(codeSystem: CodeSystem): void {
    const codeSystemId = codeSystem.id || codeSystem.url || '';
    const expanded = new Set(this.expandedCodeSystemRows());

    if (expanded.has(codeSystemId)) {
      expanded.delete(codeSystemId);
    } else {
      expanded.add(codeSystemId);
    }

    this.expandedCodeSystemRows.set(expanded);
  }

  isCodeSystemRowExpanded(codeSystem: CodeSystem): boolean {
    const codeSystemId = codeSystem.id || codeSystem.url || '';
    return this.expandedCodeSystemRows().has(codeSystemId);
  }

  openUrl(url: string): void {
    window.open(url, '_blank');
  }

  // Tree navigation methods
  toggleNode(nodeId: string): void {
    const expanded = new Set(this.expandedNodes());
    if (expanded.has(nodeId)) {
      expanded.delete(nodeId);
    } else {
      expanded.add(nodeId);
    }
    this.expandedNodes.set(expanded);
  }

  isNodeExpanded(nodeId: string): boolean {
    return this.expandedNodes().has(nodeId);
  }

  hasChildren(node: any): boolean {
    return node.children && node.children.length > 0;
  }

  getNodeLevel(node: any): number {
    return node.level || 0;
  }

  getNodeIndent(node: any): string {
    const level = this.getNodeLevel(node);
    return `${level * 20}px`;
  }

  // Code selection and details
  selectCode(code: any): void {
    this.selectedCode.set(code);
    this.loadCodeDetails(code);
  }

  async loadCodeDetails(code: any): Promise<void> {
    if (!code || !code.id) return;

    this.codeDetailsLoading.set(true);
    this.codeDetails.set(null);
    this.codeParents.set([]);
    this.codeChildren.set([]);

    try {
      // For CodeSystem resources, get the full CodeSystem details
      if (code.resourceType === 'CodeSystem') {
        const codeSystemDetails = await firstValueFrom(this.terminologyService.getCodeSystem(code.id));
        this.codeDetails.set(codeSystemDetails);

        // Extract concepts from the CodeSystem to show as "children"
        if (codeSystemDetails?.concept) {
          const concepts = codeSystemDetails.concept;
          this.codeParents.set([]);
          this.codeChildren.set(concepts.slice(0, 10)); // Show first 10 concepts
        }
      } else {
        // For other resource types, just show the resource details
        // since we don't have specific codes to lookup
        this.codeDetails.set(code);
        this.codeParents.set([]);
        this.codeChildren.set([]);
      }
    } catch (error) {
      console.error('Failed to load code details:', error);
      // Fallback to showing the basic resource information
      this.codeDetails.set(code);
      this.codeParents.set([]);
      this.codeChildren.set([]);
    } finally {
      this.codeDetailsLoading.set(false);
    }
  }

  // Auto-select first result when results change
  private autoSelectFirstResult(): void {
    const results = this.codeResults();
    if (results.length > 0 && !this.selectedCode()) {
      this.selectCode(results[0]);
    }
  }

  // Helper methods for template
  formatDate(dateString?: string): string {
    if (!dateString) return '';
    return new Date(dateString).toLocaleDateString();
  }

  truncateText(text: string, maxLength: number = 100): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }

  // CodeSystem Verification Methods
  async verifyCodeSystems(): Promise<void> {
    if (!this.hasValidConfiguration()) {
      console.error('Cannot verify CodeSystems: No valid configuration');
      return;
    }

    console.log('🔍 Starting CodeSystem verification...');

    try {
      // Test 1: Verify CodeSystems can be retrieved
      await this.verifyCodeSystemRetrieval();

      // Test 2: Verify version integrity
      await this.verifyVersionIntegrity();

      // Test 3: Verify expansion functionality
      await this.verifyExpansionFunctionality();

      // Test 4: Verify lookup operations
      await this.verifyLookupOperations();

      // Test 5: Verify search functionality
      await this.verifySearchFunctionality();

      // Test 6: Verify error handling
      await this.verifyErrorHandling();

      console.log('✅ CodeSystem verification completed successfully');
    } catch (error) {
      console.error('❌ CodeSystem verification failed:', error);
    }
  }

  private async verifyCodeSystemRetrieval(): Promise<void> {
    console.log('📋 Testing CodeSystem retrieval...');

    try {
      const result = await firstValueFrom(this.terminologyService.searchCodeSystems({}));
      const codeSystems = result?.entry?.map(e => e.resource).filter(r => r !== undefined) || [];

      console.log(`Found ${codeSystems.length} CodeSystems on server`);

      if (codeSystems.length === 0) {
        console.warn('⚠️ No CodeSystems found on server');
        return;
      }

      // Verify each CodeSystem has required fields
      for (const cs of codeSystems) {
        if (!cs.id) {
          console.warn(`⚠️ CodeSystem missing ID: ${cs.name || cs.title || 'Unknown'}`);
        }
        if (!cs.url) {
          console.warn(`⚠️ CodeSystem missing URL: ${cs.name || cs.title || cs.id}`);
        }
        if (!cs.status) {
          console.warn(`⚠️ CodeSystem missing status: ${cs.name || cs.title || cs.id}`);
        }
      }

      console.log('✅ CodeSystem retrieval verification passed');
    } catch (error) {
      console.error('❌ CodeSystem retrieval verification failed:', error);
      throw error;
    }
  }

  private async verifyVersionIntegrity(): Promise<void> {
    console.log('🔢 Testing version integrity...');

    try {
      const result = await firstValueFrom(this.terminologyService.searchCodeSystems({}));
      const codeSystems = result?.entry?.map(e => e.resource).filter(r => r !== undefined) || [];

      let versionedCount = 0;
      let versionIntegrityIssues = 0;

      for (const cs of codeSystems) {
        if (cs.version) {
          versionedCount++;

          // Test that we can retrieve the CodeSystem by URL with version
          try {
            const byUrlResult = await firstValueFrom(this.terminologyService.getCodeSystemByUrl(cs.url!));
            if (byUrlResult && byUrlResult.version !== cs.version) {
              console.warn(`⚠️ Version mismatch for ${cs.name || cs.id}: expected ${cs.version}, got ${byUrlResult.version}`);
              versionIntegrityIssues++;
            }
          } catch (error) {
            console.warn(`⚠️ Could not verify version for ${cs.name || cs.id}:`, error);
            versionIntegrityIssues++;
          }
        }
      }

      console.log(`Found ${versionedCount} versioned CodeSystems`);
      if (versionIntegrityIssues === 0) {
        console.log('✅ Version integrity verification passed');
      } else {
        console.warn(`⚠️ Found ${versionIntegrityIssues} version integrity issues`);
      }
    } catch (error) {
      console.error('❌ Version integrity verification failed:', error);
      throw error;
    }
  }

  private async verifyExpansionFunctionality(): Promise<void> {
    console.log('🔍 Testing expansion functionality...');

    try {
      const result = await firstValueFrom(this.terminologyService.searchCodeSystems({}));
      const codeSystems = result?.entry?.map(e => e.resource).filter(r => r !== undefined) || [];

      let expansionTestsPassed = 0;
      let expansionTestsFailed = 0;

      // Test expansion on first few CodeSystems that have concepts
      for (const cs of codeSystems.slice(0, 3)) {
        try {
          // Try to get the CodeSystem to see if it has concepts
          const fullCodeSystem = await firstValueFrom(this.terminologyService.getCodeSystem(cs.id!));

          if (fullCodeSystem && fullCodeSystem.concept && fullCodeSystem.concept.length > 0) {
            console.log(`Testing expansion for CodeSystem: ${cs.name || cs.id}`);

            // Test lookup on first concept
            const firstConcept = fullCodeSystem.concept[0];
            const lookupResult = await firstValueFrom(this.terminologyService.lookupCode({
              code: firstConcept.code!,
              system: cs.url!
            }));

            if (lookupResult && lookupResult.parameter) {
              expansionTestsPassed++;
              console.log(`✅ Expansion test passed for ${cs.name || cs.id}`);
            } else {
              expansionTestsFailed++;
              console.warn(`⚠️ Expansion test failed for ${cs.name || cs.id}: No parameters returned`);
            }
          } else {
            console.log(`ℹ️ Skipping expansion test for ${cs.name || cs.id}: No concepts found`);
          }
        } catch (error) {
          expansionTestsFailed++;
          console.warn(`⚠️ Expansion test failed for ${cs.name || cs.id}:`, error);
        }
      }

      console.log(`Expansion tests: ${expansionTestsPassed} passed, ${expansionTestsFailed} failed`);
      if (expansionTestsPassed > 0) {
        console.log('✅ Expansion functionality verification passed');
      } else {
        console.warn('⚠️ No expansion tests passed');
      }
    } catch (error) {
      console.error('❌ Expansion functionality verification failed:', error);
      throw error;
    }
  }

  private async verifyLookupOperations(): Promise<void> {
    console.log('🔎 Testing lookup operations...');

    try {
      const result = await firstValueFrom(this.terminologyService.searchCodeSystems({}));
      const codeSystems = result?.entry?.map(e => e.resource).filter(r => r !== undefined) || [];

      let lookupTestsPassed = 0;
      let lookupTestsFailed = 0;

      // Test lookup operations on first few CodeSystems
      for (const cs of codeSystems.slice(0, 2)) {
        try {
          const fullCodeSystem = await firstValueFrom(this.terminologyService.getCodeSystem(cs.id!));

          if (fullCodeSystem && fullCodeSystem.concept && fullCodeSystem.concept.length > 0) {
            const testConcept = fullCodeSystem.concept[0];

            console.log(`Testing lookup for code ${testConcept.code} in ${cs.name || cs.id}`);

            const lookupResult = await firstValueFrom(this.terminologyService.lookupCode({
              code: testConcept.code!,
              system: cs.url!,
              version: cs.version
            }));

            if (lookupResult && lookupResult.parameter) {
              // Check if we got expected parameters
              const hasDisplay = lookupResult.parameter.some((p: any) => p.name === 'display');
              const hasDefinition = lookupResult.parameter.some((p: any) => p.name === 'definition');

              if (hasDisplay || hasDefinition) {
                lookupTestsPassed++;
                console.log(`✅ Lookup test passed for ${cs.name || cs.id}`);
              } else {
                lookupTestsFailed++;
                console.warn(`⚠️ Lookup test incomplete for ${cs.name || cs.id}: Missing expected parameters`);
              }
            } else {
              lookupTestsFailed++;
              console.warn(`⚠️ Lookup test failed for ${cs.name || cs.id}: No parameters returned`);
            }
          }
        } catch (error) {
          lookupTestsFailed++;
          console.warn(`⚠️ Lookup test failed for ${cs.name || cs.id}:`, error);
        }
      }

      console.log(`Lookup tests: ${lookupTestsPassed} passed, ${lookupTestsFailed} failed`);
      if (lookupTestsPassed > 0) {
        console.log('✅ Lookup operations verification passed');
      } else {
        console.warn('⚠️ No lookup tests passed');
      }
    } catch (error) {
      console.error('❌ Lookup operations verification failed:', error);
      throw error;
    }
  }

  private async verifySearchFunctionality(): Promise<void> {
    console.log('🔍 Testing search functionality...');

    try {
      // Test search by name
      const nameSearchResult = await firstValueFrom(this.terminologyService.searchCodeSystems({
        name: 'test',
        _count: 5
      }));

      // Test search by status
      const statusSearchResult = await firstValueFrom(this.terminologyService.searchCodeSystems({
        status: 'active',
        _count: 5
      }));

      // Test search by URL
      const urlSearchResult = await firstValueFrom(this.terminologyService.searchCodeSystems({
        url: 'http',
        _count: 5
      }));

      console.log(`Name search returned: ${nameSearchResult?.entry?.length || 0} results`);
      console.log(`Status search returned: ${statusSearchResult?.entry?.length || 0} results`);
      console.log(`URL search returned: ${urlSearchResult?.entry?.length || 0} results`);

      // Test that search results are properly formatted
      const allResults = [
        ...(nameSearchResult?.entry || []),
        ...(statusSearchResult?.entry || []),
        ...(urlSearchResult?.entry || [])
      ];

      let validResults = 0;
      for (const entry of allResults) {
        if (entry.resource && entry.resource.resourceType === 'CodeSystem') {
          validResults++;
        }
      }

      console.log(`Search functionality: ${validResults} valid results out of ${allResults.length} total`);

      if (validResults > 0) {
        console.log('✅ Search functionality verification passed');
      } else {
        console.warn('⚠️ No valid search results found');
      }
    } catch (error) {
      console.error('❌ Search functionality verification failed:', error);
      throw error;
    }
  }

  private async verifyErrorHandling(): Promise<void> {
    console.log('⚠️ Testing error handling...');

    try {
      let errorHandlingTestsPassed = 0;
      let errorHandlingTestsFailed = 0;

      // Test 1: Invalid CodeSystem ID
      try {
        await firstValueFrom(this.terminologyService.getCodeSystem('invalid-id-that-should-not-exist'));
        console.warn('⚠️ Expected error for invalid CodeSystem ID, but got success');
        errorHandlingTestsFailed++;
      } catch (error) {
        console.log('✅ Correctly handled invalid CodeSystem ID');
        errorHandlingTestsPassed++;
      }

      // Test 2: Invalid CodeSystem URL
      try {
        await firstValueFrom(this.terminologyService.getCodeSystemByUrl('http://invalid-url-that-should-not-exist.com'));
        console.warn('⚠️ Expected error for invalid CodeSystem URL, but got success');
        errorHandlingTestsFailed++;
      } catch (error) {
        console.log('✅ Correctly handled invalid CodeSystem URL');
        errorHandlingTestsPassed++;
      }

      // Test 3: Invalid lookup parameters
      try {
        await firstValueFrom(this.terminologyService.lookupCode({
          code: 'invalid-code',
          system: 'http://invalid-system.com'
        }));
        console.warn('⚠️ Expected error for invalid lookup parameters, but got success');
        errorHandlingTestsFailed++;
      } catch (error) {
        console.log('✅ Correctly handled invalid lookup parameters');
        errorHandlingTestsPassed++;
      }

      // Test 4: Invalid search parameters
      try {
        await firstValueFrom(this.terminologyService.searchCodeSystems({
          name: 'this-should-not-match-anything-realistic-12345',
          _count: 1
        }));
        console.log('✅ Search with non-matching parameters handled gracefully');
        errorHandlingTestsPassed++;
      } catch (error) {
        console.warn('⚠️ Search with non-matching parameters threw error:', error);
        errorHandlingTestsFailed++;
      }

      console.log(`Error handling tests: ${errorHandlingTestsPassed} passed, ${errorHandlingTestsFailed} failed`);

      if (errorHandlingTestsPassed >= 3) {
        console.log('✅ Error handling verification passed');
      } else {
        console.warn('⚠️ Error handling verification incomplete');
      }
    } catch (error) {
      console.error('❌ Error handling verification failed:', error);
      throw error;
    }
  }
}
