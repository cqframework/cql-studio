// Author: Preston Lee

import { Component, Input, Output, EventEmitter, OnInit, signal, computed } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Patient, Parameters, Bundle, Library } from 'fhir/r4';
import { PatientService } from '../../../services/patient.service';
import { LibraryService } from '../../../services/library.service';
import { SettingsService } from '../../../services/settings.service';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

export interface TestResult {
  patientId: string;
  patientName: string;
  result: any;
  error?: any;
  executionTime: number;
}

@Component({
  selector: 'app-guideline-testing',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe],
  templateUrl: './guideline-testing.component.html',
  styleUrl: './guideline-testing.component.scss'
})
export class GuidelineTestingComponent implements OnInit {
  @Input() library!: Library;
  @Output() close = new EventEmitter<void>();

  protected readonly selectedPatients = signal<Patient[]>([]);
  protected readonly patients = signal<Patient[]>([]);
  protected readonly isLoadingPatients = signal<boolean>(false);
  protected readonly isExecuting = signal<boolean>(false);
  protected readonly testResults = signal<TestResult[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly searchTerm = signal<string>('');
  protected readonly expandedAccordions = signal<Set<string>>(new Set());
  
  // Pagination
  protected readonly currentPage = signal<number>(1);
  protected readonly pageSize = signal<number>(20);

  constructor(
    private patientService: PatientService,
    private libraryService: LibraryService,
    public settingsService: SettingsService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.loadPatients();
  }

  loadPatients(): void {
    this.isLoadingPatients.set(true);
    // Load all patients from FHIR server
    this.patientService.search('').subscribe({
      next: (bundle: Bundle<Patient>) => {
        this.isLoadingPatients.set(false);
        const loadedPatients = bundle.entry 
          ? bundle.entry.map(entry => entry.resource!).filter((r): r is Patient => r !== undefined)
          : [];
        this.patients.set(loadedPatients);
        this.currentPage.set(1); // Reset to first page when loading new patients
      },
      error: (error: any) => {
        this.isLoadingPatients.set(false);
        this.error.set(`Failed to load patients: ${error.message || 'Unknown error'}`);
        console.error('Error loading patients:', error);
      }
    });
  }

  onSearch(): void {
    if (this.searchTerm().trim()) {
      this.isLoadingPatients.set(true);
      this.patientService.search(this.searchTerm()).subscribe({
        next: (bundle: Bundle<Patient>) => {
          this.isLoadingPatients.set(false);
          const loadedPatients = bundle.entry 
            ? bundle.entry.map(entry => entry.resource!).filter((r): r is Patient => r !== undefined)
            : [];
          this.patients.set(loadedPatients);
          this.currentPage.set(1); // Reset to first page when searching
        },
        error: (error: any) => {
          this.isLoadingPatients.set(false);
          this.error.set(`Failed to search patients: ${error.message || 'Unknown error'}`);
          console.error('Error searching patients:', error);
        }
      });
    } else {
      this.loadPatients();
    }
  }

  togglePatient(patient: Patient): void {
    const current = this.selectedPatients();
    const index = current.findIndex(p => p.id === patient.id);
    
    if (index >= 0) {
      // Remove patient
      this.selectedPatients.set(current.filter((_, i) => i !== index));
    } else {
      // Add patient
      this.selectedPatients.set([...current, patient]);
    }
  }

  isPatientSelected(patient: Patient): boolean {
    return this.selectedPatients().some(p => p.id === patient.id);
  }

  onExecute(): void {
    const selected = this.selectedPatients();
    if (selected.length === 0) {
      this.error.set('Please select at least one patient to test');
      return;
    }

    this.isExecuting.set(true);
    this.error.set(null);
    this.testResults.set([]);

    // Execute library for each selected patient
    const libraryId = this.library?.id;
    if (!libraryId) {
      this.error.set('Library ID is missing');
      this.isExecuting.set(false);
      return;
    }

    const executions = selected.map(patient => {
      const parameters: Parameters = {
        resourceType: 'Parameters',
        parameter: [
          {
            name: 'subject',
            valueString: `Patient/${patient.id}`
          }
        ]
      };

      const startTime = Date.now();
      
      return this.libraryService.evaluate(libraryId, parameters).pipe(
        catchError((error: any) => {
          // Return error as result instead of throwing
          return of({
            patientId: patient.id || '',
            patientName: this.getPatientName(patient),
            result: null,
            error: error,
            executionTime: Date.now() - startTime
          } as TestResult);
        })
      );
    });

    // Execute all in parallel using forkJoin
    forkJoin(executions).subscribe({
      next: (responses: any[]) => {
        const results: TestResult[] = responses.map((response, index) => {
          const patient = selected[index];
          
          // If response is already a TestResult (from error handling), return it
          if (response.patientId) {
            return response;
          }
          
          // Otherwise, create result from successful response
          const startTime = Date.now();
          return {
            patientId: patient.id || '',
            patientName: this.getPatientName(patient),
            result: response,
            executionTime: Date.now() - startTime
          };
        });
        
        this.testResults.set(results);
        // Expand all accordions by default
        const allPatientIds = new Set(results.map(r => r.patientId));
        this.expandedAccordions.set(allPatientIds);
        this.isExecuting.set(false);
      },
      error: (error: any) => {
        this.error.set(`Execution failed: ${error.message || 'Unknown error'}`);
        this.isExecuting.set(false);
      }
    });
  }

  getPatientName(patient: Patient): string {
    if (patient.name && patient.name.length > 0) {
      const name = patient.name[0];
      const parts: string[] = [];
      if (name.family) parts.push(name.family);
      if (name.given) parts.push(...name.given);
      return parts.join(' ') || `Patient ${patient.id}`;
    }
    return `Patient ${patient.id || 'Unknown'}`;
  }

  getResultValue(result: any, key: string): any {
    if (!result || !result.parameter) {
      return null;
    }
    const param = result.parameter.find((p: any) => p.name === key);
    return param?.valueBoolean ?? param?.valueString ?? param?.value ?? null;
  }

  formatResultValue(value: any): string {
    if (value === null || value === undefined) {
      return 'No Value';
    }
    if (typeof value === 'boolean') {
      return value ? 'Yes' : 'No';
    }
    return String(value);
  }

  onClose(): void {
    // Navigate back to editor route
    if (this.library?.id) {
      this.router.navigate(['/guidelines', this.library.id]);
    } else {
      this.close.emit();
    }
  }

  onBackToBrowser(): void {
    this.router.navigate(['/guidelines']);
  }

  onClearSelection(): void {
    this.selectedPatients.set([]);
  }

  stringify(obj: any): string {
    return JSON.stringify(obj, null, 2);
  }

  toggleAccordion(patientId: string): void {
    const expanded = new Set(this.expandedAccordions());
    if (expanded.has(patientId)) {
      expanded.delete(patientId);
    } else {
      expanded.add(patientId);
    }
    this.expandedAccordions.set(expanded);
  }

  isAccordionExpanded(patientId: string): boolean {
    return this.expandedAccordions().has(patientId);
  }

  protected readonly allExpanded = computed(() => {
    const results = this.testResults();
    const expanded = this.expandedAccordions();
    return results.length > 0 && results.every(r => expanded.has(r.patientId));
  });

  toggleAllAccordions(): void {
    const results = this.testResults();
    const expanded = this.expandedAccordions();
    const allCurrentlyExpanded = results.length > 0 && results.every(r => expanded.has(r.patientId));
    
    if (allCurrentlyExpanded) {
      // Collapse all
      this.expandedAccordions.set(new Set());
    } else {
      // Expand all
      const allPatientIds = new Set(results.map(r => r.patientId));
      this.expandedAccordions.set(allPatientIds);
    }
  }

  // Pagination computed properties
  protected readonly paginatedPatients = computed(() => {
    const allPatients = this.patients();
    const size = this.pageSize();
    const page = this.currentPage();
    const startIndex = (page - 1) * size;
    const endIndex = startIndex + size;
    return allPatients.slice(startIndex, endIndex);
  });

  protected readonly totalPages = computed(() => {
    const total = this.patients().length;
    const size = this.pageSize();
    return Math.max(1, Math.ceil(total / size));
  });

  protected readonly startIndex = computed(() => {
    const page = this.currentPage();
    const size = this.pageSize();
    return (page - 1) * size + 1;
  });

  protected readonly endIndex = computed(() => {
    const total = this.patients().length;
    const page = this.currentPage();
    const size = this.pageSize();
    const end = page * size;
    return Math.min(end, total);
  });

  // Pagination methods
  goToPage(page: number): void {
    const total = this.totalPages();
    if (page >= 1 && page <= total) {
      this.currentPage.set(page);
    }
  }

  previousPage(): void {
    const current = this.currentPage();
    if (current > 1) {
      this.currentPage.set(current - 1);
    }
  }

  nextPage(): void {
    const current = this.currentPage();
    const total = this.totalPages();
    if (current < total) {
      this.currentPage.set(current + 1);
    }
  }

  onPageSizeChange(size: number): void {
    this.pageSize.set(size);
    this.currentPage.set(1); // Reset to first page when page size changes
  }
}

