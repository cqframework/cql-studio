// Author: Preston Lee

import { Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ImplementationGuide } from 'fhir/r4';
import {
  defaultSelectedIgEntryKeys,
  IgResourceEntryVm
} from '../../../services/implementation-guide.lib';
import { isConformanceResourceType } from '../../../services/fhir-resource-endpoint.lib';

export type ImplementationGuidePanelMode = 'export' | 'import-bundle' | 'import-archive';

@Component({
  selector: 'app-implementation-guide-panel',
  imports: [FormsModule],
  templateUrl: './implementation-guide-panel.component.html'
})
export class ImplementationGuidePanelComponent {
  readonly ig = input.required<ImplementationGuide>();
  readonly entries = input.required<IgResourceEntryVm[]>();
  readonly mode = input<ImplementationGuidePanelMode>('export');
  readonly selectedEntryKeys = input<ReadonlySet<string>>(new Set());
  readonly selectedGlobalIndices = input<ReadonlySet<number>>(new Set());
  readonly sanitize = input(true);
  readonly syncPackageManifest = input(false);
  /** Show sanitize checkbox (export mode). */
  readonly showSanitizeToggle = input(true);
  /** Show package.json sync checkbox (package/crmi destinations). */
  readonly showSyncToggle = input(false);
  readonly resolveLoading = input(false);
  readonly resolveFailures = input<{ reference: string; message: string }[]>([]);

  readonly selectedEntryKeysChange = output<ReadonlySet<string>>();
  readonly selectedGlobalIndicesChange = output<ReadonlySet<number>>();
  readonly sanitizeChange = output<boolean>();
  readonly syncPackageManifestChange = output<boolean>();
  readonly resolveSelected = output<void>();
  readonly selectReferenced = output<void>();
  readonly selectConformanceOnly = output<void>();
  readonly selectMetadataOnly = output<void>();

  readonly groupingNames = computed(() => {
    const map = new Map<string, string>();
    for (const g of this.ig().definition?.grouping ?? []) {
      if (g.id) {
        map.set(g.id, g.name ?? g.description ?? g.id);
      }
    }
    return map;
  });

  readonly groupedEntries = computed(() => {
    const groups = new Map<string, IgResourceEntryVm[]>();
    for (const e of this.entries()) {
      const key = e.groupingId ?? '';
      const list = groups.get(key) ?? [];
      list.push(e);
      groups.set(key, list);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  });

  groupingLabel(groupingId: string): string {
    return this.groupingNames().get(groupingId) ?? groupingId;
  }

  isEntrySelected(key: string): boolean {
    return this.selectedEntryKeys().has(key);
  }

  /**
   * Import modes can't bring in an entry the classifier marked unimportable (example, unsupported
   * type) or one that isn't present in the archive/bundle. Export mode still allows toggling IG
   * definition metadata for sanitize/export.
   */
  isEntryDisabled(entry: IgResourceEntryVm): boolean {
    return this.mode() !== 'export' && !entry.importable;
  }

  isGlobalSelected(index: number): boolean {
    return this.selectedGlobalIndices().has(index);
  }

  toggleEntry(key: string): void {
    const next = new Set(this.selectedEntryKeys());
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    this.selectedEntryKeysChange.emit(next);
  }

  toggleGlobal(index: number): void {
    const next = new Set(this.selectedGlobalIndices());
    if (next.has(index)) {
      next.delete(index);
    } else {
      next.add(index);
    }
    this.selectedGlobalIndicesChange.emit(next);
  }

  selectAllConformance(): void {
    const next = new Set<string>();
    for (const e of this.entries()) {
      if (!e.importable) {
        continue;
      }
      const type = e.resourceTypeHint ?? '';
      if (type && isConformanceResourceType(type)) {
        next.add(e.key);
      }
    }
    this.selectedEntryKeysChange.emit(next);
  }

  selectNone(): void {
    this.selectedEntryKeysChange.emit(new Set());
  }

  resetDefaults(): void {
    this.selectedEntryKeysChange.emit(defaultSelectedIgEntryKeys(this.entries()));
  }

  matchStatus(entry: IgResourceEntryVm): 'matched' | 'unmatched' | 'skipped' | 'na' {
    if (!entry.importable) {
      return 'skipped';
    }
    if (this.mode() === 'import-archive') {
      return entry.matchedRowKey ? 'matched' : 'unmatched';
    }
    if (this.mode() === 'import-bundle') {
      return entry.matchedResourceKey ? 'matched' : 'unmatched';
    }
    return 'na';
  }

  matchLabel(entry: IgResourceEntryVm): string {
    const status = this.matchStatus(entry);
    if (status === 'matched') {
      return 'Matched';
    }
    if (status === 'unmatched') {
      return this.mode() === 'import-bundle' ? 'Not in bundle' : 'Not in package';
    }
    if (status === 'skipped') {
      return entry.skipReason ?? 'Skipped';
    }
    return entry.skipReason ?? '';
  }
}
