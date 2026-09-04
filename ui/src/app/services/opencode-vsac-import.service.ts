// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { Bundle, Resource, ValueSet } from 'fhir/r4';
import { SettingsService } from './settings.service';
import { TerminologyService } from './terminology.service';
import { VsacService } from './vsac.service';
import { buildTerminologySymbolIndex } from './cql-terminology-symbols.lib';
import { isResourceType } from './fhir-resource-type.lib';

const MAX_VALUESETS_PER_SAVE = 20;
const MAX_EXPANSION_CONCEPTS = 20_000;
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
    const canonicalUrls = extractVsacCanonicalUrls(cql);
    const target = this.settings.getEffectiveTerminologyEndpointAddress().trim();
    if (canonicalUrls.length === 0) {
      return { target, items: [], imported: 0, alreadyPresent: 0 };
    }
    if (canonicalUrls.length > MAX_VALUESETS_PER_SAVE) {
      throw new Error(`CQL references ${canonicalUrls.length} VSAC ValueSets; at most ${MAX_VALUESETS_PER_SAVE} can be imported in one save.`);
    }
    this.assertWritableTarget(target);

    const items: OpenCodeVsacImportItem[] = [];
    const resources: ValueSet[] = [];
    for (const canonicalUrl of canonicalUrls) {
      const existing = await this.findOnTerminologyServer(canonicalUrl);
      const existingExpansion = existing
        ? await this.expandOnTerminologyServer(existing, canonicalUrl)
        : null;
      if (existing && existingExpansion) {
        items.push({
          canonicalUrl,
          title: existing.title || existing.name || existing.id || canonicalUrl,
          version: existing.version,
          status: 'already-present',
          conceptCount: existingExpansion.expansion?.total
            ?? existingExpansion.expansion?.contains?.length,
        });
        continue;
      }
      if (!this.settings.vsacHasApiCredentials()) {
        throw new Error(`VSAC credentials are required to import ${canonicalUrl}. Configure them in Settings.`);
      }
      const definition = await firstValueFrom(this.vsac.fetchValueSetByOidOrCanonicalUrl(canonicalUrl));
      if (!definition.id || definition.url !== canonicalUrl) {
        throw new Error(`VSAC did not return an exact ValueSet match for ${canonicalUrl}.`);
      }
      const expanded = await firstValueFrom(this.vsac.expandValueSetGet(definition.id, {
        count: MAX_EXPANSION_CONCEPTS,
      }));
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
        // Refresh an unusable resource in place instead of creating a duplicate
        // with the same canonical URL under VSAC's logical id.
        id: existing?.id || definition.id,
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

    if (resources.length > 0) {
      const bundle: Bundle = {
        resourceType: 'Bundle',
        type: 'collection',
        entry: resources.map(resource => ({ resource: resource as Resource })),
      };
      await firstValueFrom(this.terminology.postBundle(bundle));
    }
    return {
      target,
      items,
      imported: resources.length,
      alreadyPresent: items.length - resources.length,
    };
  }

  private async findOnTerminologyServer(canonicalUrl: string): Promise<ValueSet | null> {
    const bundle = await firstValueFrom(this.terminology.searchValueSets({ url: canonicalUrl, _count: 1 }));
    return bundle.entry
      ?.map(entry => entry.resource)
      .find((resource): resource is ValueSet => isResourceType(resource, 'ValueSet') && resource.url === canonicalUrl)
      ?? null;
  }

  private async expandOnTerminologyServer(existing: ValueSet, canonicalUrl: string): Promise<ValueSet | null> {
    if (this.hasUsableExpansion(existing)) return existing;
    try {
      const expanded = await firstValueFrom(this.terminology.expandValueSet({
        url: canonicalUrl,
        count: 1,
      }));
      return this.hasUsableExpansion(expanded) ? expanded : null;
    } catch {
      return null;
    }
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
    if (VSAC_HOSTS.has(parsed.hostname.toLowerCase()) || parsed.hostname.toLowerCase().endsWith('.nlm.nih.gov')) {
      throw new Error('The configured terminology endpoint is VSAC/NLM and is read-only. Select a writable terminology server.');
    }
  }
}
