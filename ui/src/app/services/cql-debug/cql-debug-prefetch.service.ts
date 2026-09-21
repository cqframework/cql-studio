// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { Bundle, ValueSet } from 'fhir/r4';
import { PatientService } from '../patient.service';
import { TerminologyService } from '../terminology.service';
import { TranslationService } from '../translation.service';
import { CqlLibrarySourceService } from '../cql-library-source.service';
import { CqlModelInfoService } from '../cql-model-info.service';
import { SettingsService } from '../settings.service';
import { buildHttpHeaders } from '../endpoint-config.lib';
import type { PrefetchedValueSetExpansion } from './cql-debug-terminology-provider';
import type { CqlDebugStartPayload } from './cql-debug-protocol';
import type { CqlDebugBreakpointSpec } from './cql-debug-breakpoint-handler';

interface CqlDebugPrefetchInput {
  libraryName: string;
  libraryVersion?: string | null;
  cql: string;
  subjectId: string | null;
  expressionNames: string[];
  breakpoints: CqlDebugBreakpointSpec[];
  elmXml?: string | null;
}

@Injectable({ providedIn: 'root' })
export class CqlDebugPrefetchService {
  private readonly patientService = inject(PatientService);
  private readonly terminologyService = inject(TerminologyService);
  private readonly translationService = inject(TranslationService);
  private readonly modelInfoService = inject(CqlModelInfoService);
  private readonly librarySourceService = inject(CqlLibrarySourceService);
  private readonly settingsService = inject(SettingsService);
  private readonly http = inject(HttpClient);

  async buildStartPayload(input: CqlDebugPrefetchInput): Promise<CqlDebugStartPayload> {
    await this.translationService.ensureTranslationAssetsLoaded();
    await this.modelInfoService.prefetchForCql(input.cql);
    const assets = this.translationService.getDebugTranslationAssets(input.cql);

    let bundle: Bundle | null = null;
    if (input.subjectId) {
      bundle = await this.prefetchPatientBundle(input.subjectId);
    }

    const valueSetUrls = new Set(this.extractValueSetUrls(input.cql, input.elmXml));
    try {
      // Prefer CQL include directives; ELM is only a supplement when CQL is absent.
      if (input.cql?.trim()) {
        await this.librarySourceService.prefetchIncludesFromCql(input.cql);
      } else if (input.elmXml) {
        await this.librarySourceService.prefetchIncludesFromElmXml(input.elmXml);
      }
    } catch {
      // Continue with whatever is already cached; session runner will fail clearly if missing.
    }
    const includeSources = this.collectIncludeSources(input.elmXml, input.cql);
    for (const include of includeSources) {
      for (const url of this.extractValueSetUrls(include.cql)) {
        valueSetUrls.add(url);
      }
    }

    const valueSetExpansions: PrefetchedValueSetExpansion[] = [];
    for (const url of valueSetUrls) {
      try {
        const expanded = await firstValueFrom(
          this.terminologyService.expandValueSet({ url })
        );
        valueSetExpansions.push(this.toExpansion(url, expanded));
      } catch {
        valueSetExpansions.push({ url, codes: [] });
      }
    }

    return {
      libraryName: input.libraryName,
      libraryVersion: input.libraryVersion ?? '0.0.1',
      cql: input.cql,
      includeSources,
      systemModelInfoXml: assets.systemModelInfoXml,
      fhirModelInfoXml: assets.fhirModelInfoXml,
      modelInfoByKey: assets.modelInfoByKey,
      fhirHelpersCql: assets.fhirHelpersCql,
      subjectId: input.subjectId,
      expressionNames: input.expressionNames,
      bundle,
      valueSetExpansions,
      breakpoints: input.breakpoints,
    };
  }

  /** Build a patient-compartment snapshot via paginated `$everything`. */
  private async prefetchPatientBundle(subjectId: string): Promise<Bundle> {
    let firstPage: Bundle;
    try {
      firstPage = await firstValueFrom(
        this.patientService.getEverything(subjectId, { count: 500 })
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Data endpoint did not respond to Patient/$everything for subject ${subjectId}. ` +
          `Debug requires $everything to retrieve the patient compartment. ${detail}`
      );
    }
    return this.fetchAllBundlePages(firstPage);
  }

  private async fetchAllBundlePages(first: Bundle): Promise<Bundle> {
    const entries: NonNullable<Bundle['entry']> = [...(first.entry ?? [])];
    let nextUrl = first.link?.find(l => l.relation === 'next')?.url;
    let guard = 0;
    while (nextUrl && guard < 50) {
      guard += 1;
      try {
        const page = await this.getBundleUrl(nextUrl);
        entries.push(...(page.entry ?? []));
        nextUrl = page.link?.find(l => l.relation === 'next')?.url;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Data endpoint failed while paging Patient/$everything results. ${detail}`
        );
      }
    }
    return {
      resourceType: 'Bundle',
      type: first.type ?? 'collection',
      entry: entries,
    };
  }

  private getBundleUrl(url: string): Promise<Bundle> {
    const ctx = this.settingsService.getEndpointHttpContext('data', {
      Accept: 'application/fhir+json',
    });
    const headers = buildHttpHeaders(
      { ...this.settingsService.getActiveEnvironment().dataEndpoint, address: ctx.address },
      ctx.headers
    );
    return firstValueFrom(this.http.get<Bundle>(url, { headers }));
  }

  private extractValueSetUrls(cql: string, elmXml?: string | null): string[] {
    const urls = new Set<string>();
    const valuesetRegex = /valueset\s+"[^"]+"\s*:\s*'([^']+)'/gi;
    let match: RegExpExecArray | null;
    while ((match = valuesetRegex.exec(cql))) {
      urls.add(match[1]);
    }
    if (elmXml) {
      const urlAttr = /valueSet[^>]*name="([^"]+)"/gi;
      while ((match = urlAttr.exec(elmXml))) {
        if (match[1].startsWith('http')) {
          urls.add(match[1]);
        }
      }
    }
    return [...urls];
  }

  private toExpansion(url: string, valueSet: ValueSet): PrefetchedValueSetExpansion {
    const codes =
      valueSet.expansion?.contains?.map(c => ({
        code: c.code ?? '',
        system: c.system,
        display: c.display,
      })).filter(c => c.code) ??
      valueSet.compose?.include?.flatMap(include =>
        (include.concept ?? []).map(concept => ({
          code: concept.code,
          system: include.system,
          display: concept.display,
        }))
      ) ??
      [];
    return { url, codes };
  }

  private collectIncludeSources(
    elmXml?: string | null,
    rootCql?: string | null
  ): Array<{ id: string; version?: string | null; cql: string }> {
    // CQL include directives when present; ELM only if root CQL is unavailable.
    return this.librarySourceService
      .collectTransitiveCachedSources(elmXml ?? '', rootCql)
      .map(source => ({
        id: source.id,
        version: source.version,
        cql: source.cql,
      }));
  }
}

export function countResourcesByType(bundle: Bundle | null | undefined): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of bundle?.entry ?? []) {
    const type = entry.resource?.resourceType;
    if (!type) {
      continue;
    }
    counts[type] = (counts[type] ?? 0) + 1;
  }
  return counts;
}
