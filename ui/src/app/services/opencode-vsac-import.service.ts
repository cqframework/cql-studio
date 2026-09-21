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

const MAX_VALUESETS_PER_IMPORT = 50;
const MAX_EXPANSION_CONCEPTS = 20_000;
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

@Injectable({ providedIn: 'root' })
export class OpenCodeVsacImportService {
  private readonly settings = inject(SettingsService);
  private readonly terminology = inject(TerminologyService);
  private readonly vsac = inject(VsacService);

  async importForCql(cql: string): Promise<OpenCodeVsacImportSummary> {
    return this.importCanonicalUrls(extractVsacCanonicalUrls(cql));
  }

  async importCanonicalUrls(urls: string[]): Promise<OpenCodeVsacImportSummary> {
    const canonicalUrls = [...new Set(urls.map(url => url.trim()).filter(url => isVsacCanonicalUrl(url)))];
    const target = this.settings.getEffectiveTerminologyEndpointAddress().trim();
    if (canonicalUrls.length === 0) {
      return { target, items: [], imported: 0, alreadyPresent: 0 };
    }

    const items: OpenCodeVsacImportItem[] = [];
    const pending: Array<{ canonicalUrl: string; matches: ValueSet[] }> = [];
    for (const canonicalUrl of canonicalUrls) {
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
        continue;
      }
      pending.push({ canonicalUrl, matches });
    }

    if (pending.length > MAX_VALUESETS_PER_IMPORT) {
      throw new Error(
        `Import requires ${pending.length} VSAC ValueSets not already present on the terminology server; at most ${MAX_VALUESETS_PER_IMPORT} can be imported at once.`,
      );
    }
    if (pending.length === 0) {
      return { target, items, imported: 0, alreadyPresent: items.length };
    }

    this.assertWritableTarget(target);

    const resources: ValueSet[] = [];
    for (const { canonicalUrl, matches } of pending) {
      if (!this.settings.vsacHasApiCredentials()) {
        throw new Error(`VSAC credentials are required to import ${canonicalUrl}. Configure them in Settings.`);
      }
      let definition: ValueSet;
      let expanded: ValueSet;
      try {
        definition = await firstValueFrom(this.vsac.fetchValueSetByOidOrCanonicalUrl(canonicalUrl));
      } catch (error) {
        throw new Error(`Failed to fetch ${canonicalUrl} from VSAC: ${describeFhirHttpFailure(error)}`);
      }
      if (!definition.id || definition.url !== canonicalUrl) {
        throw new Error(`VSAC did not return an exact ValueSet match for ${canonicalUrl}.`);
      }
      try {
        expanded = await firstValueFrom(this.vsac.expandValueSetGet(definition.id, {
          count: MAX_EXPANSION_CONCEPTS,
        }));
      } catch (error) {
        throw new Error(`Failed to expand ${canonicalUrl} from VSAC: ${describeFhirHttpFailure(error)}`);
      }
      const conceptCount = expanded.expansion?.contains?.length ?? 0;
      const total = expanded.expansion?.total;
      if (typeof total === 'number' && total > conceptCount) {
        throw new Error(`VSAC expansion for ${canonicalUrl} contains ${total} concepts, exceeding the ${MAX_EXPANSION_CONCEPTS} concept import limit.`);
      }
      if (!expanded.expansion || (typeof total === 'number' && total > 0 && conceptCount === 0)) {
        throw new Error(`VSAC did not return a usable expansion for ${canonicalUrl}.`);
      }
      const resource: ValueSet = {
        ...definition,
        expansion: expanded.expansion,
        resourceType: 'ValueSet',
        // Prefer an existing local id (especially one matching VSAC's logical id) so we
        // refresh in place instead of creating a duplicate under the same canonical URL.
        id: this.chooseRefreshId(matches, definition.id),
        url: definition.url,
      };
      resources.push(resource);
      items.push({
        canonicalUrl,
        title: resource.title || resource.name || resource.id || canonicalUrl,
        version: resource.version,
        status: 'imported',
        conceptCount,
      });
    }

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
    return {
      target,
      items,
      imported: resources.length,
      alreadyPresent: items.length - resources.length,
    };
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

    const withExpansion = matches.find(match => this.hasUsableExpansion(match));
    if (withExpansion) {
      return {
        valueSet: withExpansion,
        conceptCount: withExpansion.expansion?.total
          ?? withExpansion.expansion?.contains?.length,
      };
    }

    for (const match of matches) {
      if (!match.id) continue;
      const expanded = await this.tryExpand({ id: match.id });
      if (expanded) {
        return {
          valueSet: match,
          conceptCount: expanded.expansion?.total
            ?? expanded.expansion?.contains?.length,
        };
      }
    }

    const byUrl = await this.tryExpand({ url: canonicalUrl });
    if (byUrl) {
      return {
        valueSet: matches[0],
        conceptCount: byUrl.expansion?.total
          ?? byUrl.expansion?.contains?.length,
      };
    }
    return null;
  }

  private async tryExpand(params: { id?: string; url?: string }): Promise<ValueSet | null> {
    try {
      const expanded = await firstValueFrom(this.terminology.expandValueSet({
        ...params,
        count: 1,
      }));
      return this.hasUsableExpansion(expanded) ? expanded : null;
    } catch {
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
    const expansion = valueSet.expansion;
    return Boolean(expansion && (
      Array.isArray(expansion.contains)
      || expansion.total === 0
    ));
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