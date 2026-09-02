// Author: Preston Lee

import { Component, OnInit, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { Bundle, Library, Patient, Resource } from 'fhir/r4';
import { LibraryService } from '../../services/library.service';
import { describeFhirHttpFailure } from '../../services/fhir-http-error.lib';
import { ToastService } from '../../services/toast.service';
import {
  ExportDependencyGraph,
  ExportDependencyGraphService,
  ExportDependencyNode,
  ExportNodeKind,
  exportGraphOptionsKey
} from '../../services/export-dependency-graph.service';
import { FhirPackageArchiveService } from '../../services/fhir-package-archive.service';
import {
  DEFAULT_FHIR_CORE_PACKAGE,
  DEFAULT_FHIR_CORE_VERSION,
  FhirPackageManifestInput,
  buildFhirPackageJson,
  validateFhirPackageManifestInput
} from '../../services/fhir-package-manifest.lib';
import { CrmiArtifactPackageService } from '../../services/crmi-artifact-package.service';
import {
  ExportPublishService,
  ExportPublishTarget
} from '../../services/export-publish.service';
import {
  EnvironmentService,
  ExportPublishTargetOption
} from '../../services/environment.service';
import { downloadBytes, downloadJson } from '../../services/download-blob.lib';
import { buildTransactionBundle } from '../../services/fhir-bundle-transaction.lib';
import { resourceTypeOf, isResourceType } from '../../services/fhir-resource-type.lib';
import { ExportDestination, ExportWizardStep } from './export.types';
import { ExportDataStepComponent } from './export-data-step/export-data-step.component';
import {
  ExportDataSelection,
  IgExportOptions,
  PatientExpansionOptions,
  dataSelectionSummary,
  mergeExportDataSelections
} from '../../services/export-data-resource.lib';
import { ExportDataSearchService } from '../../services/export-data-search.service';
import {
  buildFhirPackageManifestFromIg,
  exportDataResourceKey
} from '../../services/implementation-guide.lib';
import {
  applyIgSanitizeIfConfigured,
  hasNonLibraryClinicalData,
  igSyncEnabled,
  mergeExportResources,
  primaryIgForManifestSync,
  sanitizedIgCount
} from '../../services/export-merge.lib';
import {
  isLogicLibrary,
  libraryIdentityKey,
  rootsFingerprint as buildRootsFingerprint,
  sameLibrary,
  statusBadgeClass as exportStatusBadgeClass
} from './export-wizard.lib';

export type { ExportDestination, ExportWizardStep } from './export.types';
export type ExportDepSortColumn = 'include' | 'kind' | 'name' | 'status' | 'detail';

interface ExportWizardStepMeta {
  id: ExportWizardStep;
  label: string;
}

interface ExportDestinationMeta {
  id: ExportDestination;
  label: string;
  icon: string;
  help: string;
  /** When true, shown in the destination list but not selectable. */
  disabled?: boolean;
}

interface ExportPublishTargetGroup {
  id: string;
  label: string;
  options: ExportPublishTargetOption[];
}

const EXPORT_WIZARD_STEPS: readonly ExportWizardStepMeta[] = [
  { id: 'destination', label: 'Destination' },
  { id: 'libraries', label: 'Libraries' },
  { id: 'data', label: 'Data' },
  { id: 'dependencies', label: 'Dependencies' },
  { id: 'confirm', label: 'Confirm' }
];

const EXPORT_DESTINATIONS: readonly ExportDestinationMeta[] = [
  {
    id: 'raw-cql',
    label: 'Raw CQL + dependencies (.zip)',
    icon: 'bi-file-earmark-code',
    help: 'Download .cql sources and any selected terminology JSON files.'
  },
  {
    id: 'fhir-package',
    label: 'FHIR NPM package (.tgz)',
    icon: 'bi-box-seam',
    help: 'Download a conformant FHIR Package .tgz with included package.json and .index.json manifests.'
  },
  {
    id: 'fhir-server',
    label: 'Copy to target environment',
    icon: 'bi-cloud-upload',
    help: 'Replicate selected Library and other FHIR resources to another configured environment profile.'
  },
  {
    id: 'crmi',
    label: 'CRMI artifact package',
    icon: 'bi-diagram-3',
    help: 'Coming soon — build a CRMI artifact Bundle for download, or copy the packaged resources to another environment.',
    disabled: true
  }
];

@Component({
  selector: 'app-export',
  imports: [FormsModule, ExportDataStepComponent],
  templateUrl: './export.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExportComponent implements OnInit {
  private readonly libraryService = inject(LibraryService);
  private readonly toastService = inject(ToastService);
  private readonly dependencyGraphService = inject(ExportDependencyGraphService);
  private readonly archiveService = inject(FhirPackageArchiveService);
  private readonly crmiPackageService = inject(CrmiArtifactPackageService);
  private readonly publishService = inject(ExportPublishService);
  private readonly dataSearchService = inject(ExportDataSearchService);
  private readonly environmentService = inject(EnvironmentService);

  readonly steps = EXPORT_WIZARD_STEPS;
  readonly destinations = EXPORT_DESTINATIONS;
  readonly activeStep = signal<ExportWizardStep>('destination');
  readonly destination = signal<ExportDestination | null>(null);

  readonly librarySearch = signal('');
  readonly libraryLoading = signal(false);
  readonly libraryError = signal<string | null>(null);
  readonly libraryResults = signal<Library[]>([]);
  readonly selectedLibraries = signal<Library[]>([]);

  readonly selectedDataResources = signal<ExportDataSelection[]>([]);
  readonly igExportOptions = signal<Record<string, IgExportOptions>>({});
  readonly patientExpansion = signal<PatientExpansionOptions>({
    enabled: false,
    resourceTypes: ['Condition', 'Observation']
  });

  readonly graphLoading = signal(false);
  readonly graphError = signal<string | null>(null);
  readonly graph = signal<ExportDependencyGraph | null>(null);
  /** Fingerprint of selectedLibraries used to build the current graph (staleness check). */
  readonly analyzedRootsKey = signal<string | null>(null);
  /** Keys of graph nodes included in the export. */
  readonly selectedExportKeys = signal<ReadonlySet<string>>(new Set());

  /** When destination is raw-cql, include a root complete-bundle.json (transaction + PUT). */
  readonly includeCompleteBundle = signal(true);
  readonly terminologyCapability = signal<'computable' | 'expanded'>('computable');
  readonly conditionalCreate = signal(true);
  readonly crmiBundleType = signal<'transaction' | 'collection'>('transaction');
  readonly crmiAction = signal<'download-bundle' | 'download-tgz' | 'publish'>('download-bundle');
  /** Selected personal/workspace environment key for copy destinations. */
  readonly publishTargetKey = signal<string>('');

  readonly packageName = signal('org.example.cql-export');
  readonly packageVersion = signal('0.1.0');
  readonly packageAuthor = signal('');
  readonly packageDescription = signal('');
  readonly packageTitle = signal('');

  readonly busy = signal(false);
  /** True while next() is transitioning steps (patient expansion, IG resolve, dependency analysis). */
  readonly stepBusy = signal(false);
  readonly progressMessage = signal<string | null>(null);
  readonly lastOutcomes = signal<string[]>([]);

  readonly depSortColumn = signal<ExportDepSortColumn>('kind');
  readonly depSortOrder = signal<'asc' | 'desc'>('asc');

  readonly sanitizedIgCount = sanitizedIgCount;
  readonly igSyncEnabled = igSyncEnabled;

  readonly stepIndex = computed(() => this.steps.findIndex((s) => s.id === this.activeStep()));

  readonly selectedDestinationMeta = computed(() => {
    const id = this.destination();
    return id ? (this.destinations.find((d) => d.id === id) ?? null) : null;
  });

  readonly requiresPublishTarget = computed(() => {
    const dest = this.destination();
    return dest === 'fhir-server' || (dest === 'crmi' && this.crmiAction() === 'publish');
  });

  readonly publishTargetOptions = computed(() => this.environmentService.listExportPublishTargetOptions());

  readonly publishTargetGroups = computed((): ExportPublishTargetGroup[] => {
    const options = this.publishTargetOptions();
    const groups: ExportPublishTargetGroup[] = [];
    const personal = options.filter((o) => o.group === 'personal');
    if (personal.length > 0) {
      groups.push({ id: 'personal', label: 'Personal', options: personal });
    }
    const byWorkspace = new Map<string, ExportPublishTargetGroup>();
    for (const opt of options) {
      if (opt.group !== 'workspace' || !opt.workspaceId) {
        continue;
      }
      let group = byWorkspace.get(opt.workspaceId);
      if (!group) {
        group = {
          id: `workspace:${opt.workspaceId}`,
          label: opt.workspaceName ?? 'Workspace',
          options: []
        };
        byWorkspace.set(opt.workspaceId, group);
        groups.push(group);
      }
      group.options.push(opt);
    }
    return groups;
  });

  readonly selectedPublishTargetEnv = computed(() => {
    const key = this.publishTargetKey().trim();
    if (!key || !this.requiresPublishTarget()) {
      return null;
    }
    return this.environmentService.resolveEnvironmentByPublishKey(key);
  });

  readonly selectedPublishTargetPreview = computed(() => {
    const env = this.selectedPublishTargetEnv();
    if (!env) {
      return null;
    }
    return {
      name: env.name,
      data: this.environmentService.getEffectiveAddressForRoleOnEnvironment(env, 'data'),
      terminology: this.environmentService.getEffectiveAddressForRoleOnEnvironment(env, 'terminology')
    };
  });

  readonly publishTargetIsActiveEnvironment = computed(() => {
    const key = this.publishTargetKey().trim();
    return !!key && this.environmentService.isPublishTargetKeyActive(key);
  });

  readonly sortedDependencyNodes = computed(() => {
    const g = this.graph();
    if (!g) {
      return [] as ExportDependencyNode[];
    }
    const nodes = [...g.flat];
    const column = this.depSortColumn();
    const direction = this.depSortOrder() === 'asc' ? 1 : -1;
    const selected = this.selectedExportKeys();

    nodes.sort((a, b) => {
      let cmp = 0;
      switch (column) {
        case 'include':
          cmp = Number(selected.has(a.key)) - Number(selected.has(b.key));
          break;
        case 'kind':
          cmp = a.kind.localeCompare(b.kind);
          break;
        case 'name':
          cmp = a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
          break;
        case 'status':
          cmp = a.status.localeCompare(b.status);
          break;
        case 'detail':
          cmp = (a.detail ?? '').localeCompare(b.detail ?? '', undefined, { sensitivity: 'base' });
          break;
      }
      if (cmp === 0 && column !== 'name') {
        cmp = a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
      }
      if (cmp === 0) {
        cmp = a.key.localeCompare(b.key);
      }
      return cmp * direction;
    });
    return nodes;
  });

  readonly selectedCounts = computed(() => {
    const g = this.graph();
    const keys = this.selectedExportKeys();
    if (!g) {
      return { library: 0, valueset: 0, codesystem: 0 };
    }
    let library = 0;
    let valueset = 0;
    let codesystem = 0;
    for (const node of g.flat) {
      if (!keys.has(node.key) || node.status !== 'resolved') {
        continue;
      }
      if (node.kind === 'library') {
        library++;
      } else if (node.kind === 'valueset') {
        valueset++;
      } else if (node.kind === 'codesystem') {
        codesystem++;
      }
    }
    return { library, valueset, codesystem };
  });

  readonly packageValidation = computed(() => {
    if (
      this.destination() !== 'fhir-package' &&
      !(this.destination() === 'crmi' && this.crmiAction() === 'download-tgz')
    ) {
      return { valid: true, errors: [] as string[] };
    }
    return validateFhirPackageManifestInput(this.manifestInput());
  });

  readonly dataSelectionSummaryText = computed(() =>
    dataSelectionSummary(this.selectedDataResources())
  );

  readonly showCrmiDataWarning = computed(
    () =>
      this.destination() === 'crmi' && hasNonLibraryClinicalData(this.selectedDataResources())
  );

  readonly canProceed = computed(() => {
    const step = this.activeStep();
    if (step === 'destination') {
      return this.destination() != null;
    }
    if (step === 'libraries') {
      return this.selectedLibraries().length > 0;
    }
    if (step === 'data') {
      return true;
    }
    if (step === 'dependencies') {
      return (
        this.graph() != null &&
        !this.graphLoading() &&
        this.selectedCounts().library > 0
      );
    }
    return true;
  });

  readonly canExecute = computed(() => {
    const g = this.graph();
    if (!g || this.busy()) {
      return false;
    }
    if (this.selectedCounts().library === 0) {
      return false;
    }
    const dest = this.destination();
    if (this.requiresPublishTarget()) {
      if (g.hasBlockingMissing) {
        return false;
      }
      if (!this.publishTargetKey().trim() || !this.selectedPublishTargetEnv()) {
        return false;
      }
      const preview = this.selectedPublishTargetPreview();
      if (!preview?.data && !preview?.terminology) {
        return false;
      }
    }
    if (dest === 'fhir-package' || (dest === 'crmi' && this.crmiAction() === 'download-tgz')) {
      return this.packageValidation().valid;
    }
    return true;
  });

  ngOnInit(): void {
    this.dependencyGraphService.clearSessionCaches();
    void this.loadLibraries();
  }

  selectDestination(dest: ExportDestination): void {
    const meta = this.destinations.find((d) => d.id === dest);
    if (meta?.disabled) {
      return;
    }
    this.destination.set(dest);
    if (dest === 'crmi') {
      this.conditionalCreate.set(true);
    } else if (dest === 'fhir-server') {
      this.conditionalCreate.set(false);
    }
    if (dest !== 'fhir-server' && dest !== 'crmi') {
      this.publishTargetKey.set('');
    }
    this.activeStep.set('libraries');
  }

  onCrmiActionChange(action: 'download-bundle' | 'download-tgz' | 'publish'): void {
    this.crmiAction.set(action);
    if (action !== 'publish') {
      this.publishTargetKey.set('');
    }
  }

  isLibrarySelected(lib: Library): boolean {
    return this.selectedLibraries().some((s) => sameLibrary(s, lib));
  }

  toggleLibrary(lib: Library): void {
    const current = this.selectedLibraries();
    if (this.isLibrarySelected(lib)) {
      this.selectedLibraries.set(current.filter((s) => !sameLibrary(s, lib)));
    } else {
      this.selectedLibraries.set([...current, lib]);
    }
    // Library roots changed — prior dependency graph is no longer valid.
    this.graph.set(null);
    this.analyzedRootsKey.set(null);
    this.selectedExportKeys.set(new Set());
  }

  /** Navigate to a prior wizard step (pills). Re-runs data/dependency work when entering dependencies. */
  async goToStep(stepId: ExportWizardStep): Promise<void> {
    const targetIdx = this.steps.findIndex((s) => s.id === stepId);
    if (targetIdx < 0 || targetIdx > this.stepIndex() || this.stepBusy()) {
      return;
    }
    if (stepId === 'dependencies') {
      this.stepBusy.set(true);
      try {
        if (this.activeStep() === 'data') {
          await this.processDataStepBeforeDependencies();
        }
        if (this.isGraphStale()) {
          await this.analyzeDependencies();
        }
        if (!this.graph()) {
          if (this.graphError()) {
            this.toastService.show({ type: 'error', message: this.graphError()! });
          }
          return;
        }
      } catch (err) {
        const message = describeFhirHttpFailure(err);
        this.toastService.show({ type: 'error', message });
        return;
      } finally {
        this.stepBusy.set(false);
      }
    }
    this.activeStep.set(stepId);
  }

  async loadLibraries(): Promise<void> {
    this.libraryLoading.set(true);
    this.libraryError.set(null);
    try {
      const term = this.librarySearch().trim();
      const bundle: Bundle = term
        ? await firstValueFrom(this.libraryService.searchPaginated(term, 1, 50, 'name', 'asc'))
        : await firstValueFrom(this.libraryService.getAll(1, 50, 'name', 'asc'));
      const libs = (bundle.entry ?? [])
        .map((e) => e.resource)
        .filter((r): r is Library => resourceTypeOf(r) === 'Library')
        .filter((lib) => isLogicLibrary(lib));
      this.libraryResults.set(libs);
    } catch (err) {
      this.libraryError.set(describeFhirHttpFailure(err));
      this.libraryResults.set([]);
    } finally {
      this.libraryLoading.set(false);
    }
  }

  async next(): Promise<void> {
    if (!this.canProceed() || this.stepBusy()) {
      return;
    }
    const idx = this.stepIndex();
    const nextStep = this.steps[idx + 1];
    if (!nextStep) {
      return;
    }
    this.stepBusy.set(true);
    try {
      if (this.activeStep() === 'data' && nextStep.id === 'dependencies') {
        await this.processDataStepBeforeDependencies();
      }
      if (nextStep.id === 'dependencies') {
        await this.analyzeDependencies();
        if (!this.graph()) {
          this.toastService.show({
            type: 'error',
            message: this.graphError() ?? 'Dependency analysis failed.'
          });
          return;
        }
      }
      if (this.activeStep() === 'dependencies' && nextStep.id === 'confirm') {
        if (this.isGraphStale()) {
          await this.analyzeDependencies();
          if (!this.graph() || this.selectedCounts().library === 0) {
            return;
          }
        }
        this.prefillPackageFields();
      }
      this.activeStep.set(nextStep.id);
    } catch (err) {
      const message = describeFhirHttpFailure(err);
      this.toastService.show({ type: 'error', message });
      if (this.activeStep() === 'data') {
        this.graphError.set(message);
      }
    } finally {
      this.stepBusy.set(false);
    }
  }

  currentGraphOptionsKey(): string {
    return exportGraphOptionsKey({
      includeCodeSystems: true,
      terminologyCapability: this.terminologyCapability()
    });
  }

  private rootsFingerprint(): string {
    return buildRootsFingerprint(this.selectedLibraries());
  }

  isGraphStale(): boolean {
    const g = this.graph();
    return (
      !g ||
      g.optionsKey !== this.currentGraphOptionsKey() ||
      this.analyzedRootsKey() !== this.rootsFingerprint()
    );
  }

  async analyzeDependencies(): Promise<void> {
    this.graphLoading.set(true);
    this.graphError.set(null);
    this.progressMessage.set('Analyzing library and terminology dependencies…');
    const previousGraph = this.graph();
    const previousSelection = this.selectedExportKeys();
    try {
      const graph = await this.dependencyGraphService.buildGraph(this.selectedLibraries(), {
        includeCodeSystems: true,
        terminologyCapability: this.terminologyCapability()
      });
      this.graph.set(graph);
      this.analyzedRootsKey.set(this.rootsFingerprint());
      this.applyExportSelection(graph, previousGraph, previousSelection);
      if (graph.missingCount > 0) {
        this.toastService.show({
          type: 'warning',
          message: `${graph.missingCount} unresolved dependenc${graph.missingCount === 1 ? 'y' : 'ies'} found.`
        });
      }
    } catch (err) {
      const message = describeFhirHttpFailure(err);
      this.graphError.set(message);
      this.graph.set(null);
      this.analyzedRootsKey.set(null);
      this.selectedExportKeys.set(new Set());
      this.toastService.show({ type: 'error', message });
    } finally {
      this.graphLoading.set(false);
      this.progressMessage.set(null);
    }
  }

  async reanalyze(): Promise<void> {
    await this.analyzeDependencies();
  }

  isExportNodeSelected(key: string): boolean {
    return this.selectedExportKeys().has(key);
  }

  canToggleExportNode(node: ExportDependencyNode): boolean {
    return node.status === 'resolved' && !!node.resource;
  }

  toggleExportNode(node: ExportDependencyNode): void {
    if (!this.canToggleExportNode(node)) {
      return;
    }
    const next = new Set(this.selectedExportKeys());
    if (next.has(node.key)) {
      next.delete(node.key);
    } else {
      next.add(node.key);
    }
    this.selectedExportKeys.set(next);
  }

  selectAllOfKind(kind: ExportNodeKind): void {
    const g = this.graph();
    if (!g) {
      return;
    }
    const next = new Set(this.selectedExportKeys());
    for (const node of g.flat) {
      if (node.kind === kind && this.canToggleExportNode(node)) {
        next.add(node.key);
      }
    }
    this.selectedExportKeys.set(next);
  }

  deselectAllOfKind(kind: ExportNodeKind): void {
    const g = this.graph();
    if (!g) {
      return;
    }
    const next = new Set(this.selectedExportKeys());
    for (const node of g.flat) {
      if (node.kind === kind) {
        next.delete(node.key);
      }
    }
    this.selectedExportKeys.set(next);
  }

  setDepSort(column: ExportDepSortColumn): void {
    if (this.depSortColumn() === column) {
      this.depSortOrder.set(this.depSortOrder() === 'asc' ? 'desc' : 'asc');
    } else {
      this.depSortColumn.set(column);
      this.depSortOrder.set(column === 'include' ? 'desc' : 'asc');
    }
  }

  async execute(): Promise<void> {
    if (!this.canExecute()) {
      return;
    }
    const dest = this.destination();
    const graph = this.graph();
    if (!dest || !graph) {
      return;
    }

    this.busy.set(true);
    this.lastOutcomes.set([]);
    try {
      switch (dest) {
        case 'raw-cql':
          await this.executeRawCql(graph);
          break;
        case 'fhir-package':
          this.executeFhirPackage(graph);
          break;
        case 'fhir-server':
          await this.executeFhirServer(graph);
          break;
        case 'crmi':
          await this.executeCrmi(graph);
          break;
      }
    } catch (err) {
      const message = describeFhirHttpFailure(err);
      this.toastService.show({ type: 'error', message });
      this.lastOutcomes.set([message]);
    } finally {
      this.busy.set(false);
      this.progressMessage.set(null);
    }
  }

  statusBadgeClass(status: ExportDependencyNode['status']): string {
    return exportStatusBadgeClass(status);
  }

  /**
   * Applies default include/exclude for newly-discovered graph nodes (libraries and ValueSets on,
   * CodeSystems off) while preserving the user's prior explicit choices for nodes that existed in
   * `previousGraph` (re-analysis should not silently revert manual include/exclude toggles).
   */
  private applyExportSelection(
    graph: ExportDependencyGraph,
    previousGraph: ExportDependencyGraph | null,
    previousSelection: ReadonlySet<string>
  ): void {
    const previousKeys = previousGraph ? new Set(previousGraph.flat.map((n) => n.key)) : null;
    const keys = new Set<string>();
    for (const node of graph.flat) {
      if (node.status !== 'resolved' || !node.resource) {
        continue;
      }
      const isKnownNode = !!previousKeys?.has(node.key);
      if (isKnownNode) {
        if (previousSelection.has(node.key)) {
          keys.add(node.key);
        }
      } else if (node.kind === 'library' || node.kind === 'valueset') {
        keys.add(node.key);
      }
    }
    this.selectedExportKeys.set(keys);
  }

  private selectedResources(graph: ExportDependencyGraph): Resource[] {
    return mergeExportResources(
      graph,
      this.selectedExportKeys(),
      this.selectedDataResources(),
      this.igExportOptions()
    );
  }

  private async processDataStepBeforeDependencies(): Promise<void> {
    const expansion = this.patientExpansion();
    if (expansion.enabled) {
      const patients = this.selectedDataResources()
        .map((s) => s.resource)
        .filter((r): r is Patient => isResourceType(r, 'Patient'));
      if (patients.length > 0) {
        this.progressMessage.set('Fetching related clinical data for selected patients…');
        try {
          const expanded = await this.dataSearchService.expandPatients(patients, expansion);
          if (expanded.length > 0) {
            this.selectedDataResources.set(
              mergeExportDataSelections(this.selectedDataResources(), expanded)
            );
          }
        } catch (err) {
          throw new Error(
            `Patient expansion failed: ${err instanceof Error ? err.message : String(err)}`
          );
        } finally {
          this.progressMessage.set(null);
        }
      }
    }

    const igOpts = this.igExportOptions();
    for (const sel of this.selectedDataResources()) {
      if (!isResourceType(sel.resource, 'ImplementationGuide')) {
        continue;
      }
      const key = exportDataResourceKey(sel.resource);
      const opts = igOpts[key];
      if (!opts?.resolveReferences) {
        continue;
      }
      this.progressMessage.set('Resolving ImplementationGuide references…');
      try {
        const result = await this.dataSearchService.resolveIgReferences(
          sel.resource,
          new Set(opts.selectedEntryKeys),
          false,
          new Set(opts.selectedGlobalIndices)
        );
        if (result.resolved.length > 0) {
          this.selectedDataResources.set(
            mergeExportDataSelections(this.selectedDataResources(), result.resolved)
          );
        }
        if (result.failures.length > 0) {
          this.toastService.show({
            type: 'warning',
            message: `${result.failures.length} ImplementationGuide reference(s) could not be resolved.`
          });
        }
      } catch (err) {
        throw new Error(
          `ImplementationGuide resolve failed: ${err instanceof Error ? err.message : String(err)}`
        );
      } finally {
        this.progressMessage.set(null);
      }
    }
  }

  private selectedLibraryNodes(graph: ExportDependencyGraph): ExportDependencyNode[] {
    const keys = this.selectedExportKeys();
    return graph.flat.filter(
      (n) =>
        n.kind === 'library' &&
        n.status === 'resolved' &&
        keys.has(n.key) &&
        !!n.resource
    );
  }

  private selectedPrimaryLibraries(graph: ExportDependencyGraph): Library[] {
    return this.selectedLibraryNodes(graph)
      .map((n) => n.resource as Library)
      .filter((lib) => this.isSelectedPrimary(lib));
  }

  private async executeRawCql(graph: ExportDependencyGraph): Promise<void> {
    this.progressMessage.set('Building CQL zip…');
    const files: Record<string, string> = {};
    const usedNames = new Set<string>();
    const keys = this.selectedExportKeys();

    for (const node of graph.flat) {
      if (
        node.kind !== 'library' ||
        node.status !== 'resolved' ||
        !keys.has(node.key) ||
        !node.cqlContent?.trim()
      ) {
        continue;
      }
      const lib = node.resource as Library;
      let base = `${lib.name || lib.id || 'library'}${lib.version ? `-${lib.version}` : ''}`;
      if (usedNames.has(base) && lib.id) {
        base = `${base}-${lib.id}`;
      }
      usedNames.add(base);
      files[`cql/${base}.cql`] = node.cqlContent;
    }

    let vsIndex = 0;
    let csIndex = 0;
    for (const node of graph.flat) {
      if (!keys.has(node.key) || node.status !== 'resolved' || !node.resource) {
        continue;
      }
      if (node.kind === 'valueset') {
        const vs = node.resource as { name?: string; id?: string };
        const name = `${vs.name || vs.id || `ValueSet-${vsIndex}`}.json`;
        files[`terminology/${name}`] = JSON.stringify(node.resource, null, 2);
        vsIndex++;
      } else if (node.kind === 'codesystem') {
        const cs = node.resource as { name?: string; id?: string };
        const name = `${cs.name || cs.id || `CodeSystem-${csIndex}`}.json`;
        files[`terminology/${name}`] = JSON.stringify(node.resource, null, 2);
        csIndex++;
      }
    }

    if (this.includeCompleteBundle()) {
      const resources = this.selectedResources(graph);
      if (resources.length > 0) {
        const completeBundle = buildTransactionBundle(resources);
        files['complete-bundle.json'] = JSON.stringify(completeBundle, null, 2);
      }
    }

    for (const sel of this.selectedDataResources()) {
      const resource = applyIgSanitizeIfConfigured(sel.resource, this.igExportOptions());
      const rt = resourceTypeOf(resource) ?? 'Resource';
      const id = (resource as { id?: string }).id ?? 'unknown';
      const safeId = id.replace(/[^A-Za-z0-9._-]+/g, '_');
      files[`data/${rt}/${safeId}.json`] = JSON.stringify(resource, null, 2);
    }

    if (Object.keys(files).length === 0) {
      throw new Error('No selected content available to export.');
    }
    const zip = this.archiveService.createZip(files);
    downloadBytes(zip, 'cql-export.zip', 'application/zip');
    this.toastService.show({ type: 'success', message: 'Downloaded CQL dependency zip.' });
    const outcomes = [`Downloaded ${Object.keys(files).length} files.`];
    if (files['complete-bundle.json']) {
      outcomes.push('Included complete-bundle.json (transaction Bundle with PUT).');
    }
    this.lastOutcomes.set(outcomes);
  }

  private executeFhirPackage(graph: ExportDependencyGraph): void {
    this.progressMessage.set('Building FHIR NPM package…');
    const pkg = buildFhirPackageJson(this.manifestInput());
    const resources = this.selectedResources(graph);
    const { tgz } = this.archiveService.createFhirPackageTgz(pkg, resources);
    downloadBytes(tgz, `${pkg.name}-${pkg.version}.tgz`, 'application/gzip');
    this.toastService.show({ type: 'success', message: 'Downloaded FHIR NPM package.' });
    this.lastOutcomes.set([`Downloaded ${pkg.name}@${pkg.version} (${resources.length} resources).`]);
  }

  private async executeFhirServer(graph: ExportDependencyGraph): Promise<void> {
    this.progressMessage.set('Copying to target environment…');
    const target = this.resolvePublishTarget();
    const resources = this.selectedResources(graph);
    const roots = this.selectedPrimaryLibraries(graph);
    if (this.conditionalCreate() && roots.length === 0) {
      throw new Error(
        'Select at least one root library in the dependency table for conditional-create copy.'
      );
    }

    let outcomes;
    if (this.conditionalCreate()) {
      const rootKeys = new Set(roots.map((l) => libraryIdentityKey(l)));
      const deps = resources.filter((r) => {
        if (resourceTypeOf(r) !== 'Library') {
          return true;
        }
        return !rootKeys.has(libraryIdentityKey(r as Library));
      });
      const bundle = this.crmiPackageService.buildArtifactBundle(roots, deps, {
        bundleType: 'transaction',
        conditionalCreate: true,
        packageName: this.packageName(),
        packageVersion: this.packageVersion()
      });
      outcomes = await this.publishService.publishBundle(bundle, target, (m) =>
        this.progressMessage.set(m)
      );
    } else {
      outcomes = await this.publishService.publishResources(resources, target, (m) =>
        this.progressMessage.set(m)
      );
    }
    this.lastOutcomes.set(outcomes.map((o) => o.message));
    const ok = outcomes.every((o) => o.success);
    this.toastService.show({
      type: ok ? 'success' : 'error',
      message: ok ? 'Copy completed.' : 'Copy completed with errors.'
    });
  }

  private async executeCrmi(graph: ExportDependencyGraph): Promise<void> {
    const resources = this.selectedResources(graph);
    const roots = this.selectedPrimaryLibraries(graph);
    if (roots.length === 0) {
      throw new Error(
        'Select at least one root library in the dependency table for CRMI packaging.'
      );
    }
    const rootKeys = new Set(roots.map((l) => libraryIdentityKey(l)));
    const deps = resources.filter((r) => {
      if (resourceTypeOf(r) !== 'Library') {
        return true;
      }
      return !rootKeys.has(libraryIdentityKey(r as Library));
    });

    const action = this.crmiAction();
    const bundleType = action === 'publish' ? 'transaction' : this.crmiBundleType();
    const conditionalCreate = action === 'download-bundle' ? false : this.conditionalCreate();

    const bundle = this.crmiPackageService.buildArtifactBundle(roots, deps, {
      bundleType,
      conditionalCreate,
      packageName: this.packageName(),
      packageVersion: this.packageVersion()
    });

    if (action === 'download-bundle') {
      downloadJson(bundle, 'crmi-artifact-bundle.json');
      this.toastService.show({ type: 'success', message: 'Downloaded CRMI artifact Bundle.' });
      this.lastOutcomes.set([`Bundle type ${bundle.type} with ${bundle.entry?.length ?? 0} entries.`]);
      return;
    }
    if (action === 'download-tgz') {
      this.executeFhirPackage(graph);
      return;
    }

    this.progressMessage.set('Copying CRMI package to target environment…');
    const target = this.resolvePublishTarget();
    const outcomes = await this.publishService.publishBundle(bundle, target, (m) =>
      this.progressMessage.set(m)
    );
    this.lastOutcomes.set(outcomes.map((o) => o.message));
    const ok = outcomes.every((o) => o.success);
    this.toastService.show({
      type: ok ? 'success' : 'error',
      message: ok ? 'CRMI copy completed.' : 'CRMI copy completed with errors.'
    });
  }

  private resolvePublishTarget(): ExportPublishTarget {
    const key = this.publishTargetKey().trim();
    const env = this.environmentService.resolveEnvironmentByPublishKey(key);
    if (!env) {
      throw new Error('Select a target environment profile before copying.');
    }
    const fhirHeaders = {
      'Content-Type': 'application/fhir+json',
      Accept: 'application/fhir+json'
    };
    return {
      data: this.environmentService.getEndpointHttpContextForEnvironment(env, 'data', fhirHeaders),
      terminology: this.environmentService.getEndpointHttpContextForEnvironment(
        env,
        'terminology',
        fhirHeaders
      )
    };
  }

  private manifestInput(): FhirPackageManifestInput {
    const syncIg = primaryIgForManifestSync(
      this.selectedDataResources(),
      this.igExportOptions()
    );
    if (syncIg) {
      const fromIg = buildFhirPackageManifestFromIg(syncIg);
      return {
        ...fromIg,
        name: this.packageName() || fromIg.name,
        version: this.packageVersion() || fromIg.version,
        author: this.packageAuthor() || fromIg.author,
        description: this.packageDescription() || fromIg.description,
        title: this.packageTitle() || fromIg.title
      };
    }
    return {
      name: this.packageName(),
      version: this.packageVersion(),
      author: this.packageAuthor(),
      description: this.packageDescription(),
      title: this.packageTitle() || undefined,
      type: 'Conformance',
      dependencies: {
        [DEFAULT_FHIR_CORE_PACKAGE]: DEFAULT_FHIR_CORE_VERSION
      }
    };
  }

  private prefillPackageFields(): void {
    const syncIg = primaryIgForManifestSync(
      this.selectedDataResources(),
      this.igExportOptions()
    );
    if (syncIg) {
      const fromIg = buildFhirPackageManifestFromIg(syncIg);
      // Only fill empty fields so returning to Confirm doesn't wipe user edits.
      if (!this.packageName().trim() || this.packageName() === 'org.example.cql-export') {
        this.packageName.set(fromIg.name);
      }
      if (!this.packageVersion().trim() || this.packageVersion() === '0.1.0') {
        this.packageVersion.set(fromIg.version);
      }
      if (!this.packageAuthor().trim() && fromIg.author) {
        this.packageAuthor.set(fromIg.author);
      }
      if (!this.packageDescription().trim() && fromIg.description) {
        this.packageDescription.set(fromIg.description);
      }
      if (!this.packageTitle().trim() && fromIg.title) {
        this.packageTitle.set(fromIg.title);
      }
      return;
    }
    const primary = this.selectedLibraries()[0];
    if (primary && !this.packageDescription().trim()) {
      this.packageDescription.set(
        primary.description || primary.title || primary.name || 'CQL Studio library export'
      );
    }
    if (primary && !this.packageTitle().trim()) {
      this.packageTitle.set(primary.title || primary.name || '');
    }
  }

  private isSelectedPrimary(lib: Library): boolean {
    return this.selectedLibraries().some((s) => sameLibrary(s, lib));
  }
}
