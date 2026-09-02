// Author: Preston Lee

import {Component, ChangeDetectionStrategy, computed, inject, signal} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom, Observable } from 'rxjs';
import {
  VsacService,
  capabilityStatementSupportsValueSetSort,
  valueSetSortFieldChoicesFromCapability
} from '../../services/vsac.service';
import { SettingsService } from '../../services/settings.service';
import { TerminologyService } from '../../services/terminology.service';
import { ToastService } from '../../services/toast.service';
import { ClipboardService } from '../../services/clipboard.service';
import { isResourceType } from '../../services/fhir-resource-type.lib';
import { SyntaxHighlighterComponent } from '../shared/syntax-highlighter/syntax-highlighter.component';
import { ValueSetDependencyTreeComponent } from './value-set-dependency-tree.component';
import { Bundle, CapabilityStatement, Coding, Parameters, ValueSet, Resource } from 'fhir/r4';
import { ValueSetDependencyNode, ValueSetDependencyRef, ValueSetDependencyStatus } from './value-set-dependency.model';

@Component({
  selector: 'app-vsac-browser',
  imports: [NgTemplateOutlet, FormsModule, RouterLink, SyntaxHighlighterComponent, ValueSetDependencyTreeComponent],
  templateUrl: './vsac-browser.component.html',

  styleUrl: './vsac-browser.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VsacBrowserComponent {
  private vsac = inject(VsacService);
  protected settingsService = inject(SettingsService);
  private terminology = inject(TerminologyService);
  private toast = inject(ToastService);
  private clipboard = inject(ClipboardService);

  /** Supersedes stale in-flight ValueSet fetches (Open row or Load). */
  private valueSetPullGen = 0;

  protected readonly activeTab = signal<'status' | 'search' | 'valueset' | 'svs'>('search');
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly capability = signal<CapabilityStatement | null>(null);
  protected readonly vspTypes = signal<string[]>([]);

  protected readonly searchTitle = signal('');
  protected readonly searchName = signal('');
  protected readonly searchUrl = signal('');
  protected readonly searchIdentifier = signal('');
  protected readonly searchVersion = signal('');
  protected readonly searchStatus = signal('active');
  protected readonly searchPublisher = signal('');
  protected readonly searchDescription = signal('');
  protected readonly searchExpansion = signal('');
  protected readonly searchUsage = signal('');
  protected readonly searchKeyword = signal('');
  protected readonly searchCode = signal('');
  protected readonly searchCodesystem = signal('');
  protected readonly searchMeasure = signal('');
  protected readonly searchLibrary = signal('');
  protected readonly searchDate = signal('');
  protected readonly searchResourceId = signal('');
  protected readonly searchLastUpdated = signal('');
  protected readonly searchCount = signal(50);
  /** When server lists `_sort` for ValueSet: chosen search param, or raw `_sort` if no param list. */
  protected readonly searchSortField = signal('');
  protected readonly searchSortOrder = signal<'asc' | 'desc'>('asc');
  protected readonly searchResults = signal<ValueSet[]>([]);
  /** Last FHIR searchset bundle (for total + pagination links). */
  protected readonly searchBundle = signal<Bundle | null>(null);

  protected readonly valueSetSearchSupportsSort = computed(() =>
    capabilityStatementSupportsValueSetSort(this.capability())
  );

  protected readonly valueSetSortFieldOptions = computed(() =>
    this.valueSetSearchSupportsSort() ? valueSetSortFieldChoicesFromCapability(this.capability()) : []
  );

  protected readonly searchPagination = computed(() => {
    const links = this.searchBundle()?.link;
    const pick = (...rels: string[]) => {
      for (const r of rels) {
        const u = links?.find((l) => l.relation === r)?.url;
        if (u) return u;
      }
      return undefined;
    };
    const first = pick('first');
    const previous = pick('previous', 'prev');
    const next = pick('next');
    const last = pick('last');
    return {
      first,
      previous,
      next,
      last,
      showNav: !!(first || previous || next || last)
    };
  });

  protected readonly expansionPageInfo = computed(() => {
    const exp = this.expandedValueSet()?.expansion;
    const rows = this.expansionRows().length;
    const offset = this.expandOffset();
    const count = Math.max(1, Number(this.expandCount()) || 100);
    const total = exp?.total;
    const hasTotal = typeof total === 'number';
    let canNext = false;
    if (rows > 0) {
      if (hasTotal) {
        canNext = offset + rows < total;
      } else {
        canNext = rows >= count;
      }
    }
    const summary =
      rows === 0
        ? ''
        : hasTotal
          ? `Codes ${offset + 1}–${offset + rows} of ${total}`
          : `Codes ${offset + 1}–${offset + rows}${rows >= count ? ' (more may exist)' : ''}`;
    return { canPrev: offset > 0, canNext, summary };
  });

  protected readonly oidInput = signal('');
  protected readonly loadedValueSet = signal<ValueSet | null>(null);
  protected readonly expandFilter = signal('');
  protected readonly expandCount = signal(100);
  protected readonly expandOffset = signal(0);
  protected readonly expandProfile = signal('');
  protected readonly expandedValueSet = signal<ValueSet | null>(null);
  protected readonly dependencyTree = signal<ValueSetDependencyNode | null>(null);
  protected readonly dependencyStatusMessage = signal<string | null>(null);
  protected readonly dependencyBusy = signal(false);

  protected readonly hasComposeValueSetReferences = computed(() => {
    const vs = this.loadedValueSet();
    return !!vs && this.extractComposeValueSetReferences(vs).length > 0;
  });

  protected readonly dependencyImportNodes = computed(() => {
    const root = this.dependencyTree();
    if (!root) return [] as ValueSetDependencyNode[];
    const out: ValueSetDependencyNode[] = [];
    const seen = new Set<string>();
    const walk = (node: ValueSetDependencyNode) => {
      for (const child of node.children) {
        walk(child);
      }
      if (seen.has(node.key) || !node.valueSet) return;
      if (node.status === 'error' || node.status === 'cycle' || node.status === 'duplicate' || node.status === 'external') return;
      seen.add(node.key);
      out.push(node);
    };
    walk(root);
    return out;
  });

  protected readonly svsProgramsText = signal<string | null>(null);
  protected readonly svsTagNamesText = signal<string | null>(null);
  protected readonly svsOid = signal('');
  protected readonly svsRelease = signal('');
  protected readonly svsProfile = signal('');
  protected readonly svsTagName = signal('');
  protected readonly svsTagValue = signal('');
  protected readonly svsXmlResult = signal<string | null>(null);

  protected readonly terminologyImportWarning = computed(() => {
    const u = this.settingsService.getEffectiveTerminologyEndpointAddress().toLowerCase();
    return u.includes('cts.nlm.nih.gov') || u.includes('nlm.nih.gov');
  });

  protected readonly loadedValueSetJson = computed(() => {
    const vs = this.loadedValueSet();
    if (!vs) return '';
    try {
      return JSON.stringify(vs, null, 2);
    } catch {
      return '';
    }
  });

  setTab(tab: 'status' | 'search' | 'valueset' | 'svs'): void {
    this.activeTab.set(tab);
  }

  setSearchSortOrder(value: string): void {
    this.searchSortOrder.set(value === 'desc' ? 'desc' : 'asc');
  }

  formatVsacDate(value: string | undefined): string {
    if (value == null || !String(value).trim()) return '—';
    const t = String(value).trim();
    return t.length >= 10 ? t.slice(0, 10) : t;
  }

  truncateVsDescription(desc: string | undefined, max = 96): string {
    if (desc == null || !desc.trim()) return '—';
    const s = desc.trim().replace(/\s+/g, ' ');
    return s.length <= max ? s : `${s.slice(0, max)}…`;
  }

  private vsacCredentialsOrWarn(): boolean {
    if (!this.settingsService.vsacHasApiCredentials()) {
      this.toast.showWarning('Configure VSAC credentials in Settings.', 'VSAC');
      return false;
    }
    return true;
  }

  private errMsg(e: unknown): string {
    if (e && typeof e === 'object' && 'error' in e) {
      const er = (e as { error?: unknown }).error;
      if (typeof er === 'string') return er;
      if (er && typeof er === 'object' && 'issue' in er) {
        const issues = (er as { issue?: { diagnostics?: string }[] }).issue;
        if (issues?.length) return issues.map((i) => i.diagnostics || '').filter(Boolean).join('; ') || JSON.stringify(er);
      }
    }
    return e instanceof Error ? e.message : String(e);
  }

  async refreshStatus(): Promise<void> {
    if (this.loading()) return;
    if (!this.vsacCredentialsOrWarn()) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      const cap = await firstValueFrom(this.vsac.getMetadata());
      this.capability.set(cap);
      this.vspTypes.set(extractPackageRelatedTypes(cap));
    } catch (e) {
      this.capability.set(null);
      this.vspTypes.set([]);
      const msg = this.errMsg(e);
      this.error.set(msg);
      this.toast.showError(msg, 'VSAC metadata failed');
    } finally {
      this.loading.set(false);
    }
  }

  private buildSearchSortParam(): string | undefined {
    if (!this.valueSetSearchSupportsSort()) return undefined;
    const raw = this.searchSortField().trim();
    if (!raw) return undefined;
    const choices = this.valueSetSortFieldOptions();
    if (choices.length === 0) {
      return raw;
    }
    return this.searchSortOrder() === 'desc' ? `-${raw}` : raw;
  }

  private applySearchBundle(bundle: Bundle): void {
    const list = bundle.entry
      ?.map((entry) => entry.resource)
      .filter((resource): resource is ValueSet => isResourceType(resource, 'ValueSet')) ?? [];
    this.searchResults.set(list);
    this.searchBundle.set(bundle);
  }

  async runSearch(): Promise<void> {
    if (this.loading()) return;
    if (!this.vsacCredentialsOrWarn()) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      const bundle = await firstValueFrom(
        this.vsac.searchValueSets({
          titleContains: this.searchTitle().trim() || undefined,
          nameContains: this.searchName().trim() || undefined,
          url: this.searchUrl().trim() || undefined,
          identifier: this.searchIdentifier().trim() || undefined,
          version: this.searchVersion().trim() || undefined,
          status: this.searchStatus().trim() || undefined,
          publisherContains: this.searchPublisher().trim() || undefined,
          descriptionContains: this.searchDescription().trim() || undefined,
          expansion: this.searchExpansion().trim() || undefined,
          usage: this.searchUsage().trim() || undefined,
          keyword: this.searchKeyword().trim() || undefined,
          code: this.searchCode().trim() || undefined,
          codesystem: this.searchCodesystem().trim() || undefined,
          measure: this.searchMeasure().trim() || undefined,
          library: this.searchLibrary().trim() || undefined,
          date: this.searchDate().trim() || undefined,
          _id: this.searchResourceId().trim() || undefined,
          _lastUpdated: this.searchLastUpdated().trim() || undefined,
          _sort: this.buildSearchSortParam(),
          _count: this.searchCount()
        })
      );
      this.applySearchBundle(bundle);
    } catch (e) {
      this.searchBundle.set(null);
      this.searchResults.set([]);
      const msg = this.errMsg(e);
      this.error.set(msg);
      this.toast.showError(msg, 'VSAC search failed');
    } finally {
      this.loading.set(false);
    }
  }

  async goSearchPage(kind: 'first' | 'previous' | 'next' | 'last'): Promise<void> {
    const p = this.searchPagination();
    const url =
      kind === 'first' ? p.first : kind === 'previous' ? p.previous : kind === 'next' ? p.next : p.last;
    if (!url || this.loading()) return;
    if (!this.vsacCredentialsOrWarn()) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      const bundle = await firstValueFrom(this.vsac.getValueSetSearchByBundleLink(url));
      this.applySearchBundle(bundle);
    } catch (e) {
      const msg = this.errMsg(e);
      this.error.set(msg);
      this.toast.showError(msg, 'VSAC search page failed');
    } finally {
      this.loading.set(false);
    }
  }

  async expandGoPrevPage(): Promise<void> {
    if (this.loading()) return;
    const count = Math.max(1, Number(this.expandCount()) || 100);
    if (this.expandOffset() <= 0) return;
    this.expandOffset.set(Math.max(0, this.expandOffset() - count));
    await this.expandLoaded();
  }

  async expandGoNextPage(): Promise<void> {
    if (this.loading()) return;
    const exp = this.expandedValueSet()?.expansion;
    const rows = this.expansionRows().length;
    const count = Math.max(1, Number(this.expandCount()) || 100);
    const offset = this.expandOffset();
    const total = exp?.total;
    if (typeof total === 'number') {
      if (offset + rows >= total) return;
    } else if (rows < count) {
      return;
    }
    this.expandOffset.set(offset + count);
    await this.expandLoaded();
  }

  async loadValueSetByOid(): Promise<void> {
    const raw = this.oidInput().trim();
    if (!raw) {
      this.toast.showWarning('Enter a value set OID or id.', 'VSAC');
      return;
    }
    if (this.loading()) return;
    if (!this.vsacCredentialsOrWarn()) return;
    this.expandedValueSet.set(null);
    this.dependencyTree.set(null);
    this.dependencyStatusMessage.set(null);
    await this.pullFullValueSetIntoLoaded(null);
    await this.autoRecurseDependenciesIfAvailable();
  }

  async selectSearchResult(vs: ValueSet): Promise<void> {
    if (vs.id) {
      this.oidInput.set(vs.id);
    } else if (vs.url) {
      this.oidInput.set(vs.url);
    }
    this.expandedValueSet.set(null);
    this.dependencyTree.set(null);
    this.dependencyStatusMessage.set(null);
    this.loadedValueSet.set(vs);
    this.setTab('valueset');
    if (!this.oidInput().trim()) {
      await this.autoRecurseDependenciesIfAvailable();
      return;
    }
    if (!this.vsacCredentialsOrWarn()) return;
    await this.pullFullValueSetIntoLoaded(vs);
    await this.autoRecurseDependenciesIfAvailable();
  }

  /**
   * Fetches full ValueSet using current `oidInput` (OID, `urn:oid:…`, or canonical http(s) URL).
   * On failure: clears loaded when `preserveOnError` is null (Load), else restores that snapshot (Open from search).
   */
  private async pullFullValueSetIntoLoaded(preserveOnError: ValueSet | null): Promise<void> {
    const raw = this.oidInput().trim();
    if (!raw) return;
    const gen = ++this.valueSetPullGen;
    this.loading.set(true);
    this.error.set(null);
    try {
      const full = await firstValueFrom(this.vsac.fetchValueSetByOidOrCanonicalUrl(raw));
      if (gen !== this.valueSetPullGen) return;
      this.loadedValueSet.set(full);
      this.dependencyTree.set(null);
      this.dependencyStatusMessage.set(null);
      if (full.id) {
        this.oidInput.set(full.id);
      } else if (full.url) {
        this.oidInput.set(full.url);
      }
    } catch (e) {
      if (gen !== this.valueSetPullGen) return;
      this.loadedValueSet.set(preserveOnError);
      const msg = this.errMsg(e);
      this.error.set(msg);
      this.toast.showError(msg, 'Load ValueSet failed');
    } finally {
      if (gen === this.valueSetPullGen) {
        this.loading.set(false);
      }
    }
  }

  private async autoRecurseDependenciesIfAvailable(): Promise<void> {
    if (!this.hasComposeValueSetReferences()) return;
    if (this.loading() || this.dependencyBusy()) return;
    await this.recurseDependenciesForLoadedValueSet();
  }

  async expandLoaded(): Promise<void> {
    if (this.loading()) return;
    const vs = this.loadedValueSet();
    if (!vs) {
      this.toast.showWarning('Load a value set first.', 'VSAC');
      return;
    }
    if (!this.vsacCredentialsOrWarn()) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      const count = Math.max(1, Number(this.expandCount()) || 100);
      const offset = Math.max(0, Number(this.expandOffset()) || 0);
      if (vs.id) {
        const q: Record<string, string | number | boolean | undefined> = {
          count,
          offset
        };
        const f = this.expandFilter().trim();
        if (f) q['filter'] = f;
        const p = this.expandProfile().trim();
        if (p) q['profile'] = p;
        const exp = await firstValueFrom(this.vsac.expandValueSetGet(vs.id, q));
        this.expandedValueSet.set(exp);
      } else if (vs.url) {
        const params: Parameters = {
          resourceType: 'Parameters',
          parameter: [
            { name: 'url', valueUri: vs.url },
            { name: 'count', valueInteger: count },
            { name: 'offset', valueInteger: offset }
          ]
        };
        const f = this.expandFilter().trim();
        if (f) params.parameter!.push({ name: 'filter', valueString: f });
        const p = this.expandProfile().trim();
        if (p) params.parameter!.push({ name: 'profile', valueString: p });
        const exp = await firstValueFrom(this.vsac.expandValueSetPost(params));
        this.expandedValueSet.set(exp);
      } else {
        throw new Error('ValueSet has no id or canonical url for $expand');
      }
    } catch (e) {
      const msg = this.errMsg(e);
      this.error.set(msg);
      this.toast.showError(msg, '$expand failed');
    } finally {
      this.loading.set(false);
    }
  }

  private async fetchSvsPlainText(
    request: () => Observable<string>,
    onSuccess: (text: string) => void,
    errorContext: string
  ): Promise<void> {
    if (this.loading()) return;
    if (!this.vsacCredentialsOrWarn()) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      onSuccess(await firstValueFrom(request()));
    } catch (e) {
      const msg = this.errMsg(e);
      this.error.set(msg);
      this.toast.showError(msg, errorContext);
    } finally {
      this.loading.set(false);
    }
  }

  async fetchPrograms(): Promise<void> {
    await this.fetchSvsPlainText(() => this.vsac.listPrograms(), (t) => this.svsProgramsText.set(t), 'SVS programs failed');
  }

  async fetchTagNames(): Promise<void> {
    await this.fetchSvsPlainText(() => this.vsac.listTagNames(), (t) => this.svsTagNamesText.set(t), 'SVS tagNames failed');
  }

  async retrieveSvs(): Promise<void> {
    const oid = this.svsOid().trim();
    const tagName = this.svsTagName().trim();
    const tagValue = this.svsTagValue().trim();
    if (!oid && (!tagName || !tagValue)) {
      this.toast.showWarning('Enter OID or both tag name and tag value.', 'SVS');
      return;
    }
    if (this.loading()) return;
    if (!this.vsacCredentialsOrWarn()) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      const q: Record<string, string> = {};
      if (oid) q['id'] = oid;
      if (tagName) q['tagName'] = tagName;
      if (tagValue) q['tagValue'] = tagValue;
      const rel = this.svsRelease().trim();
      if (rel) q['release'] = rel;
      const prof = this.svsProfile().trim();
      if (prof) q['profile'] = prof;
      const xml = await firstValueFrom(this.vsac.retrieveMultipleValueSets(q));
      this.svsXmlResult.set(xml);
    } catch (e) {
      const msg = this.errMsg(e);
      this.error.set(msg);
      this.toast.showError(msg, 'RetrieveMultipleValueSets failed');
    } finally {
      this.loading.set(false);
    }
  }

  async copyVsacOid(): Promise<void> {
    const vs = this.loadedValueSet();
    const id = vs?.id || this.oidInput().trim();
    if (!id) return;
    try {
      await navigator.clipboard.writeText(id);
      this.toast.showSuccess('Copied OID.', 'Clipboard');
    } catch {
      this.toast.showError('Clipboard not available.', 'Clipboard');
    }
  }

  async copyCanonicalUrl(): Promise<void> {
    const u = this.loadedValueSet()?.url;
    if (!u) return;
    try {
      await navigator.clipboard.writeText(u);
      this.toast.showSuccess('Copied URL.', 'Clipboard');
    } catch {
      this.toast.showError('Clipboard not available.', 'Clipboard');
    }
  }

  async copyCqlSnippet(): Promise<void> {
    const vs = this.loadedValueSet();
    if (!vs?.url) return;
    const name = (vs.title || vs.name || 'VS').replace(/"/g, '\\"');
    const snippet = `valueset "${name}": '${vs.url}'`;
    try {
      await navigator.clipboard.writeText(snippet);
      this.toast.showSuccess('Copied CQL snippet.', 'Clipboard');
    } catch {
      this.toast.showError('Clipboard not available.', 'Clipboard');
    }
  }

  private async copyPlainText(text: string, successMessage: string): Promise<void> {
    if (!text?.trim()) {
      this.toast.showWarning('Nothing to copy.', 'Clipboard');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      this.toast.showSuccess(successMessage, 'Clipboard');
    } catch {
      this.toast.showError('Clipboard not available.', 'Clipboard');
    }
  }

  async copyLoadedValueSetJson(): Promise<void> {
    await this.copyPlainText(this.loadedValueSetJson(), 'ValueSet JSON copied.');
  }

  async copyProgramsResponse(): Promise<void> {
    await this.copyPlainText(this.svsProgramsText() ?? '', 'Programs response copied.');
  }

  async copyTagNamesResponse(): Promise<void> {
    await this.copyPlainText(this.svsTagNamesText() ?? '', 'tagNames response copied.');
  }

  async copySvsXmlResponse(): Promise<void> {
    await this.copyPlainText(this.svsXmlResult() ?? '', 'SVS XML copied.');
  }

  addLoadedValueSetToAppClipboard(): void {
    const vs = this.loadedValueSet();
    if (!vs) return;
    try {
      this.clipboard.addResource(vs as Resource);
      this.toast.showSuccess('ValueSet added to clipboard.', 'Clipboard');
    } catch {
      this.toast.showError('Failed to add ValueSet to clipboard.', 'Clipboard');
    }
  }

  addSearchValueSetToAppClipboard(vs: ValueSet): void {
    try {
      this.clipboard.addResource(vs as Resource);
      this.toast.showSuccess('ValueSet added to clipboard.', 'Clipboard');
    } catch {
      this.toast.showError('Failed to add ValueSet to clipboard.', 'Clipboard');
    }
  }

  addExpansionCodingToAppClipboard(row: { system?: string; code?: string; display?: string }): void {
    const system = row.system?.trim();
    const code = row.code?.trim();
    if (!system || !code) {
      this.toast.showWarning('Code is missing system or code.', 'Clipboard');
      return;
    }
    const coding: Coding = {
      system,
      code,
      display: row.display
    };
    try {
      this.clipboard.addCoding(coding);
      this.toast.showSuccess('Coding added to clipboard.', 'Clipboard');
    } catch {
      this.toast.showError('Failed to add coding to clipboard.', 'Clipboard');
    }
  }

  async importLoadedValueSetToTerminology(): Promise<void> {
    if (this.loading()) return;
    if (this.terminologyImportWarning()) {
      this.toast.showWarning('Point Terminology Services at a writable server, not VSAC.', 'Import');
      return;
    }
    const vs = this.loadedValueSet();
    if (!vs) {
      this.toast.showWarning('Load a value set first.', 'Import');
      return;
    }
    const exp = this.expandedValueSet();
    const toSend = exp && exp.expansion ? exp : vs;
    await this.postValueSetToTerminologyServer(toSend as ValueSet);
  }

  async recurseDependenciesForLoadedValueSet(): Promise<void> {
    if (this.loading() || this.dependencyBusy()) return;
    const root = this.loadedValueSet();
    if (!root) {
      this.toast.showWarning('Load a value set first.', 'Dependencies');
      return;
    }
    if (!this.vsacCredentialsOrWarn()) return;
    this.dependencyBusy.set(true);
    this.error.set(null);
    this.dependencyStatusMessage.set(null);
    try {
      const visited = new Set<string>();
      const fetchCache = new Map<string, ValueSet>();
      const rootKey = this.valueSetKey(root, root.url || root.id || 'loaded-valueset');
      visited.add(rootKey);
      const rootNode: ValueSetDependencyNode = {
        key: rootKey,
        relation: 'root',
        valueSet: root,
        children: [],
        status: 'reference',
        statusHint: ''
      };
      rootNode.children = await this.fetchDependencyChildren(root, [rootKey], visited, fetchCache);
      const classification = this.classifyDependencyNode(rootNode.valueSet, rootNode.children);
      rootNode.status = classification.status;
      rootNode.statusHint = classification.hint;
      this.dependencyTree.set(rootNode);
      const count = this.dependencyImportNodes().length;
      this.dependencyStatusMessage.set(`Dependency tree built. ${count} ValueSet${count === 1 ? '' : 's'} ready to import.`);
      this.toast.showSuccess('Dependency tree loaded.', 'Dependencies');
    } catch (e) {
      const msg = this.errMsg(e);
      this.error.set(msg);
      this.dependencyTree.set(null);
      this.dependencyStatusMessage.set('Dependency recursion failed.');
      this.toast.showError(msg, 'Dependency recursion failed');
    } finally {
      this.dependencyBusy.set(false);
    }
  }

  async importLoadedValueSetWithDependenciesToTerminology(): Promise<void> {
    if (this.loading() || this.dependencyBusy()) return;
    if (this.terminologyImportWarning()) {
      this.toast.showWarning('Point Terminology Services at a writable server, not VSAC.', 'Import');
      return;
    }
    if (!this.dependencyTree()) {
      this.toast.showWarning('Build dependencies first.', 'Import');
      return;
    }
    const nodes = this.dependencyImportNodes();
    if (nodes.length === 0) {
      this.toast.showWarning('No importable dependencies found.', 'Import');
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    let success = 0;
    let failed = 0;
    for (const node of nodes) {
      if (!node.valueSet) continue;
      try {
        await this.postValueSetToTerminologyServerNoToast(node.valueSet);
        success += 1;
      } catch (e) {
        failed += 1;
        this.toast.showError(`${this.valueSetDisplayName(node.valueSet)}: ${this.errMsg(e)}`, 'Dependency import failed');
      }
    }
    this.loading.set(false);
    const total = success + failed;
    if (failed === 0) {
      this.toast.showSuccess(`Imported ${success}/${total} value sets with dependencies.`, 'Import');
    } else {
      this.toast.showWarning(`Imported ${success}/${total}; ${failed} failed.`, 'Import');
    }
  }

  async importSearchValueSetToTerminology(vs: ValueSet): Promise<void> {
    if (this.loading()) return;
    if (this.terminologyImportWarning()) {
      this.toast.showWarning('Point Terminology Services at a writable server, not VSAC.', 'Import');
      return;
    }
    await this.postValueSetToTerminologyServer(vs);
  }

  private async postValueSetToTerminologyServer(toSend: ValueSet): Promise<void> {
    this.loading.set(true);
    try {
      await this.postValueSetToTerminologyServerNoToast(toSend);
      this.toast.showSuccess('ValueSet posted to terminology server.', 'Import');
    } catch (e) {
      this.toast.showError(this.errMsg(e), 'Import failed');
    } finally {
      this.loading.set(false);
    }
  }

  private async postValueSetToTerminologyServerNoToast(toSend: ValueSet): Promise<void> {
    const collection: Bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: [{ resource: toSend as Resource }]
    };
    await firstValueFrom(this.terminology.postBundle(collection));
  }

  expansionRows(): { code?: string; display?: string; system?: string }[] {
    return this.expandedValueSet()?.expansion?.contains ?? [];
  }

  private async fetchDependencyChildren(
    vs: ValueSet,
    pathKeys: string[],
    visited: Set<string>,
    fetchCache: Map<string, ValueSet>
  ): Promise<ValueSetDependencyNode[]> {
    const refs = this.extractComposeValueSetReferences(vs);
    const children: ValueSetDependencyNode[] = [];
    for (const ref of refs) {
      children.push(await this.fetchDependencyNode(ref, pathKeys, visited, fetchCache));
    }
    return children;
  }

  private async fetchDependencyNode(
    ref: ValueSetDependencyRef,
    pathKeys: string[],
    visited: Set<string>,
    fetchCache: Map<string, ValueSet>
  ): Promise<ValueSetDependencyNode> {
    const refKey = this.normalizeValueSetKey(ref.reference);
    if (pathKeys.includes(refKey)) {
      return {
        key: refKey,
        relation: ref.relation,
        reference: ref.reference,
        valueSet: null,
        children: [],
        status: 'cycle',
        statusHint: 'Reference cycle detected.'
      };
    }
    let fetched: ValueSet | null = fetchCache.get(refKey) ?? null;
    if (!fetched) {
      try {
        fetched = await firstValueFrom(this.vsac.fetchValueSetByOidOrCanonicalUrl(ref.reference));
        fetchCache.set(refKey, fetched);
      } catch {
        return {
          key: refKey,
          relation: ref.relation,
          reference: ref.reference,
          valueSet: null,
          children: [],
          status: 'external',
          statusHint: 'Reference could not be resolved as a FHIR ValueSet resource.'
        };
      }
    }
    const key = this.valueSetKey(fetched, ref.reference);
    if (pathKeys.includes(key)) {
      return {
        key,
        relation: ref.relation,
        reference: ref.reference,
        valueSet: fetched,
        children: [],
        status: 'cycle',
        statusHint: 'Reference cycle detected.'
      };
    }
    if (visited.has(key)) {
      return {
        key,
        relation: ref.relation,
        reference: ref.reference,
        valueSet: fetched,
        children: [],
        status: 'duplicate',
        statusHint: 'Already referenced elsewhere in this tree.'
      };
    }
    visited.add(key);
    const children = await this.fetchDependencyChildren(fetched, [...pathKeys, key], visited, fetchCache);
    const classification = this.classifyDependencyNode(fetched, children);
    return {
      key,
      relation: ref.relation,
      reference: ref.reference,
      valueSet: fetched,
      children,
      status: classification.status,
      statusHint: classification.hint
    };
  }

  private classifyDependencyNode(
    vs: ValueSet | null,
    children: ValueSetDependencyNode[]
  ): { status: ValueSetDependencyStatus; hint: string } {
    if (!vs?.compose) {
      return { status: 'conditional', hint: 'No compose definition found; import behavior depends on server support.' };
    }
    const includes = vs.compose.include ?? [];
    const excludes = vs.compose.exclude ?? [];
    const hasConcept = includes.some((i) => (i.concept?.length ?? 0) > 0);
    const hasFilter = includes.some((i) => (i.filter?.length ?? 0) > 0);
    const hasValueSetRefs = this.extractComposeValueSetReferences(vs).length > 0;
    const hasWholeSystem = includes.some((i) => !!i.system && (i.concept?.length ?? 0) === 0 && (i.filter?.length ?? 0) === 0);
    const hasWildcardVersion = includes.some((i) => i.version === '*');
    const hasUnresolvedChild = children.some((c) => c.status === 'external' || c.status === 'error');
    if (hasUnresolvedChild) {
      return { status: 'conditional', hint: 'Some dependencies are unresolved and may not import correctly.' };
    }
    if (hasWholeSystem) {
      return { status: 'questionable', hint: 'Includes an entire code system; target server must provide the code system content.' };
    }
    if (hasFilter) {
      return { status: 'conditional', hint: 'Uses filter-based criteria; expansion depends on terminology server capabilities.' };
    }
    if (hasWildcardVersion || (!!includes.length && !vs.compose.lockedDate && includes.some((i) => !i.version))) {
      return { status: 'conditional', hint: 'Not fully version-locked (missing include version or lockedDate).' };
    }
    if (hasConcept) {
      return { status: 'ideal', hint: 'Contains explicit concepts/codes and should import predictably.' };
    }
    if (hasValueSetRefs) {
      return {
        status: 'reference',
        hint:
          excludes.length > 0
            ? 'References dependent value sets and has excludes; imports depend on recursive processing.'
            : 'References dependent value sets; imports depend on recursive processing.'
      };
    }
    return { status: 'conditional', hint: 'Compose semantics require server-side expansion behavior.' };
  }

  private extractComposeValueSetReferences(vs: ValueSet): ValueSetDependencyRef[] {
    const refs: ValueSetDependencyRef[] = [];
    for (const inc of vs.compose?.include ?? []) {
      for (const ref of inc.valueSet ?? []) {
        if (ref?.trim()) refs.push({ relation: 'include', reference: ref.trim() });
      }
    }
    for (const exc of vs.compose?.exclude ?? []) {
      for (const ref of exc.valueSet ?? []) {
        if (ref?.trim()) refs.push({ relation: 'exclude', reference: ref.trim() });
      }
    }
    return refs;
  }

  private normalizeValueSetKey(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) return 'unknown';
    return /^https?:\/\//i.test(trimmed) ? trimmed.toLowerCase() : trimmed.replace(/^urn:oid:/i, '').toLowerCase();
  }

  private valueSetKey(vs: ValueSet, fallback: string): string {
    const preferred = vs.url || vs.id || fallback;
    return this.normalizeValueSetKey(preferred);
  }

  private valueSetDisplayName(vs: ValueSet): string {
    return vs.title || vs.name || vs.id || vs.url || 'ValueSet';
  }
}

function extractPackageRelatedTypes(cap: CapabilityStatement | null): string[] {
  if (!cap?.rest?.length) return [];
  const types = new Set<string>();
  const keywords = ['package', 'Package', 'valuesetpackage', 'ValueSetPackage'];
  for (const rest of cap.rest) {
    for (const r of rest.resource ?? []) {
      const t = r.type;
      if (!t) continue;
      if (keywords.some((k) => t.includes(k))) types.add(t);
    }
  }
  return [...types].sort();
}
