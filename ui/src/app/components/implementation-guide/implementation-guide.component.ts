// Author: Preston Lee

import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { Bundle, ImplementationGuide, Resource } from 'fhir/r4';
import { describeFhirHttpFailure } from '../../services/fhir-http-error.lib';
import { FhirEndpointRole } from '../../services/fhir-resource-endpoint.lib';
import {
  FHIR_VERSION_CHOICES,
  GUIDE_RESOURCE_TYPES,
  GUIDE_STATUSES,
  GuideDependencyDraft,
  GuideDraft,
  GuideMemberDraft,
  GuideResourceType,
  GuideStatus,
  applyGuideEdits,
  dependenciesFromGuide,
  fhirVersionOptions,
  guideDomId,
  guideSearchAttempts,
  isGuideStatus,
  memberEndpointRoles,
  memberReferenceFor,
  memberSearchAttempts,
  membersFromGuide,
  nextBundleUrl
} from '../../services/implementation-guide-editor.lib';
import { SettingsService } from '../../services/settings.service';

interface GuideListItem {
  key: string;
  label: string;
  resource: ImplementationGuide;
}

interface ArtifactRow {
  key: string;
  label: string;
  detail: string;
  reference: string;
  resource: Resource;
}

@Component({
  selector: 'app-implementation-guide',
  imports: [FormsModule],
  templateUrl: './implementation-guide.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onDeleteModalEscape()'
  }
})
export class ImplementationGuideComponent {
  private readonly settings = inject(SettingsService);
  private readonly http = inject(HttpClient);
  private guidesRequest = 0;
  private memberRequest = 0;
  private memberPageBase: string | null = null;
  private memberPageHeaders: Record<string, string> | null = null;
  private memberPageRole: FhirEndpointRole = 'content';
  private rowSequence = 0;

  readonly resourceTypes = GUIDE_RESOURCE_TYPES;
  readonly statuses = GUIDE_STATUSES;

  readonly guides = signal<GuideListItem[]>([]);
  readonly guidesTotal = signal<number | null>(null);
  readonly guidesNext = signal<string | null>(null);
  readonly guidesLoading = signal(false);
  readonly guideQuery = signal('');

  readonly memberType = signal<GuideResourceType>('Library');
  readonly memberQuery = signal('');
  readonly memberSearching = signal(false);
  readonly memberSearched = signal(false);
  readonly memberSearchError = signal<string | null>(null);
  readonly memberResults = signal<ArtifactRow[]>([]);
  readonly memberTotal = signal<number | null>(null);
  readonly memberNext = signal<string | null>(null);
  readonly manualReference = signal('');
  readonly manualName = signal('');

  readonly source = signal<ImplementationGuide | null>(null);
  readonly selectedKey = signal<string | null>(null);
  readonly editingId = signal<string | null>(null);
  readonly url = signal('');
  readonly version = signal('0.1.0');
  readonly name = signal('');
  readonly title = signal('');
  readonly status = signal<GuideStatus>('draft');
  readonly experimental = signal(false);
  readonly date = signal('');
  readonly publisher = signal('');
  readonly description = signal('');
  readonly packageId = signal('');
  readonly selectedFhirVersions = signal<string[]>([...FHIR_VERSION_CHOICES.slice(0, 1)]);
  readonly dependencies = signal<GuideDependencyDraft[]>([]);
  readonly members = signal<GuideMemberDraft[]>([]);

  readonly busy = signal(false);
  readonly busyAction = signal<'save' | 'delete' | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly statusMessage = signal<string | null>(null);
  readonly deleteConfirm = signal<{ id: string; label: string } | null>(null);

  readonly fhirVersions = computed(() => fhirVersionOptions(this.selectedFhirVersions()));
  readonly preservedNotes = computed(() => preservedNotes(this.source()));

  constructor() {
    void this.loadGuides();
  }

  async loadGuides(append = false): Promise<void> {
    if (append && !this.guidesNext()) {
      return;
    }
    const request = ++this.guidesRequest;
    this.guidesLoading.set(true);
    if (!append) {
      this.errorMessage.set(null);
    }
    try {
      const bundle = await this.fetchGuidePage(append ? this.guidesNext() : null);
      if (request !== this.guidesRequest) {
        return;
      }
      const pageBase = this.contentContext().base;
      const offset = append ? this.guides().length : 0;
      const items = guideItems(bundle, offset);
      this.guides.set(append ? mergeGuides(this.guides(), items) : items);
      this.guidesTotal.set(typeof bundle.total === 'number' ? bundle.total : null);
      this.guidesNext.set(sameOriginNext(nextBundleUrl(bundle), pageBase));
    } catch (err) {
      if (request !== this.guidesRequest) {
        return;
      }
      if (!append) {
        this.guides.set([]);
        this.guidesTotal.set(null);
        this.guidesNext.set(null);
      }
      this.errorMessage.set(describeFhirHttpFailure(err) || 'Could not load ImplementationGuide resources.');
    } finally {
      if (request === this.guidesRequest) {
        this.guidesLoading.set(false);
      }
    }
  }

  newGuide(): void {
    this.source.set(null);
    this.selectedKey.set(null);
    this.editingId.set(null);
    this.url.set('');
    this.version.set('0.1.0');
    this.name.set('');
    this.title.set('');
    this.status.set('draft');
    this.experimental.set(false);
    this.date.set('');
    this.publisher.set('');
    this.description.set('');
    this.packageId.set('');
    this.selectedFhirVersions.set(['4.0.1']);
    this.dependencies.set([]);
    this.members.set([]);
    this.clearMemberSearch();
    this.errorMessage.set(null);
    this.statusMessage.set(null);
  }

  editGuide(item: GuideListItem): void {
    this.applyLoadedGuide(item);
    this.errorMessage.set(null);
    this.statusMessage.set(null);
  }

  guideItemId(guide: GuideListItem, index: number): string {
    return `implementation-guide-item-${guideDomId(guide.resource.id, index)}`;
  }

  isSelected(guide: GuideListItem): boolean {
    return this.selectedKey() === guide.key;
  }

  setStatus(value: string): void {
    if (isGuideStatus(value)) {
      this.status.set(value);
    }
  }

  setMemberType(value: string): void {
    if ((GUIDE_RESOURCE_TYPES as readonly string[]).includes(value)) {
      this.memberType.set(value as GuideResourceType);
    }
  }

  setExperimental(event: Event): void {
    this.experimental.set((event.target as HTMLInputElement).checked);
  }

  setFhirVersion(version: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.selectedFhirVersions.update((current) => {
      if (checked) {
        return current.includes(version) ? current : [...current, version];
      }
      return current.filter((item) => item !== version);
    });
  }

  addDependency(): void {
    const key = this.nextKey('dependency');
    this.dependencies.update((rows) => [...rows, { key, uri: '', packageId: '', version: '' }]);
  }

  removeDependency(key: string): void {
    this.dependencies.update((rows) => rows.filter((row) => row.key !== key));
  }

  setDependencyUri(key: string, event: Event): void {
    this.patchDependency(key, { uri: inputValue(event) });
  }

  setDependencyPackageId(key: string, event: Event): void {
    this.patchDependency(key, { packageId: inputValue(event) });
  }

  setDependencyVersion(key: string, event: Event): void {
    this.patchDependency(key, { version: inputValue(event) });
  }

  async searchMembers(append = false): Promise<void> {
    if (append && !this.memberNext()) {
      return;
    }
    const request = ++this.memberRequest;
    this.memberSearching.set(true);
    this.memberSearched.set(true);
    this.memberSearchError.set(null);
    if (!append) {
      this.memberNext.set(null);
    }
    try {
      const page = await this.searchArtifacts(this.memberType(), this.memberQuery(), append ? this.memberNext() : null);
      if (request !== this.memberRequest) {
        return;
      }
      this.memberResults.set(append ? mergeArtifacts(this.memberResults(), page.rows) : page.rows);
      this.memberTotal.set(page.total);
      this.memberNext.set(page.next);
      this.memberPageBase = page.base;
      this.memberPageHeaders = page.headers;
      this.memberPageRole = page.role;
    } catch (err) {
      if (request !== this.memberRequest) {
        return;
      }
      if (!append) {
        this.memberResults.set([]);
        this.memberTotal.set(null);
        this.memberNext.set(null);
      }
      this.memberSearchError.set(describeFhirHttpFailure(err) || 'Search failed.');
    } finally {
      if (request === this.memberRequest) {
        this.memberSearching.set(false);
      }
    }
  }

  addMember(row: ArtifactRow): void {
    if (!row.reference) {
      this.errorMessage.set('The artifact has no id or canonical URL.');
      return;
    }
    if (this.memberListed(row.reference)) {
      this.errorMessage.set(`${row.reference} is already listed.`);
      this.statusMessage.set(null);
      return;
    }
    this.members.update((rows) => [
      ...rows,
      {
        key: this.nextKey('member'),
        reference: row.reference,
        name: row.label,
        example: false,
        exampleCanonical: ''
      }
    ]);
    this.errorMessage.set(null);
  }

  addManualMember(): void {
    const reference = this.manualReference().trim();
    if (!reference) {
      this.memberSearchError.set('Enter a reference such as Library/example or a canonical URL.');
      return;
    }
    if (this.memberListed(reference)) {
      this.errorMessage.set(`${reference} is already listed.`);
      this.statusMessage.set(null);
      return;
    }
    this.members.update((rows) => [
      ...rows,
      {
        key: this.nextKey('member'),
        reference,
        name: this.manualName().trim(),
        example: false,
        exampleCanonical: ''
      }
    ]);
    this.manualReference.set('');
    this.manualName.set('');
    this.memberSearchError.set(null);
    this.errorMessage.set(null);
  }

  memberListed(reference: string): boolean {
    const target = reference.trim();
    return this.members().some((member) => member.reference.trim() === target);
  }

  removeMember(key: string): void {
    this.members.update((rows) => rows.filter((member) => member.key !== key));
  }

  setMemberReference(key: string, event: Event): void {
    this.patchMember(key, { reference: inputValue(event) });
  }

  setMemberName(key: string, event: Event): void {
    this.patchMember(key, { name: inputValue(event) });
  }

  setMemberExample(key: string, event: Event): void {
    this.patchMember(key, { example: (event.target as HTMLInputElement).checked });
  }

  async save(): Promise<void> {
    const fields = this.draft();
    let guide: ImplementationGuide;
    try {
      guide = applyGuideEdits(this.source(), fields);
    } catch (err) {
      this.errorMessage.set(err instanceof Error ? err.message : 'The ImplementationGuide is not valid.');
      this.statusMessage.set(null);
      return;
    }
    const id = this.editingId();
    if (id) {
      guide.id = id;
    }
    this.busy.set(true);
    this.busyAction.set('save');
    this.errorMessage.set(null);
    this.statusMessage.set(null);
    try {
      const saved = await this.writeGuide(guide, id);
      const resource = saved.resourceType === 'ImplementationGuide' ? saved : guide;
      this.applyLoadedGuide(toGuideItem(resource, this.selectedKey() ?? resource.id ?? 'saved'));
      await this.loadGuides();
      const match = resource.id ? this.guides().find((item) => item.resource.id === resource.id) : undefined;
      if (match) {
        this.applyLoadedGuide(match);
      }
      this.statusMessage.set(id ? 'Updated the ImplementationGuide.' : 'Created the ImplementationGuide.');
    } catch (err) {
      this.errorMessage.set(describeFhirHttpFailure(err) || 'Could not save the ImplementationGuide.');
    } finally {
      this.busy.set(false);
      this.busyAction.set(null);
    }
  }

  deleteGuide(): void {
    const id = this.editingId();
    if (!id || this.busy() || this.deleteConfirm()) {
      return;
    }
    const label = this.title().trim() || this.name().trim() || id;
    this.deleteConfirm.set({ id, label });
  }

  cancelDeleteGuide(): void {
    if (this.busyAction() === 'delete') {
      return;
    }
    this.deleteConfirm.set(null);
  }

  onDeleteModalEscape(): void {
    if (!this.deleteConfirm()) {
      return;
    }
    this.cancelDeleteGuide();
  }

  onDeleteModalShellClick(event: MouseEvent): void {
    if (event.target !== event.currentTarget) {
      return;
    }
    this.cancelDeleteGuide();
  }

  async confirmDeleteGuide(): Promise<void> {
    const pending = this.deleteConfirm();
    if (!pending || this.busy()) {
      return;
    }
    this.busy.set(true);
    this.busyAction.set('delete');
    this.errorMessage.set(null);
    this.statusMessage.set(null);
    try {
      const ctx = this.contentContext();
      await firstValueFrom(
        this.http.delete(`${ctx.base}/ImplementationGuide/${encodeURIComponent(pending.id)}`, {
          headers: new HttpHeaders(ctx.headers)
        })
      );
      this.deleteConfirm.set(null);
      this.newGuide();
      this.statusMessage.set('Deleted the ImplementationGuide.');
      await this.loadGuides();
    } catch (err) {
      this.errorMessage.set(describeFhirHttpFailure(err) || 'Could not delete the ImplementationGuide.');
    } finally {
      this.busy.set(false);
      this.busyAction.set(null);
    }
  }

  private draft(): GuideDraft {
    return {
      url: this.url(),
      version: this.version(),
      name: this.name(),
      title: this.title(),
      status: this.status(),
      experimental: this.experimental(),
      date: this.date(),
      publisher: this.publisher(),
      description: this.description(),
      packageId: this.packageId(),
      fhirVersion: this.selectedFhirVersions(),
      dependencies: this.dependencies(),
      members: this.members()
    };
  }

  private applyLoadedGuide(item: GuideListItem): void {
    const guide = structuredClone(item.resource);
    this.source.set(guide);
    this.selectedKey.set(item.key);
    this.editingId.set(guide.id ?? null);
    this.url.set(guide.url ?? '');
    this.version.set(guide.version ?? '');
    this.name.set(guide.name ?? '');
    this.title.set(guide.title ?? '');
    this.status.set(isGuideStatus(guide.status) ? guide.status : 'draft');
    this.experimental.set(guide.experimental === true);
    this.date.set(guide.date ?? '');
    this.publisher.set(guide.publisher ?? '');
    this.description.set(guide.description ?? '');
    this.packageId.set(guide.packageId ?? '');
    this.selectedFhirVersions.set(guide.fhirVersion?.length ? [...guide.fhirVersion] : ['4.0.1']);
    this.dependencies.set(dependenciesFromGuide(guide));
    this.members.set(membersFromGuide(guide));
    this.clearMemberSearch();
  }

  private clearMemberSearch(): void {
    this.memberQuery.set('');
    this.memberResults.set([]);
    this.memberTotal.set(null);
    this.memberNext.set(null);
    this.memberPageBase = null;
    this.memberPageHeaders = null;
    this.memberSearched.set(false);
    this.memberSearchError.set(null);
    this.manualReference.set('');
    this.manualName.set('');
  }

  private async fetchGuidePage(nextUrl: string | null): Promise<Bundle> {
    const ctx = this.contentContext();
    if (nextUrl) {
      return firstValueFrom(this.http.get<Bundle>(nextUrl, { headers: new HttpHeaders(ctx.headers) }));
    }
    const attempts = guideSearchAttempts(this.guideQuery());
    let last: Bundle = { resourceType: 'Bundle', type: 'searchset' };
    let lastError: unknown;
    let succeeded = false;
    for (const params of attempts) {
      try {
        last = await firstValueFrom(
          this.http.get<Bundle>(`${ctx.base}/ImplementationGuide?${queryString(params)}`, {
            headers: new HttpHeaders(ctx.headers)
          })
        );
        succeeded = true;
        if ((last.entry ?? []).some((entry) => entry.resource) || attempts.length === 1) {
          return last;
        }
      } catch (err) {
        lastError = err;
      }
    }
    if (!succeeded && lastError) {
      throw lastError;
    }
    return last;
  }

  private async searchArtifacts(type: string, term: string, nextUrl: string | null): Promise<ArtifactPage> {
    if (nextUrl) {
      const headers = this.memberPageHeaders;
      const base = this.memberPageBase;
      if (!headers || !base) {
        throw new Error('Search again before loading another page.');
      }
      const bundle = await firstValueFrom(this.http.get<Bundle>(nextUrl, { headers: new HttpHeaders(headers) }));
      return toArtifactPage(bundle, this.memberPageRole, base, headers);
    }
    const attempts = memberSearchAttempts(type, term);
    const seen = new Set<string>();
    let lastError: unknown;
    let lastPage: ArtifactPage | null = null;
    let succeeded = false;
    for (const role of memberEndpointRoles(type)) {
      const ctx = this.endpointContext(role);
      if (!ctx || seen.has(ctx.base)) {
        continue;
      }
      seen.add(ctx.base);
      for (const params of attempts) {
        try {
          const bundle = await firstValueFrom(
            this.http.get<Bundle>(`${ctx.base}/${type}?${queryString(params)}`, {
              headers: new HttpHeaders(ctx.headers)
            })
          );
          succeeded = true;
          const page = toArtifactPage(bundle, role, ctx.base, ctx.headers);
          if (page.rows.length) {
            return page;
          }
          lastPage = page;
        } catch (err) {
          lastError = err;
        }
      }
    }
    if (!seen.size) {
      throw new Error('The active environment has no endpoint for this resource type.');
    }
    if (!succeeded && lastError) {
      throw lastError;
    }
    return lastPage ?? { rows: [], next: null, total: null, base: '', role: 'content', headers: {} };
  }

  private async writeGuide(guide: ImplementationGuide, id: string | null): Promise<ImplementationGuide> {
    const ctx = this.contentContext({ 'Content-Type': 'application/fhir+json' });
    const headers = { ...ctx.headers };
    if (id) {
      const versionId = guide.meta?.versionId;
      if (versionId) {
        headers['If-Match'] = `W/"${versionId}"`;
        const meta = { ...guide.meta };
        delete meta.versionId;
        guide.meta = Object.keys(meta).length ? meta : undefined;
      }
      return firstValueFrom(
        this.http.put<ImplementationGuide>(
          `${ctx.base}/ImplementationGuide/${encodeURIComponent(id)}`,
          guide,
          { headers: new HttpHeaders(headers) }
        )
      );
    }
    return firstValueFrom(
      this.http.post<ImplementationGuide>(`${ctx.base}/ImplementationGuide`, guide, {
        headers: new HttpHeaders(headers)
      })
    );
  }

  private contentContext(extra?: Record<string, string>): { base: string; headers: Record<string, string> } {
    const ctx = this.endpointContext('content', extra);
    if (!ctx) {
      throw new Error('The active environment has no content endpoint.');
    }
    return ctx;
  }

  private endpointContext(
    role: FhirEndpointRole,
    extra?: Record<string, string>
  ): { base: string; headers: Record<string, string> } | null {
    const ctx = this.settings.getEndpointHttpContext(role, {
      Accept: 'application/fhir+json',
      ...extra
    });
    const base = ctx.address.replace(/\/+$/, '');
    if (!base) {
      return null;
    }
    return { base, headers: ctx.headers };
  }

  private patchDependency(key: string, patch: Partial<Pick<GuideDependencyDraft, 'uri' | 'packageId' | 'version'>>): void {
    this.dependencies.update((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  private patchMember(key: string, patch: Partial<Pick<GuideMemberDraft, 'reference' | 'name' | 'example'>>): void {
    this.members.update((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  private nextKey(prefix: string): string {
    this.rowSequence += 1;
    return `${prefix}-new-${this.rowSequence}`;
  }
}

function preservedNotes(guide: ImplementationGuide | null): string[] {
  if (!guide) {
    return [];
  }
  const notes: string[] = [];
  if (guide.contact?.length) {
    notes.push('contacts');
  }
  if (guide.useContext?.length) {
    notes.push('use contexts');
  }
  if (guide.jurisdiction?.length) {
    notes.push('jurisdictions');
  }
  if (guide.copyright) {
    notes.push('copyright');
  }
  if (guide.license) {
    notes.push('license');
  }
  if (guide.global?.length) {
    notes.push(`${guide.global.length} global profile${guide.global.length === 1 ? '' : 's'}`);
  }
  const definition = guide.definition;
  if (definition?.grouping?.length) {
    notes.push(`${definition.grouping.length} grouping${definition.grouping.length === 1 ? '' : 's'}`);
  }
  if (definition?.page) {
    notes.push('the page tree');
  }
  if (definition?.parameter?.length) {
    notes.push('build parameters');
  }
  if (definition?.template?.length) {
    notes.push('templates');
  }
  if (guide.manifest) {
    notes.push('the publication manifest');
  }
  return notes;
}

function guideItems(bundle: Bundle, offset: number): GuideListItem[] {
  return (bundle.entry ?? []).flatMap((entry, index) => {
    const resource = entry.resource;
    if (resource?.resourceType !== 'ImplementationGuide') {
      return [];
    }
    return [toGuideItem(resource as ImplementationGuide, offset + index)];
  });
}

function toGuideItem(resource: ImplementationGuide, indexOrKey: number | string): GuideListItem {
  const key = resource.id
    ? `id:${resource.id}`
    : typeof indexOrKey === 'string'
      ? indexOrKey
      : `row:${indexOrKey}:${resource.url ?? ''}`;
  return {
    key,
    label: resource.title || resource.name || resource.id || 'ImplementationGuide',
    resource
  };
}

function mergeGuides(current: GuideListItem[], next: GuideListItem[]): GuideListItem[] {
  const seen = new Set(current.map((item) => item.resource.id).filter((id): id is string => !!id));
  const extra = next.filter((item) => !item.resource.id || !seen.has(item.resource.id));
  return [...current, ...extra];
}

interface ArtifactPage {
  rows: ArtifactRow[];
  next: string | null;
  total: number | null;
  base: string;
  role: FhirEndpointRole;
  headers: Record<string, string>;
}

function toArtifactPage(
  bundle: Bundle,
  role: FhirEndpointRole,
  base: string,
  headers: Record<string, string>
): ArtifactPage {
  return {
    rows: artifactRows(bundle, role),
    next: sameOriginNext(nextBundleUrl(bundle), base),
    total: typeof bundle.total === 'number' ? bundle.total : null,
    base,
    role,
    headers
  };
}

function mergeArtifacts(current: ArtifactRow[], next: ArtifactRow[]): ArtifactRow[] {
  const seen = new Set(current.map((row) => row.key));
  return [...current, ...next.filter((row) => !seen.has(row.key))];
}

function artifactRows(bundle: Bundle, role: FhirEndpointRole): ArtifactRow[] {
  return (bundle.entry ?? []).flatMap((entry, index) => {
    const resource = entry.resource;
    if (!resource) {
      return [];
    }
    const reference = memberReferenceFor(resource, role === 'content') ?? '';
    return [{
      key: resource.id ? `${resource.resourceType}/${resource.id}` : `${resource.resourceType}:${reference || index}`,
      resource,
      reference,
      label: labelOf(resource),
      detail: [reference || resource.resourceType, role].filter(Boolean).join(' · ')
    }];
  });
}

function labelOf(resource: Resource): string {
  const meta = resource as { title?: string; name?: string; id?: string };
  return meta.title || meta.name || meta.id || resource.resourceType;
}

function sameOriginNext(next: string | null, base: string): string | null {
  if (!next || !base) {
    return null;
  }
  try {
    const nextUrl = new URL(next, base.endsWith('/') ? base : `${base}/`);
    return nextUrl.origin === new URL(base).origin ? nextUrl.toString() : null;
  } catch {
    return null;
  }
}

function queryString(params: Record<string, string>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    search.set(key, value);
  }
  return search.toString();
}

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement).value;
}
