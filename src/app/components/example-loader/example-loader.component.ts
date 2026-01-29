// Author: Preston Lee

import { Component, signal, inject, OnInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Bundle, Library, Measure } from 'fhir/r4';
import { LibraryService } from '../../services/library.service';
import { MeasureService } from '../../services/measure.service';
import { SettingsService } from '../../services/settings.service';
import { ToastService } from '../../services/toast.service';
import { SyntaxHighlighterComponent } from '../shared/syntax-highlighter/syntax-highlighter.component';

/** FHIR R4 example measures and the Library resources they depend on. Load order: dependencies before dependents. */
const FHIR_MEASURES_LOAD_ORDER: string[] = [
  'library-quick-model-definition.json',
  'library-cms146-example.json',
  'library-exclusive-breastfeeding-cqm-logic.json',
  'library-hiv-indicators.json',
  'measure-cms146-example.json',
  'measure-component-a-example.json',
  'measure-component-b-example.json',
  'measure-composite-example.json',
  'measure-exclusive-breastfeeding.json',
  'measure-predecessor-example.json',
  'measure-hiv-indicators.json'
];

export interface ExampleFileRow {
  filename: string;
  selected: boolean;
  status: 'idle' | 'loading' | 'deleting' | 'success' | 'error';
  message?: string;
  resourceType?: 'Library' | 'Measure';
  resourceId?: string;
}

@Component({
  selector: 'app-example-loader',
  standalone: true,
  imports: [CommonModule, FormsModule, SyntaxHighlighterComponent],
  templateUrl: './example-loader.component.html',
  styleUrl: './example-loader.component.scss'
})
export class ExampleLoaderComponent implements OnInit {
  protected readonly rows = signal<ExampleFileRow[]>([]);
  protected readonly loadingOrder = signal<boolean>(true);
  protected readonly isLoading = signal<boolean>(false);
  protected readonly isDeleting = signal<boolean>(false);
  protected readonly showDeleteAllModal = signal(false);
  protected readonly deleteAllInProgress = signal(false);
  protected readonly deleteAllCurrent = signal(0);
  protected readonly deleteAllTotal = signal(0);
  protected readonly deleteAllStatus = signal('');

  protected readonly hasValidConfiguration = computed(() => {
    const url = this.settingsService.getEffectiveFhirBaseUrl();
    return url?.trim() !== '';
  });

  protected readonly selectedCount = computed(() =>
    this.rows().filter(r => r.selected).length
  );

  protected readonly hasSelection = computed(() => this.selectedCount() > 0);

  private http = inject(HttpClient);
  private libraryService = inject(LibraryService);
  private measureService = inject(MeasureService);
  protected settingsService = inject(SettingsService);
  private toastService = inject(ToastService);
  private router = inject(Router);

  private readonly basePath = '/fhir/measures';

  ngOnInit(): void {
    this.computeLoadOrder();
  }

  getEffectiveFhirBaseUrl(): string {
    return this.settingsService.getEffectiveFhirBaseUrl();
  }

  navigateToSettings(event: Event): void {
    event.preventDefault();
    this.router.navigate(['/settings']);
  }

  private formatError(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      const body = err.error;
      if (body != null && typeof body === 'object') {
        try {
          return JSON.stringify(body, null, 2);
        } catch {
          return err.message || `${err.status} ${err.statusText}`;
        }
      }
      if (typeof body === 'string') return body;
      return err.message || `${err.status} ${err.statusText}`;
    }
    if (err instanceof Error) return err.message;
    if (typeof err === 'object' && err !== null) {
      try {
        return JSON.stringify(err, null, 2);
      } catch {
        return String(err);
      }
    }
    return String(err);
  }

  async computeLoadOrder(): Promise<void> {
    this.loadingOrder.set(true);
    const parsedByFile: Record<string, unknown> = {};
    try {
      await Promise.all(
        FHIR_MEASURES_LOAD_ORDER.map(async f => {
          try {
            const json = await firstValueFrom(this.http.get<unknown>(`${this.basePath}/${f}`));
            if (json && typeof json === 'object' && 'resourceType' in json) {
              parsedByFile[f] = json;
            }
          } catch {
            // leave parsedByFile[f] undefined; row still shows with no resourceType/id
          }
        })
      );
      const rows: ExampleFileRow[] = FHIR_MEASURES_LOAD_ORDER.map(f => ({
        filename: f,
        selected: true,
        status: 'idle' as const,
        resourceType: (parsedByFile[f] as { resourceType?: string } | null)?.resourceType as 'Library' | 'Measure' | undefined,
        resourceId: (parsedByFile[f] as { id?: string } | null)?.id
      }));
      this.rows.set(rows);
    } finally {
      this.loadingOrder.set(false);
    }
  }

  toggleRow(filename: string): void {
    this.rows.update(list =>
      list.map(r => (r.filename === filename ? { ...r, selected: !r.selected } : r))
    );
  }

  toggleAll(selected: boolean): void {
    this.rows.update(list => list.map(r => ({ ...r, selected })));
  }

  setRowStatus(filename: string, status: ExampleFileRow['status'], message?: string): void {
    this.rows.update(list =>
      list.map(r =>
        r.filename === filename ? { ...r, status, message } : r
      )
    );
  }

  async loadSelected(): Promise<void> {
    if (!this.hasValidConfiguration() || !this.hasSelection()) return;
    this.isLoading.set(true);
    const ordered = this.rows().filter(r => r.selected);
    ordered.forEach(row => this.setRowStatus(row.filename, 'loading'));
    try {
      const entries: Bundle['entry'] = [];
      const filenamesByIndex: string[] = [];
      for (const row of ordered) {
        const json = await firstValueFrom(this.http.get<unknown>(`${this.basePath}/${row.filename}`));
        if (json && typeof json === 'object' && 'resourceType' in json) {
          const rt = (json as { resourceType: string }).resourceType;
          const resource = json as Library | Measure;
          const id = (resource as { id?: string }).id;
          if (!id) {
            this.setRowStatus(row.filename, 'error', 'Resource has no id');
            continue;
          }
          if (rt !== 'Library' && rt !== 'Measure') {
            this.setRowStatus(row.filename, 'error', 'Unknown resource type');
            continue;
          }
          const resourceToSend = rt === 'Measure'
            ? this.measureService.normalizeMeasureForServer(resource as Measure)
            : resource;
          entries.push({
            fullUrl: `${rt}/${id}`,
            resource: resourceToSend,
            request: { method: 'PUT' as const, url: `${rt}/${id}` }
          });
          filenamesByIndex.push(row.filename);
        } else {
          this.setRowStatus(row.filename, 'error', 'Invalid JSON');
        }
      }
      if (entries.length === 0) {
        this.isLoading.set(false);
        return;
      }
      const bundle: Bundle = {
        resourceType: 'Bundle',
        type: 'transaction',
        entry: entries
      };
      await firstValueFrom(this.measureService.postTransactionBundle(bundle));
      filenamesByIndex.forEach(f => this.setRowStatus(f, 'success', 'Loaded'));
    } catch (err: unknown) {
      const msg = this.formatError(err);
      ordered.forEach(row => this.setRowStatus(row.filename, 'error', msg));
    } finally {
      this.isLoading.set(false);
    }
  }

  async deleteSelected(): Promise<void> {
    if (!this.hasValidConfiguration() || !this.hasSelection()) return;
    this.isDeleting.set(true);
    const ordered = this.rows().filter(r => r.selected);
    for (let i = ordered.length - 1; i >= 0; i--) {
      const row = ordered[i];
      // Serial: each request completes before the next starts (no parallel execution).
      this.setRowStatus(row.filename, 'deleting');
      try {
        if (row.resourceType === 'Library' && row.resourceId) {
          await firstValueFrom(this.libraryService.delete({ resourceType: 'Library', id: row.resourceId } as Library));
          this.setRowStatus(row.filename, 'success', 'Deleted');
        } else if (row.resourceType === 'Measure' && row.resourceId) {
          await firstValueFrom(this.measureService.deleteMeasure(row.resourceId));
          this.setRowStatus(row.filename, 'success', 'Deleted');
        } else {
          this.setRowStatus(row.filename, 'error', 'No resource id');
        }
      } catch (err: unknown) {
        this.setRowStatus(row.filename, 'error', this.formatError(err));
      }
    }
    this.isDeleting.set(false);
  }

  isJsonMessage(msg: string | undefined): boolean {
    const t = msg?.trim();
    return !!(t && (t.startsWith('{') || t.startsWith('[')));
  }

  getStatusIcon(row: ExampleFileRow): string {
    switch (row.status) {
      case 'success': return 'bi-check-circle-fill text-success';
      case 'error': return 'bi-x-circle-fill text-danger';
      case 'loading': case 'deleting': return 'bi-hourglass-split text-primary';
      default: return 'bi-circle text-muted';
    }
  }

  openDeleteAllModal(): void {
    this.showDeleteAllModal.set(true);
  }

  closeDeleteAllModal(): void {
    if (!this.deleteAllInProgress()) {
      this.showDeleteAllModal.set(false);
    }
  }

  async confirmDeleteAll(): Promise<void> {
    if (!this.hasValidConfiguration()) {
      this.toastService.showWarning('Configure FHIR base URL in Settings first.', 'Delete All');
      return;
    }
    this.deleteAllInProgress.set(true);
    this.deleteAllStatus.set('Fetching MeasureReports...');
    const reportIds: string[] = [];
    const measureIds: string[] = [];
    const libraryIds: string[] = [];
    const pageSize = 100;
    try {
      let offset = 0;
      let bundle = await firstValueFrom(
        this.measureService.searchMeasureReports({ _count: pageSize, _offset: offset })
      );
      while (bundle?.entry?.length) {
        for (const e of bundle.entry) {
          const id = e.resource?.id;
          if (id) reportIds.push(id);
        }
        offset += pageSize;
        if ((bundle.entry?.length ?? 0) < pageSize) break;
        bundle = await firstValueFrom(
          this.measureService.searchMeasureReports({ _count: pageSize, _offset: offset })
        );
      }
      this.deleteAllStatus.set('Fetching Measures...');
      offset = 0;
      let measuresBundle = await firstValueFrom(
        this.measureService.searchMeasures({ _count: pageSize, _offset: offset })
      );
      while (measuresBundle?.entry?.length) {
        for (const e of measuresBundle.entry) {
          const id = e.resource?.id;
          if (id) measureIds.push(id);
        }
        offset += pageSize;
        if ((measuresBundle.entry?.length ?? 0) < pageSize) break;
        measuresBundle = await firstValueFrom(
          this.measureService.searchMeasures({ _count: pageSize, _offset: offset })
        );
      }
      this.deleteAllStatus.set('Fetching Libraries...');
      let libraryPage = 1;
      let libraryBundle = await firstValueFrom(
        this.libraryService.getAll(libraryPage, pageSize)
      );
      while (libraryBundle?.entry?.length) {
        for (const e of libraryBundle.entry) {
          const id = e.resource?.id;
          if (id) libraryIds.push(id);
        }
        libraryPage++;
        if ((libraryBundle.entry?.length ?? 0) < pageSize) break;
        libraryBundle = await firstValueFrom(
          this.libraryService.getAll(libraryPage, pageSize)
        );
      }
      const total = reportIds.length + measureIds.length + libraryIds.length;
      this.deleteAllTotal.set(total);
      this.deleteAllCurrent.set(0);
      let current = 0;
      for (const id of reportIds) {
        this.deleteAllStatus.set(`Deleting MeasureReport ${id}...`);
        try {
          await firstValueFrom(this.measureService.deleteMeasureReport(id));
        } catch {
          // continue
        }
        current++;
        this.deleteAllCurrent.set(current);
      }
      for (const id of measureIds) {
        this.deleteAllStatus.set(`Deleting Measure ${id}...`);
        try {
          await firstValueFrom(this.measureService.deleteMeasure(id));
        } catch {
          // continue
        }
        current++;
        this.deleteAllCurrent.set(current);
      }
      for (const id of libraryIds) {
        this.deleteAllStatus.set(`Deleting Library ${id}...`);
        try {
          await firstValueFrom(this.libraryService.delete({ resourceType: 'Library', id } as Library));
        } catch {
          // continue
        }
        current++;
        this.deleteAllCurrent.set(current);
      }
      this.showDeleteAllModal.set(false);
      this.deleteAllInProgress.set(false);
      this.toastService.showSuccess(
        `Deleted ${reportIds.length} MeasureReport(s), ${measureIds.length} Measure(s), and ${libraryIds.length} Library(ies).`,
        'Delete All'
      );
      this.computeLoadOrder();
    } catch (err: unknown) {
      this.deleteAllInProgress.set(false);
      this.showDeleteAllModal.set(false);
      const msg = err instanceof Error ? err.message : 'Delete all failed.';
      this.toastService.showError(msg, 'Delete All');
    }
  }
}
