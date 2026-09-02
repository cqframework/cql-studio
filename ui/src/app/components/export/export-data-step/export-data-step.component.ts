// Author: Preston Lee

import {
  Component,
  OnInit,
  computed,
  effect,
  inject,
  input,
  output,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ImplementationGuide, Patient, Resource } from 'fhir/r4';
import { ExportDestination } from '../export.types';
import {
  ExportDataSelection,
  ExportDataTab,
  exportDataResourceLabel,
  groupSelectionsByType,
  IgExportOptions,
  mergeExportDataSelections,
  PatientExpansionOptions,
  toExportDataSelection
} from '../../../services/export-data-resource.lib';
import { ExportDataSearchService } from '../../../services/export-data-search.service';
import { FhirCapabilityService } from '../../../services/fhir-capability.service';
import {
  defaultSelectedIgEntryKeys,
  exportDataResourceKey,
  parseImplementationGuideEntries
} from '../../../services/implementation-guide.lib';
import { ImplementationGuidePanelComponent } from '../../shared/implementation-guide-panel/implementation-guide-panel.component';
import { isResourceType, resourceTypeOf } from '../../../services/fhir-resource-type.lib';

const DATA_TABS: ExportDataTab[] = [
  'Patient',
  'Measure',
  'MeasureReport',
  'Condition',
  'Observation',
  'ImplementationGuide',
  'Other'
];

const DEFAULT_EXPANSION_TYPES = ['Condition', 'Observation', 'Encounter', 'Procedure'];

@Component({
  selector: 'app-export-data-step',
  imports: [FormsModule, ImplementationGuidePanelComponent],
  templateUrl: './export-data-step.component.html'
})
export class ExportDataStepComponent implements OnInit {
  private readonly searchService = inject(ExportDataSearchService);
  private readonly capabilityService = inject(FhirCapabilityService);

  readonly selected = input<ExportDataSelection[]>([]);
  readonly destination = input<ExportDestination | null>(null);
  readonly igExportOptions = input<Record<string, IgExportOptions>>({});
  readonly patientExpansion = input<PatientExpansionOptions>({
    enabled: false,
    resourceTypes: ['Condition', 'Observation']
  });

  readonly selectedChange = output<ExportDataSelection[]>();
  readonly igOptionsChange = output<Record<string, IgExportOptions>>();
  readonly patientExpansionChange = output<PatientExpansionOptions>();

  readonly tabs = DATA_TABS;
  readonly activeTab = signal<ExportDataTab>('Patient');
  readonly searchParams = signal<Record<string, string>>({});
  readonly searchLoading = signal(false);
  readonly searchError = signal<string | null>(null);
  readonly searchResults = signal<Resource[]>([]);
  readonly searchTotal = signal(0);
  readonly currentPage = signal(1);
  readonly pageSize = signal(20);

  readonly activeIg = signal<ImplementationGuide | null>(null);
  readonly igEntryKeys = signal<ReadonlySet<string>>(new Set());
  readonly igGlobalIndices = signal<ReadonlySet<number>>(new Set());
  readonly igSanitize = signal(true);
  readonly igSyncManifest = signal(false);
  readonly igResolveLoading = signal(false);
  readonly igResolveFailures = signal<{ reference: string; message: string }[]>([]);

  readonly patientExpansionEnabled = signal(false);
  readonly patientExpansionTypes = signal<string[]>(['Condition', 'Observation']);

  readonly otherResourceTypes = computed(() => this.searchService.otherResourceTypes());

  readonly groupedSelected = computed(() => groupSelectionsByType(this.selected()));

  readonly selectedPatients = computed(() =>
    this.selected()
      .map((s) => s.resource)
      .filter((r): r is Patient => isResourceType(r, 'Patient'))
  );

  readonly showIgSyncToggle = computed(() => {
    const dest = this.destination();
    return dest === 'fhir-package' || dest === 'crmi';
  });

  readonly igEntries = computed(() => {
    const ig = this.activeIg();
    return ig ? parseImplementationGuideEntries(ig) : [];
  });

  readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.searchTotal() / this.pageSize()))
  );

  constructor() {
    effect(() => {
      const ig = this.activeIg();
      if (!ig) {
        return;
      }
      const key = exportDataResourceKey(ig);
      // Don't resurrect options for an IG that is no longer in the selection basket.
      if (!this.selected().some((s) => s.key === key)) {
        return;
      }
      const existing = this.igExportOptions()[key];
      if (existing) {
        this.igEntryKeys.set(new Set(existing.selectedEntryKeys));
        this.igGlobalIndices.set(new Set(existing.selectedGlobalIndices));
        this.igSanitize.set(existing.sanitize);
        this.igSyncManifest.set(existing.syncPackageManifest);
      } else {
        const defaults = defaultSelectedIgEntryKeys(parseImplementationGuideEntries(ig));
        this.igEntryKeys.set(defaults);
        this.igGlobalIndices.set(new Set((ig.global ?? []).map((_, i) => i)));
        this.persistIgOptions(ig);
      }
    });
  }

  ngOnInit(): void {
    const pe = this.patientExpansion();
    this.patientExpansionEnabled.set(pe.enabled);
    this.patientExpansionTypes.set(
      pe.resourceTypes.length > 0 ? [...pe.resourceTypes] : ['Condition', 'Observation']
    );
    this.capabilityService.loadMetadata();
    void this.runSearch();
  }

  setTab(tab: ExportDataTab): void {
    this.activeTab.set(tab);
    this.searchParams.set({});
    this.activeIg.set(null);
    this.currentPage.set(1);
    void this.runSearch();
  }

  setSearchParam(name: string, value: string): void {
    this.searchParams.update((p) => ({ ...p, [name]: value }));
  }

  getSearchParam(name: string): string {
    return this.searchParams()[name] ?? '';
  }

  async runSearch(): Promise<void> {
    this.searchLoading.set(true);
    this.searchError.set(null);
    try {
      const result = await this.searchService.searchTab(
        this.activeTab(),
        this.searchParams(),
        this.currentPage(),
        this.pageSize()
      );
      this.searchResults.set(result.resources);
      this.searchTotal.set(result.total);
      if (result.error) {
        this.searchError.set(result.error);
      }
    } catch (err) {
      this.searchError.set(err instanceof Error ? err.message : String(err));
      this.searchResults.set([]);
    } finally {
      this.searchLoading.set(false);
    }
  }

  onSearch(): void {
    this.currentPage.set(1);
    void this.runSearch();
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages()) {
      return;
    }
    this.currentPage.set(page);
    void this.runSearch();
  }

  isSelected(resource: Resource): boolean {
    return this.selected().some((s) => s.key === exportDataResourceKey(resource));
  }

  toggleResource(resource: Resource): void {
    const key = exportDataResourceKey(resource);
    const current = this.selected();
    if (current.some((s) => s.key === key)) {
      this.selectedChange.emit(current.filter((s) => s.key !== key));
    } else {
      this.selectedChange.emit(mergeExportDataSelections(current, [toExportDataSelection(resource, 'search')]));
    }
  }

  removeSelection(key: string): void {
    const ig = this.activeIg();
    if (ig && exportDataResourceKey(ig) === key) {
      this.activeIg.set(null);
    }
    this.selectedChange.emit(this.selected().filter((s) => s.key !== key));
    this.clearIgOptionsForKeys([key]);
  }

  clearType(resourceType: string): void {
    const removed = this.selected().filter((s) => resourceTypeOf(s.resource) === resourceType);
    const ig = this.activeIg();
    if (ig && resourceTypeOf(ig) === resourceType) {
      this.activeIg.set(null);
    }
    this.selectedChange.emit(
      this.selected().filter((s) => resourceTypeOf(s.resource) !== resourceType)
    );
    this.clearIgOptionsForKeys(removed.map((s) => s.key));
  }

  openIgInspector(ig: ImplementationGuide): void {
    this.activeIg.set(ig);
    if (!this.isSelected(ig)) {
      this.toggleResource(ig);
    }
  }

  onIgEntryKeysChange(keys: ReadonlySet<string>): void {
    this.igEntryKeys.set(keys);
    const ig = this.activeIg();
    if (ig) {
      this.persistIgOptions(ig);
    }
  }

  onIgGlobalChange(indices: ReadonlySet<number>): void {
    this.igGlobalIndices.set(indices);
    const ig = this.activeIg();
    if (ig) {
      this.persistIgOptions(ig);
    }
  }

  onIgSanitizeChange(value: boolean): void {
    this.igSanitize.set(value);
    const ig = this.activeIg();
    if (ig) {
      this.persistIgOptions(ig);
    }
  }

  onIgSyncChange(value: boolean): void {
    this.igSyncManifest.set(value);
    const ig = this.activeIg();
    if (ig) {
      this.persistIgOptions(ig);
    }
  }

  async resolveIgSelected(): Promise<void> {
    const ig = this.activeIg();
    if (!ig) {
      return;
    }
    this.igResolveLoading.set(true);
    this.igResolveFailures.set([]);
    try {
      const result = await this.searchService.resolveIgReferences(
        ig,
        this.igEntryKeys(),
        this.igSanitize(),
        this.igGlobalIndices()
      );
      this.igResolveFailures.set(result.failures);
      // Keep the full IG in the selection basket. Sanitize is applied only at export time
      // (applyIgSanitizeIfConfigured) so later resolve/Next still see the complete definition.
      if (result.resolved.length > 0) {
        this.selectedChange.emit(
          mergeExportDataSelections(this.selected(), result.resolved)
        );
      }
      this.persistIgOptions(ig, true);
    } finally {
      this.igResolveLoading.set(false);
    }
  }

  toggleExpansionType(type: string): void {
    const current = this.patientExpansionTypes();
    if (current.includes(type)) {
      this.patientExpansionTypes.set(current.filter((t) => t !== type));
    } else {
      this.patientExpansionTypes.set([...current, type]);
    }
    this.emitPatientExpansion();
  }

  onExpansionEnabledChange(enabled: boolean): void {
    this.patientExpansionEnabled.set(enabled);
    this.emitPatientExpansion();
  }

  isExpansionTypeOn(type: string): boolean {
    return this.patientExpansionTypes().includes(type);
  }

  private getPatientExpansionOptions(): PatientExpansionOptions {
    return {
      enabled: this.patientExpansionEnabled(),
      resourceTypes: this.patientExpansionTypes()
    };
  }

  resourceLabel(resource: Resource): string {
    return exportDataResourceLabel(resource);
  }

  private persistIgOptions(ig: ImplementationGuide, resolveReferences?: boolean): void {
    const key = exportDataResourceKey(ig);
    const existing = this.igExportOptions()[key];
    const next = {
      ...this.igExportOptions(),
      [key]: {
        igKey: key,
        sanitize: this.igSanitize(),
        syncPackageManifest: this.igSyncManifest(),
        selectedEntryKeys: [...this.igEntryKeys()],
        selectedGlobalIndices: [...this.igGlobalIndices()],
        resolveReferences: resolveReferences ?? existing?.resolveReferences ?? false
      }
    };
    this.igOptionsChange.emit(next);
  }

  private clearIgOptionsForKeys(keys: string[]): void {
    if (keys.length === 0) {
      return;
    }
    const next = { ...this.igExportOptions() };
    let changed = false;
    for (const key of keys) {
      if (key in next) {
        delete next[key];
        changed = true;
      }
    }
    if (changed) {
      this.igOptionsChange.emit(next);
    }
  }

  private emitPatientExpansion(): void {
    this.patientExpansionChange.emit(this.getPatientExpansionOptions());
  }

  protected readonly expansionTypeOptions = DEFAULT_EXPANSION_TYPES;
}
