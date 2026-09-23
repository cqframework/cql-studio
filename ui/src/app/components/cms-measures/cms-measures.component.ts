// Author: Preston Lee

import { Component, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { RouterModule } from '@angular/router';
import { CmsContentSource, CMS_CONTENT_SOURCES } from '../../services/cms-content-sources';
import {
  CmsMeasureSummary,
  filterCmsMeasures,
} from '../../services/cms-measure-catalog.lib';
import { CmsContentService } from '../../services/cms-content.service';
import { CmsExecutionImportGroup, CmsExecutionPrepService } from '../../services/cms-execution-prep.service';
import { CmsImportProgress, importProgressForMeasures } from '../../services/cms-import-progress';
import { CmsImportOutcome, CmsMeasuresImportService } from '../../services/cms-measures-import.service';
import { SettingsService } from '../../services/settings.service';

@Component({
  selector: 'app-cms-measures',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './cms-measures.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CmsMeasuresComponent {
  private readonly content = inject(CmsContentService);
  private readonly importer = inject(CmsMeasuresImportService);
  private readonly execution = inject(CmsExecutionPrepService);
  private readonly settings = inject(SettingsService);

  protected readonly sources = CMS_CONTENT_SOURCES;
  protected readonly sourceId = signal<string>(CMS_CONTENT_SOURCES[0]?.id ?? '');
  protected readonly searchText = signal('');
  protected readonly statusFilter = signal('');
  protected readonly loading = signal(false);
  protected readonly importing = signal(false);
  protected readonly importStatus = signal<CmsImportProgress | null>(null);
  protected readonly progress = signal('');
  protected readonly error = signal('');
  protected readonly measures = signal<CmsMeasureSummary[]>([]);
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly results = signal<CmsImportOutcome[]>([]);
  protected readonly unresolved = signal<string[]>([]);
  private loadGeneration = 0;

  protected readonly evaluationConfigured = computed(() => this.importer.evaluationServerConfigured());
  protected readonly vsacConfigured = computed(() => this.settings.vsacHasApiCredentials());
  protected readonly showCatalog = computed(() => !this.evaluationConfigured() || this.vsacConfigured());
  protected readonly indexLoaded = signal(false);

  protected readonly statuses = computed(() => {
    const values = new Set(this.measures().map((row) => row.status).filter(Boolean));
    return [...values].sort();
  });

  protected readonly visible = computed(() =>
    filterCmsMeasures(this.measures(), {
      text: this.searchText(),
      sourceId: this.sourceId(),
      status: this.statusFilter(),
    })
  );

  protected readonly allVisibleSelected = computed(() => {
    const rows = this.visible();
    if (rows.length === 0) {
      return false;
    }
    const selected = this.selected();
    return rows.every((row) => selected.has(this.rowKey(row)));
  });

  protected readonly selectedCount = computed(() => {
    const keys = new Set(this.measures().map((row) => this.rowKey(row)));
    let count = 0;
    for (const key of this.selected()) {
      if (keys.has(key)) {
        count += 1;
      }
    }
    return count;
  });

  protected rowKey(row: CmsMeasureSummary): string {
    return `${row.sourceId}:${row.path}`;
  }

  protected isSelected(row: CmsMeasureSummary): boolean {
    return this.selected().has(this.rowKey(row));
  }

  protected isCurrentImport(row: CmsMeasureSummary): boolean {
    const key = this.importStatus()?.measureKey;
    return this.importing() && !!key && key === this.rowKey(row);
  }

  protected onSourceChange(value: string): void {
    if (value === this.sourceId()) {
      return;
    }
    this.loadGeneration += 1;
    this.sourceId.set(value);
    this.indexLoaded.set(false);
    this.loading.set(false);
    this.measures.set([]);
    this.selected.set(new Set());
    this.searchText.set('');
    this.statusFilter.set('');
    this.error.set('');
    this.progress.set('');
  }

  protected loadIndex(): void {
    if (!this.showCatalog() || this.importing() || !this.sourceId()) {
      return;
    }
    void this.reload();
  }

  protected onSearchInput(value: string): void {
    this.searchText.set(value);
  }

  protected onStatusChange(value: string): void {
    this.statusFilter.set(value);
  }

  protected toggleRow(row: CmsMeasureSummary, checked: boolean): void {
    const key = this.rowKey(row);
    this.selected.update((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  }

  protected toggleVisible(checked: boolean): void {
    const keys = this.visible().map((row) => this.rowKey(row));
    this.selected.update((current) => {
      const next = new Set(current);
      for (const key of keys) {
        if (checked) {
          next.add(key);
        } else {
          next.delete(key);
        }
      }
      return next;
    });
  }

  protected async reload(): Promise<void> {
    const generation = ++this.loadGeneration;
    this.loading.set(true);
    this.error.set('');
    this.progress.set('');
    try {
      const sources = this.sourcesToLoad();
      const loaded: CmsMeasureSummary[] = [];
      const errors: string[] = [];
      for (const source of sources) {
        const result = await this.content.listMeasures(source, (message) => {
          if (generation === this.loadGeneration) {
            this.progress.set(message);
          }
        });
        if (generation !== this.loadGeneration) {
          return;
        }
        loaded.push(...result.measures);
        errors.push(...result.errors);
      }
      loaded.sort((a, b) => a.title.localeCompare(b.title) || a.sourceLabel.localeCompare(b.sourceLabel));
      this.measures.set(loaded);
      const valid = new Set(loaded.map((row) => this.rowKey(row)));
      this.selected.update((current) => new Set([...current].filter((key) => valid.has(key))));
      this.error.set(errors.slice(0, 5).join(' '));
      this.progress.set('');
      this.indexLoaded.set(true);
    } catch (err) {
      if (generation !== this.loadGeneration) {
        return;
      }
      if (!this.indexLoaded()) {
        this.measures.set([]);
      }
      this.error.set(err instanceof Error ? err.message : 'Unable to load CMS measures.');
      this.progress.set('');
    } finally {
      if (generation === this.loadGeneration) {
        this.loading.set(false);
      }
    }
  }

  protected async importSelected(): Promise<void> {
    if (!this.evaluationConfigured() || !this.vsacConfigured() || this.importing()) {
      return;
    }
    const chosen = this.measures().filter((row) => this.selected().has(this.rowKey(row)));
    if (chosen.length === 0) {
      return;
    }
    this.importing.set(true);
    this.importStatus.set(importProgressForMeasures(chosen, chosen, 'Resolving libraries', 'Starting import'));
    this.results.set([]);
    this.unresolved.set([]);
    this.error.set('');
    try {
      const unresolved: string[] = [];
      const bySource = new Map<string, CmsMeasureSummary[]>();
      for (const row of chosen) {
        const group = bySource.get(row.sourceId) ?? [];
        group.push(row);
        bySource.set(row.sourceId, group);
      }
      const groups: CmsExecutionImportGroup[] = [];
      for (const [sourceId, rows] of bySource) {
        const source = CMS_CONTENT_SOURCES.find((item) => item.id === sourceId);
        if (!source) {
          continue;
        }
        const loaded = await this.content.loadImportResources(source, rows, (status) => {
          this.importStatus.set(status);
        });
        unresolved.push(...loaded.unresolved);
        groups.push({ label: source.label, measures: rows, resources: loaded.resources });
      }
      const outcomes = await this.execution.importGroups(groups, (status) => this.importStatus.set(status));
      this.results.set(outcomes);
      this.unresolved.set([...new Set(unresolved)]);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      this.importing.set(false);
      this.importStatus.set(null);
    }
  }

  private sourcesToLoad(): CmsContentSource[] {
    const source = CMS_CONTENT_SOURCES.find((item) => item.id === this.sourceId());
    return source ? [source] : [];
  }
}
