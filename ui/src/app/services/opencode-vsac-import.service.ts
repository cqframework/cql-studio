// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { Bundle, Resource, ValueSet } from 'fhir/r4';
import { isReadOnlyTerminologyEndpointUrl, isReadOnlyTerminologyAuthorityHost } from '@cql-studio/core';
import { SettingsService } from './settings.service';
import { TerminologyService } from './terminology.service';
import { VsacService } from './vsac.service';
import { buildTerminologySymbolIndex } from './cql-terminology-symbols.lib';
import { isResourceType } from './fhir-resource-type.lib';
import { describeFhirHttpFailure } from './fhir-http-error.lib';
import { composeFromExpandedValueSet } from './vsac-valueset-materialize.lib';

const MAX_VALUESETS_PER_IMPORT = 50;
const MAX_EXPANSION_CONCEPTS = 20_000;
/** CTS returns at most 1000 concepts per `$expand`, even when `count` is higher. */
const VSAC_EXPAND_PAGE_SIZE = 1000;
/** Enough to surface duplicate canonical copies (same url, different ids/versions). */
const MAX_CANONICAL_MATCHES = 20;
const VSAC_HOSTS = new Set(['cts.nlm.nih.gov', 'uat-cts.nlm.nih.gov']);

export interface OpenCodeVsacImportItem {
  canonicalUrl: string;
  title: string;
  version?: string;
  status: 'already-present' | 'imported';
  conceptCount?: number;
}

export interface OpenCodeVsacImportSummary {
  target: string;
  items: OpenCodeVsacImportItem[];
  imported: number;
  alreadyPresent: number;
}

export interface OpenCodeVsacImportFailure {
  canonicalUrl: string;
  message: string;
}

export interface OpenCodeVsacImportProgress {
  phase: 'check' | 'expand' | 'post';
  /** Canonical URL for check and expand. Empty while posting a batch. */
  canonicalUrl: string;
  index: number;
  total: number;
  /** Resources included in a post batch. */
  count: number;
}

export interface OpenCodeVsacBatchedImportSummary extends OpenCodeVsacImportSummary {
  failures: OpenCodeVsacImportFailure[];
}

export function isVsacCanonicalUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && VSAC_HOSTS.has(url.hostname.toLowerCase())
      && /\/fhir\/ValueSet\/[A-Za-z0-9.%-]+\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

export function extractVsacCanonicalUrls(cql: string): string[] {
  const urls = buildTerminologySymbolIndex(cql).declarations
    .filter(item => item.kind === 'ValueSet' && isVsacCanonicalUrl(item.url))
    .map(item => item.url.trim());
  return [...new Set(urls)];
}

/** Canonical VSAC ValueSet URLs referenced by compose include or exclude. Version suffixes are removed. */
export function includedVsacValueSetUrls(valueSet: ValueSet | null | undefined): string[] {
  if (!valueSet) return [];
  const references = [
    ...(valueSet.compose?.include ?? []),
    ...(valueSet.compose?.exclude ?? []),
  ].flatMap(clause => clause.valueSet ?? []);
  const urls = references
    .map(reference => {
      const trimmed = reference.trim();
      const pipe = trimmed.indexOf('|');
      return pipe >= 0 ? trimmed.slice(0, pipe) : trimmed;
    })
    .filter(url => isVsacCanonicalUrl(url));
  return [...new Set(urls)];
}

@Injectable({ providedIn: 'root' })
export class OpenCodeVsacImportService {
  private readonly settings = inject(SettingsService);
  private readonly terminology = inject(TerminologyService);
  private readonly vsac = inject(VsacService);

  async importForCql(cql: string): Promise<OpenCodeVsacImportSummary> {
    return this.importCanonicalUrls(extractVsacCanonicalUrls(cql));
  }

  async importCanonicalUrls(urls: string[]): Promise<OpenCodeVsacImportSummary> {
    const summary = await this.importGraph(urls, { enforceInitialLimit: true, collectFailures: false });
    return {
      target: summary.target,
      items: summary.items,
      imported: summary.imported,
      alreadyPresent: summary.alreadyPresent,
    };
  }

  /**
   * Same expand-and-upsert path as `importCanonicalUrls`, in groups of 50.
   * A single ValueSet failure is recorded and the rest of the batch continues.
   * Included ValueSets are imported after the ValueSet that references them.
   * The per-value-set expansion ceiling is unchanged.
   */
  async importCanonicalUrlsBatched(
    urls: string[],
    onProgress?: (progress: OpenCodeVsacImportProgress) => void,
  ): Promise<OpenCodeVsacBatchedImportSummary> {
    return this.importGraph(urls, { enforceInitialLimit: false, collectFailures: true, onProgress });
  }

  /**
   * Import the requested ValueSets, then ValueSets referenced from compose include/exclude.
   * IDE import and CMS measure import both use this walk.
   */
  private async importGraph(
    urls: string[],
    options: {
      enforceInitialLimit: boolean;
      collectFailures: boolean;
      onProgress?: (progress: OpenCodeVsacImportProgress) => void;
    },
  ): Promise<OpenCodeVsacBatchedImportSummary> {
    const seen = new Set<string>();
    const queue: string[] = [];
    this.enqueueUrls(urls, seen, queue);
    const items: OpenCodeVsacImportItem[] = [];
    const failures: OpenCodeVsacImportFailure[] = [];
    let imported = 0;
    let alreadyPresent = 0;
    let target = this.settings.getEffectiveTerminologyEndpointAddress().trim();
    let initialWave = true;

    while (queue.length > 0) {
      const wave = queue.splice(0, queue.length);
      const classified = await this.classifyCanonicals(wave, options.onProgress);
      target = classified.target;
      alreadyPresent += classified.items.length;
      items.push(...classified.items);
      this.enqueueIncludes(classified.relatedValueSets, seen, queue);

      if (
        initialWave
        && options.enforceInitialLimit
        && classified.pending.length > MAX_VALUESETS_PER_IMPORT
      ) {
        throw new Error(
          `Import requires ${classified.pending.length} VSAC ValueSets not already present on the terminology server; at most ${MAX_VALUESETS_PER_IMPORT} can be imported at once.`,
        );
      }
      initialWave = false;
      if (classified.pending.length === 0) {
        continue;
      }

      this.assertWritableTarget(target);
      if (options.collectFailures && !this.settings.vsacHasApiCredentials()) {
        throw new Error('VSAC credentials are required to import value sets. Configure them in Settings.');
      }

      const outcome = await this.expandAndPost(classified.pending, {
        collectFailures: options.collectFailures,
        onProgress: options.onProgress,
        onDefinition: (definition) => this.enqueueIncludes([definition], seen, queue),
      });
      imported += outcome.imported;
      items.push(...outcome.items);
      failures.push(...outcome.failures);
    }

    return { target, items, imported, alreadyPresent, failures };
  }

  private async classifyCanonicals(
    urls: string[],
    onProgress?: (progress: OpenCodeVsacImportProgress) => void,
  ): Promise<{
    target: string;
    items: OpenCodeVsacImportItem[];
    pending: Array<{ canonicalUrl: string; matches: ValueSet[] }>;
    relatedValueSets: ValueSet[];
  }> {
    const canonicalUrls = [...new Set(urls.map(url => url.trim()).filter(url => isVsacCanonicalUrl(url)))];
    const target = this.settings.getEffectiveTerminologyEndpointAddress().trim();
    const items: OpenCodeVsacImportItem[] = [];
    const pending: Array<{ canonicalUrl: string; matches: ValueSet[] }> = [];
    const relatedValueSets: ValueSet[] = [];
    for (let index = 0; index < canonicalUrls.length; index++) {
      const canonicalUrl = canonicalUrls[index];
      onProgress?.({
        phase: 'check',
        canonicalUrl,
        index: index + 1,
        total: canonicalUrls.length,
        count: 0,
      });
      const matches = await this.findMatchesOnTerminologyServer(canonicalUrl);
      const present = await this.resolvePresentValueSet(matches, canonicalUrl);
      if (present) {
        items.push({
          canonicalUrl,
          title: present.valueSet.title || present.valueSet.name || present.valueSet.id || canonicalUrl,
          version: present.valueSet.version,
          status: 'already-present',
          conceptCount: present.conceptCount,
        });
        relatedValueSets.push(present.valueSet);
        continue;
      }
      pending.push({ canonicalUrl, matches });
      relatedValueSets.push(...matches);
    }
    return { target, items, pending, relatedValueSets };
  }

  private enqueueUrls(urls: string[], seen: Set<string>, queue: string[]): void {
    for (const url of urls) {
      const canonicalUrl = url.trim();
      if (!isVsacCanonicalUrl(canonicalUrl) || seen.has(canonicalUrl)) continue;
      seen.add(canonicalUrl);
      queue.push(canonicalUrl);
    }
  }

  private enqueueIncludes(valueSets: ValueSet[], seen: Set<string>, queue: string[]): void {
    this.enqueueUrls(valueSets.flatMap(valueSet => includedVsacValueSetUrls(valueSet)), seen, queue);
  }

  private async expandAndPost(
    pending: Array<{ canonicalUrl: string; matches: ValueSet[] }>,
    options: {
      collectFailures: boolean;
      onProgress?: (progress: OpenCodeVsacImportProgress) => void;
      onDefinition: (definition: ValueSet) => void;
    },
  ): Promise<{ imported: number; items: OpenCodeVsacImportItem[]; failures: OpenCodeVsacImportFailure[] }> {
    const items: OpenCodeVsacImportItem[] = [];
    const failures: OpenCodeVsacImportFailure[] = [];
    let imported = 0;
    for (let offset = 0; offset < pending.length; offset += MAX_VALUESETS_PER_IMPORT) {
      const chunk = pending.slice(offset, offset + MAX_VALUESETS_PER_IMPORT);
      const resources: ValueSet[] = [];
      const chunkItems: OpenCodeVsacImportItem[] = [];
      for (let index = 0; index < chunk.length; index++) {
        const entry = chunk[index];
        options.onProgress?.({
          phase: 'expand',
          canonicalUrl: entry.canonicalUrl,
          index: offset + index + 1,
          total: pending.length,
          count: 0,
        });
        try {
          const definition = await this.fetchDefinition(entry.canonicalUrl);
          options.onDefinition(definition);
          const expanded = await this.expandLoaded(entry.canonicalUrl, entry.matches, definition);
          resources.push(expanded.resource);
          chunkItems.push(expanded.item);
        } catch (error) {
          if (!options.collectFailures) {
            throw error;
          }
          failures.push({
            canonicalUrl: entry.canonicalUrl,
            message: error instanceof Error ? error.message : 'Value set expansion failed.',
          });
        }
      }
      if (resources.length === 0) {
        continue;
      }
      try {
        options.onProgress?.({
          phase: 'post',
          canonicalUrl: '',
          index: Math.floor(offset / MAX_VALUESETS_PER_IMPORT) + 1,
          total: Math.ceil(pending.length / MAX_VALUESETS_PER_IMPORT),
          count: resources.length,
        });
        await this.postValueSets(resources);
        imported += resources.length;
        items.push(...chunkItems);
      } catch (error) {
        if (!options.collectFailures) {
          throw error;
        }
        const message = error instanceof Error ? error.message : 'Failed to post VSAC ValueSets.';
        for (const item of chunkItems) {
          failures.push({ canonicalUrl: item.canonicalUrl, message });
        }
      }
    }
    return { imported, items, failures };
  }

  private async expandValueSetCompletely(id: string, canonicalUrl: string): Promise<ValueSet> {
    const contains: NonNullable<NonNullable<ValueSet['expansion']>['contains']> = [];
    let expansion: ValueSet['expansion'];
    let offset = 0;
    let total: number | undefined;
    while (offset <= MAX_EXPANSION_CONCEPTS) {
      const page = await firstValueFrom(this.vsac.expandValueSetGet(id, {
        count: VSAC_EXPAND_PAGE_SIZE,
        ...(offset > 0 ? { offset } : {}),
      }));
      const pageContains = page.expansion?.contains ?? [];
      total = page.expansion?.total ?? total;
      if (typeof total === 'number' && total > MAX_EXPANSION_CONCEPTS) {
        throw new Error(`VSAC expansion for ${canonicalUrl} contains ${total} concepts, exceeding the ${MAX_EXPANSION_CONCEPTS} concept import limit.`);
      }
      if (!expansion && page.expansion) {
        expansion = page.expansion;
      }
      contains.push(...pageContains);
      if (pageContains.length === 0) {
        break;
      }
      offset += pageContains.length;
      if (typeof total === 'number' && offset >= total) {
        break;
      }
      if (typeof total !== 'number' && pageContains.length < VSAC_EXPAND_PAGE_SIZE) {
        break;
      }
    }
    if (!expansion || (typeof total === 'number' && total > 0 && contains.length === 0)) {
      throw new Error(`VSAC did not return a usable expansion for ${canonicalUrl}.`);
    }
    if (typeof total === 'number' && contains.length < total) {
      throw new Error(`VSAC expansion for ${canonicalUrl} returned ${contains.length} of ${total} concepts.`);
    }
    return {
      resourceType: 'ValueSet',
      status: 'active',
      expansion: {
        ...expansion,
        contains,
        total: contains.length,
      },
    };
  }

  private async fetchDefinition(canonicalUrl: string): Promise<ValueSet> {
    if (!this.settings.vsacHasApiCredentials()) {
      throw new Error(`VSAC credentials are required to import ${canonicalUrl}. Configure them in Settings.`);
    }
    let definition: ValueSet;
    try {
      definition = await firstValueFrom(this.vsac.fetchValueSetByOidOrCanonicalUrl(canonicalUrl));
    } catch (error) {
      throw new Error(`Failed to fetch ${canonicalUrl} from VSAC: ${describeFhirHttpFailure(error)}`);
    }
    if (!definition.id || definition.url !== canonicalUrl) {
      throw new Error(`VSAC did not return an exact ValueSet match for ${canonicalUrl}.`);
    }
    return definition;
  }

  private async expandLoaded(
    canonicalUrl: string,
    matches: ValueSet[],
    definition: ValueSet,
  ): Promise<{ resource: ValueSet; item: OpenCodeVsacImportItem }> {
    const id = definition.id;
    if (!id) {
      throw new Error(`VSAC did not return an exact ValueSet match for ${canonicalUrl}.`);
    }
    let expanded: ValueSet;
    try {
      expanded = await this.expandValueSetCompletely(id, canonicalUrl);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('VSAC expansion for ')) {
        throw error;
      }
      if (error instanceof Error && error.message.startsWith('VSAC did not return')) {
        throw error;
      }
      throw new Error(`Failed to expand ${canonicalUrl} from VSAC: ${describeFhirHttpFailure(error)}`);
    }
    const conceptCount = expanded.expansion?.contains?.length ?? 0;
    const compose = composeFromExpandedValueSet(expanded);
    const resource: ValueSet = {
      ...definition,
      expansion: expanded.expansion,
      resourceType: 'ValueSet',
      // Prefer an existing local id (especially one matching VSAC's logical id) so we
      // refresh in place instead of creating a duplicate under the same canonical URL.
      id: this.chooseRefreshId(matches, id),
      url: definition.url,
      // Grouping ValueSets only reference other ValueSets. HAPI $expand resolves those
      // includes and fails when they are absent, ignoring the stored expansion.
      ...(compose ? { compose } : {}),
    };
    return {
      resource,
      item: {
        canonicalUrl,
        title: resource.title || resource.name || resource.id || canonicalUrl,
        version: resource.version,
        status: 'imported',
        conceptCount,
      },
    };
  }

  private async postValueSets(resources: ValueSet[]): Promise<void> {
    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: resources.map(resource => ({ resource: resource as Resource })),
    };
    try {
      await firstValueFrom(this.terminology.postBundle(bundle));
    } catch (error) {
      throw new Error(`Failed to post VSAC ValueSets to the terminology server: ${describeFhirHttpFailure(error)}`);
    }
  }

  private async findMatchesOnTerminologyServer(canonicalUrl: string): Promise<ValueSet[]> {
    const bundle = await firstValueFrom(this.terminology.searchValueSets({
      url: canonicalUrl,
      _count: MAX_CANONICAL_MATCHES,
    }));
    return (bundle.entry ?? [])
      .map(entry => entry.resource)
      .filter((resource): resource is ValueSet =>
        isResourceType(resource, 'ValueSet') && resource.url === canonicalUrl);
  }

  private async resolvePresentValueSet(
    matches: ValueSet[],
    canonicalUrl: string,
  ): Promise<{ valueSet: ValueSet; conceptCount?: number } | null> {
    if (matches.length === 0) return null;

    for (const match of matches) {
      if (!match.id) continue;
      const expanded = await this.tryExpand({ id: match.id });
      if (expanded) {
        return {
          valueSet: match,
          conceptCount: expanded === 'not-preexpanded'
            ? match.expansion?.total ?? match.expansion?.contains?.length
            : expanded.expansion?.total ?? expanded.expansion?.contains?.length,
        };
      }
    }

    const byUrl = await this.tryExpand({ url: canonicalUrl });
    if (byUrl) {
      return {
        valueSet: matches[0],
        conceptCount: byUrl === 'not-preexpanded'
          ? matches[0].expansion?.total ?? matches[0].expansion?.contains?.length
          : byUrl.expansion?.total ?? byUrl.expansion?.contains?.length,
      };
    }
    return null;
  }

  /**
   * `$expand?count=1` returns HAPI-0831 until a ValueSet is pre-expanded, when the
   * expansion is larger than `count`. That still means the server can expand it.
   */
  private async tryExpand(params: { id?: string; url?: string }): Promise<ValueSet | 'not-preexpanded' | null> {
    try {
      const expanded = await firstValueFrom(this.terminology.expandValueSet({
        ...params,
        count: 1,
      }));
      return this.hasUsableExpansion(expanded) ? expanded : null;
    } catch (error) {
      const message = describeFhirHttpFailure(error);
      if (message.includes('HAPI-0831') || message.includes('produced too many codes')) {
        return 'not-preexpanded';
      }
      return null;
    }
  }

  private chooseRefreshId(matches: ValueSet[], vsacId: string): string {
    const matchingVsacId = matches.find(match => match.id === vsacId)?.id;
    if (matchingVsacId) return matchingVsacId;
    const firstLocalId = matches.find(match => typeof match.id === 'string' && match.id.trim())?.id;
    if (firstLocalId) return firstLocalId;
    return vsacId;
  }

  private hasUsableExpansion(valueSet: ValueSet): boolean {
    // A successful $expand of an empty extensional ValueSet may omit both contains and total.
    return valueSet.expansion != null;
  }

  private assertWritableTarget(target: string): void {
    if (!target) throw new Error('Configure a terminology endpoint before importing VSAC ValueSets.');
    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      throw new Error('The configured terminology endpoint URL is invalid.');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('The configured terminology endpoint must use HTTP or HTTPS.');
    }
    if (isReadOnlyTerminologyAuthorityHost(parsed.hostname) || isReadOnlyTerminologyEndpointUrl(target)) {
      throw new Error('The configured terminology endpoint is a read-only authority (VSAC/NLM or Cartos). Select a writable terminology server.');
    }
  }
}