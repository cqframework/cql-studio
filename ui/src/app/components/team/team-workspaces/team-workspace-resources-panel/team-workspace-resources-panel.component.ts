// Author: Preston Lee

import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Bundle, Library, Resource } from 'fhir/r4';
import { WorkspaceService } from '../../../../services/workspace.service';
import { FhirSearchService } from '../../../../services/fhir-search.service';
import { FhirCapabilityService } from '../../../../services/fhir-capability.service';
import { TerminologyService } from '../../../../services/terminology.service';
import {
  buildTextSearchParams,
  resolveBestTextSearchParam,
} from '../../../../services/fhir-text-search.lib';
import {
  displayNameFromFhirResource,
  workspaceLinkInputFromFhirResource,
} from '../../../../services/workspace-resource-link.lib';
import { ToastService } from '../../../../services/toast.service';
import { ClipboardService } from '../../../../services/clipboard.service';
import { CqlIdeLibraryOpenerService } from '../../../../services/cql-ide-library-opener.service';
import { TerminologyResourceOpenerService } from '../../../../services/terminology-resource-opener.service';
import { Workspace, WorkspaceResourceReference } from '../../../../models/team.model';

const RESOURCE_TYPE_OPTIONS = [
  'Library',
  'Measure',
  'PlanDefinition',
  'ActivityDefinition',
  'Questionnaire',
  'ValueSet',
  'CodeSystem',
  'Patient',
  'Bundle',
  'StructureDefinition',
];

@Component({
  selector: 'app-team-workspace-resources-panel',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './team-workspace-resources-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TeamWorkspaceResourcesPanelComponent implements OnInit {
  private readonly workspaceService = inject(WorkspaceService);
  private readonly fhirSearch = inject(FhirSearchService);
  private readonly fhirCapability = inject(FhirCapabilityService);
  private readonly terminologyService = inject(TerminologyService);
  private readonly toast = inject(ToastService);
  private readonly clipboardService = inject(ClipboardService);
  private readonly libraryOpener = inject(CqlIdeLibraryOpenerService);
  private readonly terminologyOpener = inject(TerminologyResourceOpenerService);
  private readonly router = inject(Router);

  readonly workspace = input.required<Workspace>();
  readonly resources = model.required<WorkspaceResourceReference[]>();
  readonly canEdit = input(false);
  readonly changed = output<void>();

  readonly resourceTypeOptions = RESOURCE_TYPE_OPTIONS;

  readonly showRemoveAllResourcesModal = signal(false);
  readonly removingAllResources = signal(false);

  readonly resourceFilter = signal('');
  readonly searchResourceType = signal('Library');
  readonly searchQuery = signal('');
  readonly searchResults = signal<Resource[]>([]);
  readonly searchLoading = signal(false);
  readonly searchError = signal('');
  readonly manualResourceType = signal('Library');
  readonly manualResourceId = signal('');
  readonly manualCanonicalUrl = signal('');
  readonly manualDisplayName = signal('');

  readonly filteredResources = computed(() => {
    const q = this.resourceFilter().trim().toLowerCase();
    const items = this.resources();
    if (!q) {
      return items;
    }
    return items.filter((ref) => {
      const haystack = [
        ref.resourceType,
        ref.resourceId,
        ref.displayName ?? '',
        ref.canonicalUrl ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  });

  readonly manualResourceTypeOptions = computed(() => {
    const types = new Set<string>([
      ...RESOURCE_TYPE_OPTIONS,
      ...this.fhirCapability.resourceTypes(),
    ]);
    const current = this.manualResourceType().trim();
    if (current) {
      types.add(current);
    }
    return Array.from(types).sort((a, b) => a.localeCompare(b));
  });

  readonly searchQueryPlaceholder = computed(() => {
    const type = this.searchResourceType();
    const params = this.fhirCapability.getSearchParamsForType(type);
    const resolved = resolveBestTextSearchParam(type, params);
    return resolved ? `${resolved.label} search` : 'Search';
  });

  constructor() {
    effect(() => {
      this.workspace().id;
      untracked(() => this.closeRemoveAllResourcesModal());
    });
  }

  ngOnInit(): void {
    void this.fhirCapability.ensureMetadataLoaded();
  }

  openRemoveAllResourcesModal(): void {
    if (this.resources().length === 0) {
      return;
    }
    this.showRemoveAllResourcesModal.set(true);
  }

  closeRemoveAllResourcesModal(): void {
    this.showRemoveAllResourcesModal.set(false);
  }

  private async refreshResources(): Promise<void> {
    const list = await this.workspaceService.listResources(this.workspace().id);
    this.resources.set(list);
    this.changed.emit();
  }

  async searchResources(): Promise<void> {
    const resourceType = this.searchResourceType().trim();
    const query = this.searchQuery().trim();
    if (!resourceType) {
      return;
    }
    this.searchLoading.set(true);
    this.searchError.set('');
    try {
      let bundle: Bundle;
      if (
        resourceType === 'ValueSet' ||
        resourceType === 'CodeSystem' ||
        resourceType === 'ConceptMap'
      ) {
        const params: { name?: string; _count: number } = { _count: 20 };
        if (query) {
          params.name = query;
        }
        if (resourceType === 'ValueSet') {
          bundle = await firstValueFrom(this.terminologyService.searchValueSets(params));
        } else if (resourceType === 'CodeSystem') {
          bundle = await firstValueFrom(this.terminologyService.searchCodeSystems(params));
        } else {
          bundle = await firstValueFrom(this.terminologyService.searchConceptMaps(params));
        }
      } else {
        await this.fhirCapability.ensureMetadataLoaded();
        const params = buildTextSearchParams(
          resourceType,
          query,
          this.fhirCapability.getSearchParamsForType(resourceType)
        );
        bundle = await firstValueFrom(
          this.fhirSearch.search(resourceType, params, { count: 20 })
        );
      }
      const results = (bundle.entry ?? [])
        .map((e) => e.resource)
        .filter((r): r is Resource => !!r && !!r.resourceType && !!r.id);
      this.searchResults.set(results);
    } catch (e) {
      this.searchResults.set([]);
      this.searchError.set((e as Error).message || 'FHIR search failed');
    } finally {
      this.searchLoading.set(false);
    }
  }

  async addResourceFromSearch(resource: Resource): Promise<void> {
    const input = workspaceLinkInputFromFhirResource(resource);
    if (!input) {
      return;
    }
    try {
      await this.workspaceService.addResource(this.workspace().id, input);
      await this.refreshResources();
    } catch (e) {
      this.toast.showError((e as Error).message || 'Failed to add resource');
    }
  }

  async addManualResource(): Promise<void> {
    const resourceType = this.manualResourceType().trim();
    const resourceId = this.manualResourceId().trim();
    if (!resourceType || !resourceId) {
      return;
    }
    try {
      await this.workspaceService.addResource(this.workspace().id, {
        resourceType,
        resourceId,
        canonicalUrl: this.manualCanonicalUrl().trim() || null,
        displayName: this.manualDisplayName().trim() || null,
      });
      this.manualResourceId.set('');
      this.manualCanonicalUrl.set('');
      this.manualDisplayName.set('');
      await this.refreshResources();
    } catch (e) {
      this.toast.showError((e as Error).message || 'Failed to add resource');
    }
  }

  async deleteResource(refId: string): Promise<void> {
    try {
      await this.workspaceService.deleteResource(this.workspace().id, refId);
      await this.refreshResources();
    } catch (e) {
      this.toast.showError((e as Error).message || 'Failed to remove resource');
    }
  }

  private resourceStubFromRef(ref: WorkspaceResourceReference): Resource {
    const stub: Record<string, unknown> = {
      resourceType: ref.resourceType,
      id: ref.resourceId,
    };
    if (ref.canonicalUrl) {
      stub['url'] = ref.canonicalUrl;
    }
    if (ref.displayName) {
      stub['name'] = ref.displayName;
      stub['title'] = ref.displayName;
    }
    return stub as unknown as Resource;
  }

  addResourceToClipboard(ref: WorkspaceResourceReference): void {
    try {
      this.clipboardService.addResource(this.resourceStubFromRef(ref));
      this.toast.showSuccess(
        `${ref.resourceType}/${ref.resourceId} added to clipboard.`,
        'Clipboard Updated'
      );
    } catch (e) {
      this.toast.showError((e as Error).message || 'Failed to add to clipboard.', 'Clipboard Error');
    }
  }

  addAllResourcesToClipboard(): void {
    const items = this.resources();
    if (items.length === 0) {
      return;
    }
    try {
      for (const ref of items) {
        this.clipboardService.addResource(this.resourceStubFromRef(ref));
      }
      this.toast.showSuccess(
        `${items.length} resource reference${items.length === 1 ? '' : 's'} added to clipboard.`,
        'Clipboard Updated'
      );
    } catch (e) {
      this.toast.showError((e as Error).message || 'Failed to add to clipboard.', 'Clipboard Error');
    }
  }

  async confirmRemoveAllResources(): Promise<void> {
    const ws = this.workspace();
    const items = this.resources();
    if (items.length === 0) {
      this.closeRemoveAllResourcesModal();
      return;
    }
    this.removingAllResources.set(true);
    try {
      for (const ref of items) {
        await this.workspaceService.deleteResource(ws.id, ref.id);
      }
      await this.refreshResources();
      this.closeRemoveAllResourcesModal();
      this.toast.showSuccess(
        `Removed ${items.length} resource reference${items.length === 1 ? '' : 's'}.`,
        'Resources Cleared'
      );
    } catch (e) {
      try {
        this.resources.set(await this.workspaceService.listResources(ws.id));
      } catch {
        /* keep current */
      }
      this.changed.emit();
      this.toast.showError((e as Error).message || 'Failed to remove all resources');
      this.closeRemoveAllResourcesModal();
    } finally {
      this.removingAllResources.set(false);
    }
  }

  async openLibraryInIde(ref: WorkspaceResourceReference): Promise<void> {
    if (ref.resourceType !== 'Library' || !ref.resourceId.trim()) {
      this.toast.showError('Library reference is missing an id.', 'Open Failed');
      return;
    }
    const library = {
      resourceType: 'Library',
      id: ref.resourceId,
      status: 'active',
      type: { text: 'logic-library' },
      ...(ref.canonicalUrl ? { url: ref.canonicalUrl } : {}),
      ...(ref.displayName ? { name: ref.displayName, title: ref.displayName } : {}),
    } as Library;
    const workspace = this.workspace();
    this.libraryOpener.requestOpenFromServer(library, {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      resourceReferenceId: ref.id,
      role: workspace.myRole,
    });
    const navigated = await this.router.navigate(['/ide']);
    if (!navigated) {
      this.libraryOpener.clearPendingOpen();
      this.toast.showError('Could not navigate to the CQL IDE.', 'Open Failed');
    }
  }

  async openTerminologyResource(ref: WorkspaceResourceReference): Promise<void> {
    if (
      ref.resourceType !== 'ValueSet' &&
      ref.resourceType !== 'CodeSystem' &&
      ref.resourceType !== 'ConceptMap'
    ) {
      return;
    }
    if (!ref.resourceId.trim()) {
      this.toast.showError(`${ref.resourceType} reference is missing an id.`, 'Open Failed');
      return;
    }
    const ok = await this.terminologyOpener.requestOpen({
      resourceType: ref.resourceType,
      id: ref.resourceId,
      url: ref.canonicalUrl ?? undefined,
    });
    if (!ok) {
      this.toast.showError(`Could not open ${ref.resourceType} in terminology browser.`, 'Open Failed');
    }
  }

  resourceLabel(resource: Resource): string {
    return displayNameFromFhirResource(resource) ?? 'Untitled';
  }
}
