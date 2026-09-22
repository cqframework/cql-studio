// Author: Preston Lee

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Bundle, ImplementationGuide, Library, OperationOutcome, Parameters, RelatedArtifact, Resource } from 'fhir/r4';
import { downloadJson } from '../../services/download-blob.lib';
import {
  CrmiApiService,
  fhirParameters,
  outcomeIssues,
  terminologyEndpointParameter,
  type CrmiIssue
} from '../../services/crmi-api.service';
import { memberSearchAttempts } from '../../services/implementation-guide-editor.lib';
import { SettingsService } from '../../services/settings.service';

const RESOURCE_TYPES = [
  'Library',
  'Measure',
  'PlanDefinition',
  'ActivityDefinition',
  'Questionnaire',
  'ValueSet',
  'CodeSystem',
  'ConceptMap',
  'NamingSystem',
  'ImplementationGuide'
] as const;

const ARTIFACT_IS_OWNED = 'http://hl7.org/fhir/StructureDefinition/artifact-isOwned';

type CrmiTab = 'package' | 'ownership' | 'lifecycle';
type ResourceTypeName = (typeof RESOURCE_TYPES)[number];

interface ArtifactRow {
  key: string;
  resource: Resource;
  label: string;
  detail: string;
}

interface OwnedRef {
  type?: string;
  url: string;
  version?: string;
}

interface OwnedFamilyNode {
  depth: number;
  label: string;
  detail: string;
  resolved: boolean;
}

interface OwnedLink {
  index: number;
  canonical: string;
  display: string;
}

interface AuthoringRow {
  resourceType: string;
  id: string;
  url: string;
  version: string;
}

@Component({
  selector: 'app-crmi',
  imports: [FormsModule, RouterLink],
  templateUrl: './crmi.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CrmiComponent {
  private readonly api = inject(CrmiApiService);
  private readonly settings = inject(SettingsService);
  private readonly http = inject(HttpClient);
  private familyRequest = 0;
  private draftedKey: string | null = null;

  readonly resourceTypes = RESOURCE_TYPES;
  readonly activeTab = signal<CrmiTab>('package');
  readonly resourceType = signal<ResourceTypeName>('Library');
  readonly query = signal('');
  readonly searching = signal(false);
  readonly searchError = signal<string | null>(null);
  readonly results = signal<ArtifactRow[]>([]);
  readonly selectedKeys = signal<ReadonlySet<string>>(new Set());

  readonly capability = signal<'computable' | 'executable' | 'publishable'>('computable');
  readonly bundleType = signal<'transaction' | 'collection'>('transaction');
  readonly errorBehavior = signal<'loose' | 'strict'>('loose');
  readonly include = signal('all');
  readonly exclude = signal('');
  readonly manifest = signal('');
  readonly packageOnly = signal(false);
  readonly publishGuideMode = signal<'minimal' | 'existing'>('minimal');
  readonly guides = signal<ArtifactRow[]>([]);
  readonly guidesError = signal<string | null>(null);
  readonly guidesLoading = signal(false);
  readonly selectedGuideKey = signal('');

  readonly draftVersion = signal('2.0.0');
  readonly cloneUrl = signal('');
  readonly cloneVersion = signal('1.0.0');
  readonly releaseVersion = signal('1.0.0');
  readonly versionBehavior = signal<'default' | 'check' | 'force'>('default');
  readonly releaseDate = signal('');
  readonly requireVersionSpecific = signal(false);
  readonly requireActive = signal(false);

  readonly busy = signal(false);
  readonly statusMessage = signal<string | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly packageBundle = signal<Bundle | null>(null);
  readonly packageIssues = signal<CrmiIssue[]>([]);
  readonly requirements = signal<Library | null>(null);
  readonly licenseGroups = signal<Array<{ name: string; lines: string[] }>>([]);
  readonly authoringBundle = signal<Bundle | null>(null);

  readonly parentDraft = signal<Resource | null>(null);
  readonly ownedFamily = signal<OwnedFamilyNode[]>([]);
  readonly familyLoading = signal(false);
  readonly familyError = signal<string | null>(null);
  readonly attachType = signal<ResourceTypeName>('Library');
  readonly attachQuery = signal('');
  readonly attachSearching = signal(false);
  readonly attachError = signal<string | null>(null);
  readonly attachResults = signal<ArtifactRow[]>([]);

  readonly selected = computed(() => this.results().filter((row) => this.selectedKeys().has(row.key)));
  readonly ownedLinks = computed(() => ownedLinksOf(this.parentDraft()));
  readonly authoringRows = computed(() => authoringRowsOf(this.authoringBundle()));
  readonly selectedGuide = computed(() => this.guides().find((row) => row.key === this.selectedGuideKey())?.resource as ImplementationGuide | undefined);

  setTab(tab: CrmiTab): void {
    this.activeTab.set(tab);
    if (tab === 'ownership') {
      this.ensureOwnershipDraft();
      void this.refreshOwnedFamily(this.parentDraft());
    } else if (tab === 'lifecycle') {
      void this.refreshOwnedFamily(this.savedSelection());
    }
  }

  async search(): Promise<void> {
    this.searching.set(true);
    this.searchError.set(null);
    try {
      const rows = await this.searchResources(this.resourceType(), this.query());
      this.results.set(rows);
      this.selectedKeys.set(new Set());
      this.clearOwnershipDraft();
    } catch (err) {
      this.results.set([]);
      this.searchError.set(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      this.searching.set(false);
    }
  }

  toggle(key: string, event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }
    const next = new Set(this.selectedKeys());
    if (input.checked) {
      next.add(key);
    } else {
      next.delete(key);
    }
    this.selectedKeys.set(next);
    this.clearOwnershipDraft();
    if (this.activeTab() === 'ownership') {
      this.ensureOwnershipDraft();
      void this.refreshOwnedFamily(this.parentDraft());
    } else if (this.activeTab() === 'lifecycle') {
      void this.refreshOwnedFamily(this.savedSelection());
    }
  }

  setPublishGuideMode(mode: 'minimal' | 'existing'): void {
    this.publishGuideMode.set(mode);
    if (mode === 'existing' && this.guides().length === 0) {
      void this.loadGuides();
    }
  }

  async loadGuides(): Promise<void> {
    this.guidesLoading.set(true);
    this.guidesError.set(null);
    try {
      const rows = await this.searchResources('ImplementationGuide', '');
      this.guides.set(rows);
      if (!rows.some((row) => row.key === this.selectedGuideKey())) {
        this.selectedGuideKey.set(rows[0]?.key ?? '');
      }
      if (!rows.length) {
        this.guidesError.set('No ImplementationGuide resources were found on the content endpoint.');
      }
    } catch (err) {
      this.guides.set([]);
      this.selectedGuideKey.set('');
      this.guidesError.set(err instanceof Error ? err.message : 'Could not load ImplementationGuide resources.');
    } finally {
      this.guidesLoading.set(false);
    }
  }

  async package(): Promise<void> {
    await this.run(async () => {
      const selected = this.selected();
      if (selected.length === 0) {
        throw new Error('Select at least one artifact.');
      }
      const parts = this.packageParts();
      const body = fhirParameters(parts);
      let bundle: Bundle;
      let note: string | undefined;
      if (selected.length === 1) {
        const resource = selected[0].resource;
        if (!resource.id) {
          throw new Error('The selected artifact has no id.');
        }
        const result = await this.api.postOperation(
          `/${resource.resourceType}/${encodeURIComponent(resource.id)}/$package`,
          body
        );
        if (result.resourceType !== 'Bundle') {
          throw new Error('Package did not return a Bundle.');
        }
        bundle = result as Bundle;
      } else {
        const packages: Bundle[] = [];
        for (const row of selected) {
          if (!row.resource.id) {
            throw new Error(`${labelOf(row.resource)} has no id.`);
          }
          const result = await this.api.postOperation(
            `/${row.resource.resourceType}/${encodeURIComponent(row.resource.id)}/$package`,
            body
          );
          if (result.resourceType !== 'Bundle') {
            throw new Error('Package did not return a Bundle.');
          }
          packages.push(result as Bundle);
        }
        bundle = mergePackageBundles(packages, this.bundleType());
        note = `Merged ${packages.length} packages without creating a server-side asset-collection.`;
      }
      this.packageBundle.set(bundle);
      this.packageIssues.set(outcomeIssues(bundle));
      this.statusMessage.set(
        note
          ? `${note} Package has ${bundle.entry?.length ?? 0} entries.`
          : `Package has ${bundle.entry?.length ?? 0} entries.`
      );
    });
  }

  downloadPackage(): void {
    const bundle = this.packageBundle();
    if (!bundle) {
      return;
    }
    downloadJson(bundle, 'crmi-package.json');
  }

  async dataRequirements(): Promise<void> {
    await this.run(async () => {
      const target = await this.singleOrEphemeralTarget();
      try {
        const result = await this.api.postOperation(
          `/${target.type}/${encodeURIComponent(target.id)}/$data-requirements`,
          fhirParameters(this.endpointParts())
        );
        if (result.resourceType !== 'Library') {
          throw new Error('Data requirements did not return a Library.');
        }
        this.requirements.set(result as Library);
        this.statusMessage.set(target.note ? `${target.note} Loaded data requirements.` : 'Loaded data requirements.');
      } finally {
        await this.cleanupEphemeral(target);
      }
    });
  }

  async licenseRequirements(): Promise<void> {
    await this.run(async () => {
      const target = await this.singleOrEphemeralTarget();
      try {
        const result = await this.api.postOperation(
          `/${target.type}/${encodeURIComponent(target.id)}/$crmi.license-requirements`,
          fhirParameters(this.endpointParts())
        );
        if (result.resourceType !== 'Parameters') {
          throw new Error('License requirements did not return Parameters.');
        }
        const groups = ((result as Parameters).parameter ?? []).map((group) => ({
          name: group.name ?? 'artifact',
          lines: (group.part ?? []).map((part) => {
            const value = part.valueCode || part.valueString || part.valueMarkdown || part.valueCanonical || '';
            return `${part.name}: ${value}`;
          })
        }));
        this.licenseGroups.set(groups);
        const summary = `License requirements for ${groups.length} artifact(s).`;
        this.statusMessage.set(target.note ? `${target.note} ${summary}` : summary);
      } finally {
        await this.cleanupEphemeral(target);
      }
    });
  }

  async publish(): Promise<void> {
    await this.run(async () => {
      const existing = this.packageBundle();
      if (!existing?.entry?.length) {
        throw new Error('Package an artifact before publishing.');
      }
      const selected = this.publishGuideMode() === 'existing' ? this.selectedGuide() : undefined;
      if (this.publishGuideMode() === 'existing' && !selected) {
        throw new Error('Select an ImplementationGuide, or publish with a minimal guide.');
      }
      const { bundle, guideSource } = toPublishableBundle(existing, selected);
      const result = await this.api.postOperation('/$publish', bundle);
      const guideName = selected ? labelOf(selected) : '';
      this.statusMessage.set(
        guideSource === 'existing'
          ? `Published using ImplementationGuide ${guideName}.`
          : guideSource === 'minimal'
            ? 'Added a minimal ImplementationGuide as the first entry, then published the bundle.'
            : 'Published the bundle.'
      );
      if (result.resourceType === 'Bundle') {
        this.authoringBundle.set(result as Bundle);
      }
    });
  }

  async searchAttach(): Promise<void> {
    this.attachSearching.set(true);
    this.attachError.set(null);
    try {
      this.attachResults.set(await this.searchResources(this.attachType(), this.attachQuery()));
    } catch (err) {
      this.attachResults.set([]);
      this.attachError.set(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      this.attachSearching.set(false);
    }
  }

  attachOwned(row: ArtifactRow): void {
    const canon = canonical(row.resource);
    if (!canon) {
      this.errorMessage.set('The artifact needs a canonical url before it can be owned.');
      return;
    }
    const draft = this.parentDraft();
    if (!draft) {
      this.errorMessage.set('Select one artifact above.');
      return;
    }
    const existing = ownedLinksOf(draft).some((link) => link.canonical === canon);
    if (existing) {
      this.statusMessage.set(`${labelOf(row.resource)} is already an owned component.`);
      return;
    }
    const copy = structuredClone(draft) as Resource & { relatedArtifact?: RelatedArtifact[] };
    const link: RelatedArtifact = {
      type: 'composed-of',
      display: labelOf(row.resource),
      resource: canon,
      extension: [{ url: ARTIFACT_IS_OWNED, valueBoolean: true }]
    };
    copy.relatedArtifact = [...(copy.relatedArtifact ?? []), link];
    this.parentDraft.set(copy);
    this.errorMessage.set(null);
    this.statusMessage.set(`Added ${labelOf(row.resource)}. Save to write the parent.`);
    void this.refreshOwnedFamily(copy);
  }

  detachOwned(index: number): void {
    const draft = this.parentDraft();
    if (!draft) {
      return;
    }
    const copy = structuredClone(draft) as Resource & { relatedArtifact?: RelatedArtifact[] };
    copy.relatedArtifact = (copy.relatedArtifact ?? []).filter((_, i) => i !== index);
    if (!copy.relatedArtifact.length) {
      delete copy.relatedArtifact;
    }
    this.parentDraft.set(copy);
    this.statusMessage.set('Removed the owned link. Save to write the parent.');
    void this.refreshOwnedFamily(copy);
  }

  async saveOwnership(): Promise<void> {
    await this.run(async () => {
      const draft = this.parentDraft();
      if (!draft?.id) {
        throw new Error('Select one artifact with an id.');
      }
      const saved = await this.writeContent(draft);
      const key = this.selected()[0]?.key;
      if (key) {
        this.results.update((rows) => rows.map((row) => (row.key === key ? { ...row, resource: saved } : row)));
      }
      const next = structuredClone(saved);
      this.parentDraft.set(next);
      await this.refreshOwnedFamily(next);
      this.statusMessage.set('Saved owned components on the parent artifact.');
    });
  }

  async draft(): Promise<void> {
    await this.author('draft', [{ name: 'version', value: this.draftVersion().trim() }]);
  }

  async clone(): Promise<void> {
    await this.author('clone', [
      { name: 'url', value: this.cloneUrl().trim() },
      { name: 'version', value: this.cloneVersion().trim() }
    ]);
  }

  async release(): Promise<void> {
    const parts: Array<{ name: string; value?: string; code?: string; flag?: boolean }> = [
      { name: 'version', value: this.releaseVersion().trim() },
      { name: 'versionBehavior', code: this.versionBehavior() },
      { name: 'requireVersionSpecificReferences', flag: this.requireVersionSpecific() },
      { name: 'requireActiveReferences', flag: this.requireActive() }
    ];
    const date = this.releaseDate().trim();
    if (date) {
      parts.push({ name: 'releaseDate', value: date });
    }
    await this.author('release', parts);
  }

  async review(): Promise<void> {
    await this.author('review', []);
  }

  async approve(): Promise<void> {
    await this.author('approve', []);
  }

  private async author(
    operation: string,
    parts: Array<{ name: string; value?: string; code?: string; flag?: boolean }>
  ): Promise<void> {
    await this.run(async () => {
      const target = this.singleTarget();
      const result = await this.api.postOperation(
        `/${target.resourceType}/${encodeURIComponent(target.id!)}/$${operation}`,
        fhirParameters(parts)
      );
      if (result.resourceType === 'Bundle') {
        const bundle = result as Bundle;
        this.authoringBundle.set(bundle);
        this.statusMessage.set(`${operation} returned ${bundle.entry?.length ?? 0} resources.`);
      } else {
        this.statusMessage.set(`${operation} completed.`);
      }
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.errorMessage.set(null);
    this.statusMessage.set(null);
    try {
      await action();
    } catch (err) {
      this.errorMessage.set(err instanceof Error ? err.message : 'CRMI operation failed.');
    } finally {
      this.busy.set(false);
    }
  }

  private singleTarget(): Resource & { id: string } {
    const selected = this.selected();
    if (selected.length !== 1) {
      throw new Error('Select one artifact.');
    }
    const resource = selected[0].resource;
    if (!resource.id) {
      throw new Error('The selected artifact has no id.');
    }
    return resource as Resource & { id: string };
  }

  private async singleOrEphemeralTarget(): Promise<{
    type: string;
    id: string;
    note?: string;
    ephemeral?: boolean;
  }> {
    const selected = this.selected();
    if (selected.length === 0) {
      throw new Error('Select at least one artifact.');
    }
    if (selected.length === 1) {
      const resource = selected[0].resource;
      if (!resource.id) {
        throw new Error('The selected artifact has no id.');
      }
      return { type: resource.resourceType, id: resource.id };
    }
    const created = await this.createAssetCollection(selected.map((row) => row.resource));
    if (!created.id) {
      throw new Error('The asset-collection Library was created without an id.');
    }
    return {
      type: 'Library',
      id: created.id,
      ephemeral: true,
      note: `Used temporary asset-collection ${created.url ?? created.id}.`
    };
  }

  private async cleanupEphemeral(target: { type: string; id: string; ephemeral?: boolean }): Promise<void> {
    if (!target.ephemeral) {
      return;
    }
    try {
      const ctx = this.contentContext();
      await firstValueFrom(
        this.http.delete(`${ctx.base}/${target.type}/${encodeURIComponent(target.id)}`, {
          headers: new HttpHeaders(ctx.headers)
        })
      );
    } catch {
      // Best-effort cleanup of the temporary collection.
    }
  }

  private async createAssetCollection(resources: Resource[]): Promise<Library> {
    const missing = resources.filter((resource) => !canonical(resource));
    if (missing.length) {
      throw new Error('Every selected artifact needs a canonical url before it can be collected.');
    }
    const name = `crmi-asset-collection-${Date.now()}`;
    const library: Library = {
      resourceType: 'Library',
      url: `http://cql-studio.local/Library/${name}`,
      version: '0.0.0',
      name,
      status: 'active',
      type: {
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/library-type',
          code: 'asset-collection',
          display: 'Asset Collection'
        }]
      },
      relatedArtifact: resources.map((resource) => ({
        type: 'composed-of',
        display: labelOf(resource),
        resource: canonical(resource)
      }))
    };
    const ctx = this.contentContext({ 'Content-Type': 'application/fhir+json' });
    return firstValueFrom(
      this.http.post<Library>(`${ctx.base}/Library`, library, { headers: new HttpHeaders(ctx.headers) })
    );
  }

  private packageParts(): Array<{ name: string; value?: string; code?: string; flag?: boolean; resource?: Resource }> {
    const parts: Array<{ name: string; value?: string; code?: string; flag?: boolean; resource?: Resource }> = [
      { name: 'capability', code: this.capability() },
      { name: 'bundleType', code: this.bundleType() },
      { name: 'errorBehavior', code: this.errorBehavior() },
      { name: 'include', code: this.include() },
      { name: 'packageOnly', flag: this.packageOnly() },
      ...this.endpointParts()
    ];
    const exclude = this.exclude().trim();
    if (exclude) {
      parts.push({ name: 'exclude', code: exclude });
    }
    const manifest = this.manifest().trim();
    if (manifest) {
      parts.push({ name: 'manifest', value: manifest });
    }
    return parts;
  }

  private endpointParts(): Array<{ name: string; resource: Resource }> {
    const content = this.settings.getEndpointHttpContext('content');
    const terminology = this.settings.getEndpointHttpContext('terminology');
    const endpoint = terminologyEndpointParameter(content.address, terminology.address);
    return endpoint ? [{ name: 'terminologyEndpoint', resource: endpoint }] : [];
  }

  private async searchResources(type: string, term: string): Promise<ArtifactRow[]> {
    const ctx = this.contentContext();
    const attempts = memberSearchAttempts(type, term);
    let last: Bundle = { resourceType: 'Bundle', type: 'searchset' };
    let lastError: unknown;
    let succeeded = false;
    for (const params of attempts) {
      try {
        const search = new URLSearchParams(params);
        last = await firstValueFrom(
          this.http.get<Bundle>(`${ctx.base}/${type}?${search.toString()}`, {
            headers: new HttpHeaders(ctx.headers)
          })
        );
        succeeded = true;
        if ((last.entry ?? []).some((entry) => entry.resource) || attempts.length === 1) {
          break;
        }
      } catch (err) {
        lastError = err;
      }
    }
    if (!succeeded && lastError) {
      throw lastError;
    }
    const seen = new Set<string>();
    return (last.entry ?? [])
      .map((entry) => entry.resource)
      .filter((resource): resource is Resource => !!resource)
      .map((resource) => this.toRow(resource))
      .filter((row) => {
        if (seen.has(row.key)) {
          return false;
        }
        seen.add(row.key);
        return true;
      });
  }

  private contentContext(extra?: Record<string, string>): { base: string; headers: Record<string, string> } {
    const ctx = this.settings.getEndpointHttpContext('content', {
      Accept: 'application/fhir+json',
      ...extra
    });
    const base = ctx.address.replace(/\/+$/, '');
    if (!base) {
      throw new Error('The active environment has no content endpoint.');
    }
    return { base, headers: ctx.headers };
  }

  private async writeContent(resource: Resource): Promise<Resource> {
    if (!resource.id) {
      throw new Error('Select one artifact with an id.');
    }
    const ctx = this.contentContext({ 'Content-Type': 'application/fhir+json' });
    return firstValueFrom(
      this.http.put<Resource>(
        `${ctx.base}/${resource.resourceType}/${encodeURIComponent(resource.id)}`,
        resource,
        { headers: new HttpHeaders(ctx.headers) }
      )
    );
  }

  private ensureOwnershipDraft(): void {
    const selected = this.selected();
    if (selected.length !== 1) {
      this.clearOwnershipDraft();
      return;
    }
    if (this.draftedKey === selected[0].key && this.parentDraft()) {
      return;
    }
    this.parentDraft.set(structuredClone(selected[0].resource));
    this.draftedKey = selected[0].key;
  }

  private clearOwnershipDraft(): void {
    this.parentDraft.set(null);
    this.draftedKey = null;
    this.ownedFamily.set([]);
    this.familyError.set(null);
  }

  private savedSelection(): Resource | null {
    const selected = this.selected();
    return selected.length === 1 ? selected[0].resource : null;
  }

  private async refreshOwnedFamily(root: Resource | null): Promise<void> {
    const request = ++this.familyRequest;
    if (!root) {
      this.ownedFamily.set([]);
      this.familyLoading.set(false);
      this.familyError.set(null);
      return;
    }
    this.familyLoading.set(true);
    this.familyError.set(null);
    try {
      const nodes = await this.walkOwned(root);
      if (request !== this.familyRequest) {
        return;
      }
      this.ownedFamily.set(nodes);
    } catch (err) {
      if (request !== this.familyRequest) {
        return;
      }
      this.ownedFamily.set([]);
      this.familyError.set(err instanceof Error ? err.message : 'Could not resolve owned components.');
    } finally {
      if (request === this.familyRequest) {
        this.familyLoading.set(false);
      }
    }
  }

  private async walkOwned(root: Resource): Promise<OwnedFamilyNode[]> {
    const nodes: OwnedFamilyNode[] = [{
      depth: 0,
      label: labelOf(root),
      detail: detailOf(root),
      resolved: true
    }];
    const seen = new Set<string>([resourceIdentity(root)]);
    const queue = ownedRefs(root).map((ref) => ({ ref, depth: 1 }));
    while (queue.length) {
      const item = queue.shift()!;
      const refKey = `${item.ref.url}|${item.ref.version ?? ''}`;
      if (seen.has(refKey)) {
        continue;
      }
      seen.add(refKey);
      const child = await this.readCanonical(item.ref);
      if (!child) {
        nodes.push({
          depth: item.depth,
          label: item.ref.url,
          detail: item.ref.version ? `unresolved · ${item.ref.version}` : 'unresolved',
          resolved: false
        });
        continue;
      }
      const childKey = resourceIdentity(child);
      if (!seen.has(childKey)) {
        seen.add(childKey);
        nodes.push({
          depth: item.depth,
          label: labelOf(child),
          detail: detailOf(child),
          resolved: true
        });
        for (const ref of ownedRefs(child)) {
          queue.push({ ref, depth: item.depth + 1 });
        }
      }
    }
    return nodes;
  }

  private async readCanonical(ref: OwnedRef): Promise<Resource | null> {
    const ctx = this.contentContext();
    const type = ref.type ?? guessTypeFromUrl(ref.url) ?? 'Library';
    const params = new URLSearchParams({ url: ref.url, _count: '20' });
    try {
      const bundle = await firstValueFrom(
        this.http.get<Bundle>(`${ctx.base}/${type}?${params.toString()}`, {
          headers: new HttpHeaders(ctx.headers)
        })
      );
      const resources = (bundle.entry ?? [])
        .map((entry) => entry.resource)
        .filter((resource): resource is Resource => !!resource);
      if (ref.version) {
        const match = resources.find((resource) => versionOf(resource) === ref.version);
        if (match) {
          return match;
        }
      }
      return resources.find((resource) => urlOf(resource) === ref.url) ?? resources[0] ?? null;
    } catch {
      return null;
    }
  }

  private toRow(resource: Resource): ArtifactRow {
    return {
      key: `${resource.resourceType}-${resource.id ?? 'noid'}-${versionOf(resource) ?? 'na'}`.replace(/[^A-Za-z0-9_-]+/g, '_'),
      resource,
      label: labelOf(resource),
      detail: detailOf(resource)
    };
  }
}

function labelOf(resource: Resource): string {
  const meta = resource as { title?: string; name?: string; id?: string };
  return meta.title || meta.name || meta.id || resource.resourceType;
}

function canonical(resource: Resource): string | undefined {
  const url = urlOf(resource);
  const version = versionOf(resource);
  if (!url) {
    return undefined;
  }
  return version ? `${url}|${version}` : url;
}

function urlOf(resource: Resource): string | undefined {
  return (resource as { url?: string }).url;
}

function versionOf(resource: Resource): string | undefined {
  return (resource as { version?: string }).version;
}

function detailOf(resource: Resource): string {
  const meta = resource as { status?: string; version?: string; url?: string };
  return [meta.status, meta.version, meta.url].filter(Boolean).join(' · ');
}

function resourceIdentity(resource: Resource): string {
  return `${resource.resourceType}|${resource.id ?? ''}|${urlOf(resource) ?? ''}|${versionOf(resource) ?? ''}`;
}

function isOwnedExtension(url: string | undefined): boolean {
  const value = url ?? '';
  return value.endsWith('artifact-isOwned') || value.endsWith('crmi-owned');
}

function isOwnedComposedOf(artifact: RelatedArtifact): boolean {
  if (artifact.type !== 'composed-of') {
    return false;
  }
  return (artifact.extension ?? []).some((ext) => isOwnedExtension(ext.url) && ext.valueBoolean !== false);
}

function ownedLinksOf(resource: Resource | null): OwnedLink[] {
  if (!resource) {
    return [];
  }
  const related = (resource as { relatedArtifact?: RelatedArtifact[] }).relatedArtifact ?? [];
  return related
    .map((artifact, index) => ({ artifact, index }))
    .filter(({ artifact }) => isOwnedComposedOf(artifact))
    .map(({ artifact, index }) => ({
      index,
      canonical: artifact.resource ?? '',
      display: artifact.display || artifact.resource || 'Owned component'
    }));
}

function ownedRefs(resource: Resource): OwnedRef[] {
  const related = (resource as { relatedArtifact?: RelatedArtifact[] }).relatedArtifact ?? [];
  return related.filter(isOwnedComposedOf).flatMap((artifact) => {
    const parsed = splitCanonical(artifact.resource);
    if (!parsed) {
      return [];
    }
    return [{ type: guessTypeFromUrl(parsed.url), url: parsed.url, version: parsed.version }];
  });
}

function splitCanonical(value: string | undefined): { url: string; version?: string } | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    return null;
  }
  const pipe = trimmed.lastIndexOf('|');
  if (pipe <= 0) {
    return { url: trimmed };
  }
  return { url: trimmed.slice(0, pipe), version: trimmed.slice(pipe + 1) || undefined };
}

function guessTypeFromUrl(url: string): string | undefined {
  const match = /\/(Library|Measure|ValueSet|CodeSystem|PlanDefinition|ActivityDefinition|Questionnaire|ConceptMap|NamingSystem|ImplementationGuide)\//.exec(url);
  return match?.[1];
}

function authoringRowsOf(bundle: Bundle | null): AuthoringRow[] {
  return (bundle?.entry ?? [])
    .map((entry) => entry.resource)
    .filter((resource): resource is Resource => !!resource)
    .map((resource) => ({
      resourceType: resource.resourceType,
      id: resource.id ?? '',
      url: urlOf(resource) ?? '',
      version: versionOf(resource) ?? ''
    }));
}

function toPublishableBundle(
  source: Bundle,
  guide?: ImplementationGuide
): { bundle: Bundle; guideSource: 'existing' | 'minimal' | 'bundle' } {
  const resources = (source.entry ?? []).map((entry) => entry.resource).filter((resource): resource is Resource => !!resource);
  const withoutManifest = resources.filter((resource) => resource.id !== 'crmi-outcome-manifest');
  let guideSource: 'existing' | 'minimal' | 'bundle' = 'bundle';
  let ordered = withoutManifest;
  if (guide) {
    ordered = withoutManifest.filter(
      (resource) => !(guide.id && resource.resourceType === 'ImplementationGuide' && resource.id === guide.id)
    );
    const packageMembers = ordered.filter((resource) => resource.resourceType !== 'ImplementationGuide');
    ordered = [guideWithPackageMembers(guide, packageMembers), ...ordered];
    guideSource = 'existing';
  } else if (ordered[0]?.resourceType !== 'ImplementationGuide') {
    const packageMembers = ordered;
    ordered = [minimalGuide(packageMembers), ...ordered];
    guideSource = 'minimal';
  } else {
    const existingGuide = ordered[0] as ImplementationGuide;
    const packageMembers = ordered.slice(1);
    ordered = [guideWithPackageMembers(existingGuide, packageMembers), ...packageMembers];
  }
  const missingIdentity = ordered.filter(
    (resource) => isCanonicalPublishType(resource.resourceType) && (!urlOf(resource)?.trim() || !versionOf(resource)?.trim())
  );
  if (missingIdentity.length) {
    throw new Error(
      `Publish requires url and version on every canonical resource (missing on ${labelOf(missingIdentity[0])}).`
    );
  }
  return {
    guideSource,
    bundle: {
      resourceType: 'Bundle',
      type: 'transaction',
      entry: ordered.map((resource) => ({
        resource,
        request: conditionalCreate(resource)
      }))
    }
  };
}

function mergePackageBundles(packages: Bundle[], bundleType: 'transaction' | 'collection'): Bundle {
  const seen = new Set<string>();
  const resources: Resource[] = [];
  const issues: CrmiIssue[] = [];
  for (const pkg of packages) {
    for (const issue of outcomeIssues(pkg)) {
      issues.push(issue);
    }
    for (const entry of pkg.entry ?? []) {
      const resource = entry.resource;
      if (!resource || resource.id === 'crmi-outcome-manifest') {
        continue;
      }
      const key = `${resource.resourceType}|${urlOf(resource) ?? ''}|${versionOf(resource) ?? ''}|${resource.id ?? ''}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      resources.push(resource);
    }
  }
  const manifest: Library = {
    resourceType: 'Library',
    id: 'crmi-outcome-manifest',
    status: 'active',
    type: {
      coding: [{
        system: 'http://terminology.hl7.org/CodeSystem/library-type',
        code: 'asset-collection',
        display: 'Asset Collection'
      }]
    },
    relatedArtifact: resources
      .map((resource) => ({
        type: 'composed-of' as const,
        display: labelOf(resource),
        resource: canonical(resource)
      }))
      .filter((artifact): artifact is { type: 'composed-of'; display: string; resource: string } => !!artifact.resource)
  };
  if (issues.length) {
    const outcome: OperationOutcome = {
      resourceType: 'OperationOutcome',
      id: 'issues',
      issue: issues.map((issue) => ({
        severity: (issue.severity as 'error' | 'warning' | 'information' | 'fatal') || 'warning',
        code: 'processing',
        details: { text: issue.text }
      }))
    };
    manifest.contained = [outcome];
  }
  const ordered = [manifest, ...resources];
  return {
    resourceType: 'Bundle',
    type: bundleType,
    timestamp: new Date().toISOString(),
    entry: ordered.map((resource) => {
      if (bundleType !== 'transaction' || resource.id === 'crmi-outcome-manifest') {
        return { resource };
      }
      return { resource, request: conditionalCreate(resource) };
    })
  };
}

function guideWithPackageMembers(guide: ImplementationGuide, packageMembers: Resource[]): ImplementationGuide {
  const copy = structuredClone(guide);
  const existing = new Set(
    (copy.definition?.resource ?? [])
      .map((entry) => entry.reference?.reference?.trim())
      .filter((ref): ref is string => !!ref)
  );
  const additions = packageMembers.flatMap((resource) => {
    const reference = memberReference(resource);
    if (!reference || existing.has(reference)) {
      return [];
    }
    existing.add(reference);
    return [{
      reference: { reference },
      name: labelOf(resource)
    }];
  });
  if (!additions.length) {
    return copy;
  }
  copy.definition = {
    ...(copy.definition ?? { resource: [] }),
    resource: [...(copy.definition?.resource ?? []), ...additions]
  };
  return copy;
}

function memberReference(resource: Resource): string | null {
  const canon = canonical(resource);
  if (canon) {
    // Prefer unversioned canonical for IG.definition members so HAPI can resolve by url.
    return urlOf(resource) ?? canon;
  }
  if (resource.id) {
    return `${resource.resourceType}/${resource.id}`;
  }
  return null;
}

function isCanonicalPublishType(resourceType: string): boolean {
  return RESOURCE_TYPES.includes(resourceType as ResourceTypeName) || resourceType === 'StructureDefinition';
}

function minimalGuide(resources: Resource[]): ImplementationGuide {
  const version = resources.map(versionOf).find((value) => !!value) || '0.0.0';
  const members = resources.flatMap((resource) => {
    const reference = memberReference(resource);
    if (!reference) {
      return [];
    }
    return [{ reference: { reference }, name: labelOf(resource) }];
  });
  return {
    resourceType: 'ImplementationGuide',
    url: 'http://cql-studio.local/ImplementationGuide/crmi-publish',
    version,
    name: 'CrmiPublish',
    status: 'active',
    packageId: 'cql-studio.crmi-publish',
    fhirVersion: ['4.0.1'],
    ...(members.length ? { definition: { resource: members } } : {})
  };
}

function conditionalCreate(resource: Resource): { method: 'POST'; url: string; ifNoneExist: string } {
  const url = urlOf(resource)?.trim() ?? '';
  const version = versionOf(resource)?.trim() ?? '';
  if (!url || !version) {
    throw new Error(`${labelOf(resource)} needs url and version for conditional publish.`);
  }
  return {
    method: 'POST',
    url: resource.resourceType,
    ifNoneExist: `url=${encodeURIComponent(url)}&version=${encodeURIComponent(version)}`
  };
}
