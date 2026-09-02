// Author: Preston Lee

import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  RegistryImportResultRow,
  RegistryImportResultSortColumn,
} from '../../../models/fhir-package-import.types';
import {
  filterAndSortImportResults,
  importResultCounts,
} from '../registry-import-results.lib';

@Component({
  selector: 'app-registry-importer-import-results-panel',
  imports: [FormsModule],
  templateUrl: './registry-importer-import-results-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RegistryImporterImportResultsPanelComponent {
  readonly rows = input.required<RegistryImportResultRow[]>();
  readonly clear = output<void>();

  protected readonly outcomeFilter = signal<'all' | 'errors' | 'success'>('all');
  protected readonly search = signal('');
  protected readonly sortColumn = signal<RegistryImportResultSortColumn>('packageName');
  protected readonly sortAsc = signal(true);

  protected readonly filteredSorted = computed(() =>
    filterAndSortImportResults(
      this.rows(),
      this.outcomeFilter(),
      this.search(),
      this.sortColumn(),
      this.sortAsc()
    )
  );

  protected readonly counts = computed(() => importResultCounts(this.rows()));

  protected setOutcomeFilter(value: 'all' | 'errors' | 'success'): void {
    this.outcomeFilter.set(value);
  }

  protected toggleSort(column: RegistryImportResultSortColumn): void {
    if (this.sortColumn() === column) {
      this.sortAsc.update((v) => !v);
    } else {
      this.sortColumn.set(column);
      this.sortAsc.set(true);
    }
  }

  protected sortChevron(column: RegistryImportResultSortColumn): string {
    if (this.sortColumn() !== column) {
      return '';
    }
    return this.sortAsc() ? ' ▲' : ' ▼';
  }

  protected messageLines(message: string): string[] {
    return message.split(/\r?\n/);
  }

  protected trackRow(_index: number, row: RegistryImportResultRow): string {
    return `${row.packageName}\u0000${row.channel}\u0000${row.resourceType}\u0000${row.resourceId}\u0000${row.filename}\u0000${row.ok}\u0000${row.message}`;
  }

  protected onClear(): void {
    this.search.set('');
    this.outcomeFilter.set('all');
    this.clear.emit();
  }
}
