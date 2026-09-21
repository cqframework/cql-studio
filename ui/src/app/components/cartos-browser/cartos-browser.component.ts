// Author: Preston Lee

import { Component, ChangeDetectionStrategy, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  CartosService,
  capabilityStatementSupportsValueSetSort,
  valueSetSortFieldChoicesFromCapability,
} from '../../services/cartos.service';
import { SettingsService } from '../../services/settings.service';
import { ToastService } from '../../services/toast.service';
import { ClipboardService } from '../../services/clipboard.service';
import { isResourceType } from '../../services/fhir-resource-type.lib';
import { formatValueSetCqlDeclaration } from '@cql-studio/core';
import { SyntaxHighlighterComponent } from '../shared/syntax-highlighter/syntax-highlighter.component';
import { ValueSetDependencyTreeComponent } from '../shared/value-set-dependency/value-set-dependency-tree.component';
import { Bundle, CapabilityStatement, CodeSystem, Coding, Parameters, Resource, ValueSet } from 'fhir/r4';
import {
  buildValueSetDependencyTree,
  collectImportableDependencyNodes,
  extractComposeValueSetReferences,
  ValueSetDependencyNode,
  valueSetDisplayName,
} from '../../services/remote-fhir-terminology/value-set-dependency.lib';
import { RemoteValueSetImportService } from '../../services/remote-fhir-terminology/remote-value-set-import.service';
import { computeExpansionCanNext } from '../../services/remote-fhir-terminology/remote-fhir-terminology.lib';

@Component({
  selector: 'app-cartos-browser',
  imports: [NgTemplateOutlet, FormsModule, RouterLink, SyntaxHighlighterComponent, ValueSetDependencyTreeComponent],
  templateUrl: './cartos-browser.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CartosBrowserComponent {
  private cartos = inject(CartosService);
  protected settingsService = inject(SettingsService);
  private remoteImport = inject(RemoteValueSetImportService);
  private toast = inject(ToastService);
  private clipboard = inject(ClipboardService);

  private valueSetPullGen = 0;

  protected readonly activeTab = signal<'status' | 'search' | 'valueset' | 'codesystem'>('search');
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly capability = signal<CapabilityStatement | null>(null);

  protected readonly searchTitle = signal('');
  protected readonly searchName = signal('');
  protected readonly searchUrl = signal('');
  protected readonly searchIdentifier = signal('');
  protected readonly searchVersion = signal('');
  protected readonly searchStatus = signal('active');
  protected readonly searchCount = signal(50);
  protected readonly searchSortField = signal('');
  protected readonly searchSortOrder = signal<'asc' | 'desc'>('asc');
  protected readonly searchResults = signal<ValueSet[]>([]);
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
    return { first, previous, next, last, showNav: !!(first || previous || next || last) };
  });

  protected readonly expansionPageInfo = computed(() => {
    const exp = this.expandedValueSet()?.expansion;
    const rows = this.expansionRows().length;
    const offset = this.expandOffset();
    const count = Math.max(1, Number(this.expandCount()) || 100);
    const total = exp?.total;
    const hasTotal = typeof total === 'number';
    const canNext = computeExpansionCanNext({ rowCount: rows, offset, count, total });
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
    return !!vs && extractComposeValueSetReferences(vs).length > 0;
  });

  protected readonly dependencyImportNodes = computed(() => {
    const root = this.dependencyTree();
    if (!root) return [] as ValueSetDependencyNode[];
    return collectImportableDependencyNodes(root);
  });

  protected readonly csSearchName = signal('');
  protected readonly csSearchUrl = signal('');
  protected readonly csSearchCount = signal(50);
  protected readonly codeSystemResults = signal<CodeSystem[]>([]);
  protected readonly loadedCodeSystem = signal<CodeSystem | null>(null);

  protected readonly terminologyImportWarning = computed(() => this.remoteImport.terminologyEndpointIsReadOnly());

  protected readonly loadedValueSetJson = computed(() => {
    const vs = this.loadedValueSet();
    if (!vs) return '';
    try {
      return JSON.stringify(vs, null, 2);
    } catch {
      return '';
    }
  });

  setTab(tab: 'status' | 'search' | 'valueset' | 'codesystem'): void {
    this.activeTab.set(tab);
  }

  setSearchSortOrder(value: string): void {
    this.searchSortOrder.set(value === 'desc' ? 'desc' : 'asc');
  }

  private errMsg(e: unknown): string {
    if (e && typeof e === 'object' && 'error' in e) {
      const er = (e as { error?: unknown }).error;
      if (typeof er === 'string') return er;
      if (er && typeof er === 'object' && 'issue' in er) {
        const issues = (er as { issue?: { diagnostics?: string }[] }).issue;
        if (issues?.length) {
          return issues.map((i) => i.diagnostics || '').filter(Boolean).join('; ') || JSON.stringify(er);
        }
      }
    }
    return e instanceof Error ? e.message : String(e);
  }

  async refreshStatus(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      const cap = await firstValueFrom(this.cartos.getMetadata());
      this.capability.set(cap);
    } catch (e) {
      this.capability.set(null);
      const msg = this.errMsg(e);
      this.error.set(msg);
      this.toast.showError(msg, 'Cartos metadata failed');
    } finally {
      this.loading.set(false);
    }
  }

  private buildSearchSortParam(): string | undefined {
    if (!this.valueSetSearchSupportsSort()) return undefined;
    const raw = this.searchSortField().trim();
    if (!raw) return undefined;
    const choices = this.valueSetSortFieldOptions();
    if (choices.length === 0) return raw;
    return this.searchSortOrder() === 'desc' ? `-${raw}` : raw;
  }

  private applySearchBundle(bundle: Bundle): void {
    const list =
      bundle.entry
        ?.map((entry) => entry.resource)
        .filter((resource): resource is ValueSet => isResourceType(resource, 'ValueSet')) ?? [];
    this.searchResults.set(list);
    this.searchBundle.set(bundle);
  }

  async runSearch(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      const bundle = await firstValueFrom(
        this.cartos.searchValueSets({
          titleContains: this.searchTitle().trim() || undefined,
          nameContains: this.searchName().trim() || undefined,
          url: this.searchUrl().trim() || undefined,
          identifier: this.searchIdentifier().trim() || undefined,
          version: this.searchVersion().trim() || undefined,
          status: this.searchStatus().trim() || undefined,
          _sort: this.buildSearchSortParam(),
          _count: this.searchCount(),
        })
      );
      this.applySearchBundle(bundle);
    } catch (e) {
      this.searchBundle.set(null);
      this.searchResults.set([]);
      const msg = this.errMsg(e);
      this.error.set(msg);
      this.toast.showError(msg, 'Cartos search failed');
    } finally {
      this.loading.set(false);
    }
  }

  async goSearchPage(kind: 'first' | 'previous' | 'next' | 'last'): Promise<void> {
    const p = this.searchPagination();
    const url =
      kind === 'first' ? p.first : kind === 'previous' ? p.previous : kind === 'next' ? p.next : p.last;
    if (!url || this.loading()) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      const bundle = await firstValueFrom(this.cartos.getValueSetSearchByBundleLink(url));
      this.applySearchBundle(bundle);
    } catch (e) {
      const msg = this.errMsg(e);
      this.error.set(msg);
      this.toast.showError(msg, 'Cartos search page failed');
    } finally {
      this.loading.set(false);
    }
  }

  private async pullFullValueSetIntoLoaded(preferred: ValueSet | null): Promise<void> {
    const gen = ++this.valueSetPullGen;
    const raw = preferred ? preferred.id || preferred.url || '' : this.oidInput().trim();
    if (!raw) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      const vs = preferred?.id
        ? await firstValueFrom(this.cartos.getValueSetById(preferred.id))
        : await firstValueFrom(this.cartos.fetchValueSetByOidOrCanonicalUrl(raw));
      if (gen !== this.valueSetPullGen) return;
      this.loadedValueSet.set(vs);
      this.oidInput.set(vs.id || vs.url || raw);
      this.activeTab.set('valueset');
    } catch (e) {
      if (gen !== this.valueSetPullGen) return;
      this.loadedValueSet.set(null);
      const msg = this.errMsg(e);
      this.error.set(msg);
      this.toast.showError(msg, 'Load ValueSet failed');
    } finally {
      if (gen === this.valueSetPullGen) this.loading.set(false);
    }
  }

  async loadValueSetByOid(): Promise<void> {
    const raw = this.oidInput().trim();
    if (!raw) {
      this.toast.showWarning('Enter a value set id or canonical URL.', 'Cartos');
      return;
    }
    if (this.loading()) return;
    this.expandedValueSet.set(null);
    this.dependencyTree.set(null);
    this.dependencyStatusMessage.set(null);
    await this.pullFullValueSetIntoLoaded(null);
    await this.autoRecurseDependenciesIfAvailable();
  }

  async selectSearchResult(vs: ValueSet): Promise<void> {
    this.expandedValueSet.set(null);
    this.dependencyTree.set(null);
    this.dependencyStatusMessage.set(null);
    await this.pullFullValueSetIntoLoaded(vs);
    await this.autoRecurseDependenciesIfAvailable();
  }

  private async autoRecurseDependenciesIfAvailable(): Promise<void> {
    if (!this.hasComposeValueSetReferences()) return;
    await this.recurseDependenciesForLoadedValueSet();
  }

  async expandLoaded(): Promise<void> {
    const vs = this.loadedValueSet();
    if (!vs || this.loading()) {
      if (!vs) this.toast.showWarning('Load a value set first.', 'Cartos');
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      const count = Math.max(1, Number(this.expandCount()) || 100);
      const offset = Math.max(0, Number(this.expandOffset()) || 0);
      let expanded: ValueSet;
      if (vs.id) {
        const q: Record<string, string | number | boolean | undefined> = { count, offset };
        const f = this.expandFilter().trim();
        if (f) q['filter'] = f;
        const p = this.expandProfile().trim();
        if (p) q['profile'] = p;
        expanded = await firstValueFrom(this.cartos.expandValueSetGet(vs.id, q));
      } else if (vs.url) {
        const params: Parameters = {
          resourceType: 'Parameters',
          parameter: [
            { name: 'url', valueUri: vs.url },
            { name: 'count', valueInteger: count },
            { name: 'offset', valueInteger: offset },
          ],
        };
        const f = this.expandFilter().trim();
        if (f) params.parameter!.push({ name: 'filter', valueString: f });
        const p = this.expandProfile().trim();
        if (p) params.parameter!.push({ name: 'profile', valueString: p });
        expanded = await firstValueFrom(this.cartos.expandValueSetPost(params));
      } else {
        throw new Error('ValueSet has neither id nor url for $expand.');
      }
      this.expandedValueSet.set(expanded);
      if (!expanded.expansion?.contains?.length) {
        this.toast.showWarning(
          'Expansion returned no concepts. Proprietary or intensionally-defined sets may omit member codes.',
          'Cartos $expand'
        );
      }
    } catch (e) {
      this.expandedValueSet.set(null);
      const msg = this.errMsg(e);
      this.error.set(msg);
      this.toast.showError(msg, 'Cartos $expand failed');
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

  expansionRows(): { code?: string; display?: string; system?: string }[] {
    return this.expandedValueSet()?.expansion?.contains ?? [];
  }

  async copyOid(): Promise<void> {
    const vs = this.loadedValueSet();
    const id = vs?.id || this.oidInput().trim();
    if (!id) return;
    try {
      await navigator.clipboard.writeText(id);
      this.toast.showSuccess('Copied OID/id.', 'Clipboard');
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
    const snippet = vs ? formatValueSetCqlDeclaration(vs) : null;
    if (!snippet) {
      this.toast.showWarning('ValueSet has no canonical URL.', 'Clipboard');
      return;
    }
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

  async copyCqlDeclaration(vs: ValueSet): Promise<void> {
    const snippet = formatValueSetCqlDeclaration(vs);
    if (!snippet) {
      this.toast.showWarning('ValueSet has no canonical URL.', 'Clipboard');
      return;
    }
    try {
      await navigator.clipboard.writeText(snippet);
      this.toast.showSuccess('CQL declaration copied.', 'Clipboard');
    } catch {
      this.toast.showError('Failed to copy.', 'Clipboard');
    }
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

  addValueSetToAppClipboard(vs: ValueSet): void {
    try {
      this.clipboard.addResource(vs as Resource);
      this.toast.showSuccess('ValueSet added to clipboard.', 'Clipboard');
    } catch {
      this.toast.showError('Failed to add ValueSet to clipboard.', 'Clipboard');
    }
  }

  addExpansionCodingToAppClipboard(row: { code?: string; display?: string; system?: string }): void {
    const system = row.system?.trim();
    const code = row.code?.trim();
    if (!system || !code) {
      this.toast.showWarning('Code is missing system or code.', 'Clipboard');
      return;
    }
    const coding: Coding = { system, code, display: row.display };
    try {
      this.clipboard.addCoding(coding);
      this.toast.showSuccess('Coding added to clipboard.', 'Clipboard');
    } catch {
      this.toast.showError('Failed to add coding to clipboard.', 'Clipboard');
    }
  }

  addCodingToAppClipboard(row: { code?: string; display?: string; system?: string }): void {
    this.addExpansionCodingToAppClipboard(row);
  }

  async importLoadedValueSetToTerminology(): Promise<void> {
    if (this.loading()) return;
    if (this.terminologyImportWarning()) {
      this.toast.showWarning('Point Terminology Services at a writable server, not Cartos.', 'Import');
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
    this.dependencyBusy.set(true);
    this.error.set(null);
    this.dependencyStatusMessage.set(null);
    try {
      const rootNode = await buildValueSetDependencyTree(root, (ref) =>
        firstValueFrom(this.cartos.fetchValueSetByOidOrCanonicalUrl(ref))
      );
      this.dependencyTree.set(rootNode);
      const count = this.dependencyImportNodes().length;
      this.dependencyStatusMessage.set(
        `Dependency tree built. ${count} ValueSet${count === 1 ? '' : 's'} ready to import.`
      );
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
      this.toast.showWarning('Point Terminology Services at a writable server, not Cartos.', 'Import');
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
        await this.remoteImport.postValueSet(node.valueSet);
        success += 1;
      } catch (e) {
        failed += 1;
        this.toast.showError(`${valueSetDisplayName(node.valueSet)}: ${this.errMsg(e)}`, 'Dependency import failed');
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
      this.toast.showWarning('Point Terminology Services at a writable server, not Cartos.', 'Import');
      return;
    }
    await this.postValueSetToTerminologyServer(vs);
  }

  private async postValueSetToTerminologyServer(toSend: ValueSet): Promise<void> {
    this.loading.set(true);
    try {
      await this.remoteImport.postValueSet(toSend);
      this.toast.showSuccess('ValueSet posted to terminology server.', 'Import');
    } catch (e) {
      this.toast.showError(this.errMsg(e), 'Import failed');
    } finally {
      this.loading.set(false);
    }
  }

  async runCodeSystemSearch(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      const bundle = await firstValueFrom(
        this.cartos.searchCodeSystems({
          nameContains: this.csSearchName().trim() || undefined,
          url: this.csSearchUrl().trim() || undefined,
          _count: this.csSearchCount(),
        })
      );
      const list =
        bundle.entry
          ?.map((e) => e.resource)
          .filter((r): r is CodeSystem => isResourceType(r, 'CodeSystem')) ?? [];
      this.codeSystemResults.set(list);
    } catch (e) {
      this.codeSystemResults.set([]);
      const msg = this.errMsg(e);
      this.error.set(msg);
      this.toast.showError(msg, 'CodeSystem search failed');
    } finally {
      this.loading.set(false);
    }
  }

  async selectCodeSystem(cs: CodeSystem): Promise<void> {
    if (!cs.id || this.loading()) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      const full = await firstValueFrom(this.cartos.getCodeSystemById(cs.id));
      this.loadedCodeSystem.set(full);
      this.activeTab.set('codesystem');
    } catch (e) {
      this.loadedCodeSystem.set(null);
      const msg = this.errMsg(e);
      this.error.set(msg);
      this.toast.showError(msg, 'Load CodeSystem failed');
    } finally {
      this.loading.set(false);
    }
  }

  loadedCodeSystemJson(): string {
    const cs = this.loadedCodeSystem();
    if (!cs) return '';
    try {
      return JSON.stringify(cs, null, 2);
    } catch {
      return '';
    }
  }
}
