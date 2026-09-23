// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { describeFhirHttpFailure } from './fhir-http-error.lib';
import { Library, Resource } from 'fhir/r4';
import { CmsContentService } from './cms-content.service';
import { CmsMeasureSummary } from './cms-measure-catalog.lib';
import {
  CmsImportProgressReporter,
  cmsMeasureKey,
  describeVsacImportActivity,
  importProgressForLibrary,
  importProgressForMeasures,
  libraryReferenceMatches,
} from './cms-import-progress';
import { CmsImportOutcome, CmsMeasuresImportService } from './cms-measures-import.service';
import { CqlLibrarySourceService } from './cql-library-source.service';
import { CqlModelInfoService } from './cql-model-info.service';
import {
  CMS_COMPANION_LIBRARIES,
  CMS_COMPANION_VERSION_REWRITES,
  CMS_USCORE_MODELINFO_URL,
  CMS_USQUALITYCORE_MODELINFO_URL,
  alignCompanionLibrary,
  attachElm,
  isCmsLogicLibrary,
  prepareUsCoreModelInfo,
  prepareUsQualityCoreModelInfo,
  readLibraryCql,
  unqualifyLibraryCql,
  withoutNarrative,
} from './cms-execution-dependencies.lib';
import { extractVsacCanonicalUrls, OpenCodeVsacImportService } from './opencode-vsac-import.service';
import { SettingsService } from './settings.service';
import { TranslationService } from './translation.service';

export interface CmsExecutionImportGroup {
  label: string;
  measures: readonly CmsMeasureSummary[];
  resources: Resource[];
}

@Injectable({
  providedIn: 'root',
})
export class CmsExecutionPrepService {
  private readonly content = inject(CmsContentService);
  private readonly importer = inject(CmsMeasuresImportService);
  private readonly vsac = inject(OpenCodeVsacImportService);
  private readonly translation = inject(TranslationService);
  private readonly modelInfo = inject(CqlModelInfoService);
  private readonly librarySource = inject(CqlLibrarySourceService);
  private readonly settings = inject(SettingsService);

  /**
   * Install ModelInfo and companion libraries, post the measure closure, expand VSAC
   * value sets, then translate the closure and store ELM.
   */
  async importGroups(
    groups: CmsExecutionImportGroup[],
    onProgress: CmsImportProgressReporter
  ): Promise<CmsImportOutcome[]> {
    if (!this.settings.vsacHasApiCredentials()) {
      throw new Error('VSAC credentials are required to import CMS measures. Configure them in Settings.');
    }
    const measures = groups.flatMap((group) => group.measures);
    const shared = (stage: string, detail: string) => {
      onProgress(importProgressForMeasures(measures, measures, stage, detail));
    };
    const dependencies = await this.loadDependencies(measures, onProgress);
    this.cacheModelInfo(dependencies.modelInfo);
    this.cacheLogicLibraries(dependencies.companions);

    const outcomes: CmsImportOutcome[] = [];
    const modelOutcomes = await this.importer.importToEvaluationAndContent(dependencies.modelInfo, (target) => {
      shared('ModelInfo', `Installing ModelInfo on the ${target}`);
    });
    outcomes.push(...modelOutcomes);
    const companionOutcomes = await this.importer.importToEvaluationAndContent(
      dependencies.companions,
      (target) => {
        shared('Companion libraries', `Installing companion libraries on the ${target}`);
      }
    );
    outcomes.push(...companionOutcomes);

    const preparedGroups = groups.map((group) => ({
      ...group,
      resources: group.resources.map((resource) =>
        isCmsLogicLibrary(resource) ? unqualifyLibraryCql(resource) : resource
      ),
    }));
    for (const group of preparedGroups) {
      const measureCount = group.resources.filter((resource) => resource.resourceType === 'Measure').length;
      const libraryCount = group.resources.filter((resource) => resource.resourceType === 'Library').length;
      onProgress(
        importProgressForMeasures(
          group.measures,
          measures,
          'Posting resources',
          `Posting ${measureCount} measures and ${libraryCount} libraries from ${group.label} to the evaluation server`
        )
      );
      outcomes.push(...(await this.importer.importResources(group.resources)));
    }

    const logicLibraries = preparedGroups.flatMap((group) => group.resources.filter(isCmsLogicLibrary));
    this.cacheLogicLibraries(logicLibraries);
    outcomes.push(
      ...(await this.importValueSets(dependencies.companions, logicLibraries, measures, onProgress))
    );

    const dependenciesStored = modelOutcomes.every((item) => item.ok) && companionOutcomes.every((item) => item.ok);
    if (!dependenciesStored) {
      outcomes.push({
        resourceType: 'Library',
        id: 'elm',
        label: 'ELM',
        ok: false,
        message: 'ELM was not translated because ModelInfo or companion libraries were not stored.',
      });
      return outcomes;
    }

    outcomes.push(
      ...(await this.translateAndStore([...dependencies.companions, ...logicLibraries], measures, onProgress))
    );
    return outcomes;
  }

  private async loadDependencies(
    measures: readonly CmsMeasureSummary[],
    onProgress: CmsImportProgressReporter
  ): Promise<{ modelInfo: Library[]; companions: Library[] }> {
    const report = (stage: string, detail: string) => {
      onProgress(importProgressForMeasures(measures, measures, stage, detail));
    };
    report('ModelInfo', 'Loading USQualityCore ModelInfo');
    const xml = await this.fetchText(CMS_USQUALITYCORE_MODELINFO_URL, 'USQualityCore ModelInfo');
    const usQualityCore = withoutNarrative(prepareUsQualityCoreModelInfo(xml));
    report('ModelInfo', 'Loading USCore ModelInfo');
    const usCoreBody = await this.fetchJson(CMS_USCORE_MODELINFO_URL, 'USCore ModelInfo');
    const usCore = withoutNarrative(prepareUsCoreModelInfo(usCoreBody));
    const companions: Library[] = [];
    for (const spec of CMS_COMPANION_LIBRARIES) {
      report('Companion libraries', `Loading ${spec.name} ${spec.version}`);
      const body = await this.fetchJson(spec.url, spec.name);
      companions.push(
        withoutNarrative(
          alignCompanionLibrary(body, { name: spec.name, version: spec.version }, CMS_COMPANION_VERSION_REWRITES)
        )
      );
    }
    return { modelInfo: [usCore, usQualityCore], companions };
  }

  private async importValueSets(
    companions: Library[],
    logicLibraries: Library[],
    measures: readonly CmsMeasureSummary[],
    onProgress: CmsImportProgressReporter
  ): Promise<CmsImportOutcome[]> {
    const libraries = [...companions, ...logicLibraries];
    const urls = [
      ...new Set(libraries.flatMap((library) => extractVsacCanonicalUrls(readLibraryCql(library)))),
    ];
    if (urls.length === 0) {
      return [
        {
          resourceType: 'ValueSet',
          id: 'vsac-summary',
          label: 'VSAC value sets',
          ok: true,
          message: 'No VSAC value sets were declared.',
        },
      ];
    }
    const owners = valueSetOwners(logicLibraries, measures);
    onProgress(importProgressForMeasures(measures, measures, 'Value sets', `Preparing ${urls.length} value sets`));
    try {
      const summary = await this.vsac.importCanonicalUrlsBatched(urls, (progress) => {
        const scope = progress.canonicalUrl ? owners.get(progress.canonicalUrl) : undefined;
        onProgress(
          importProgressForMeasures(
            scope && scope.length > 0 ? scope : measures,
            measures,
            'Value sets',
            describeVsacImportActivity(progress)
          )
        );
      });
      const outcomes: CmsImportOutcome[] = [
        {
          resourceType: 'ValueSet',
          id: 'vsac-summary',
          label: 'VSAC value sets',
          ok: summary.failures.length === 0,
          message: `Imported ${summary.imported}, already present ${summary.alreadyPresent}, failed ${summary.failures.length}.`,
        },
      ];
      for (const failure of summary.failures) {
        outcomes.push({
          resourceType: 'ValueSet',
          id: failure.canonicalUrl,
          label: failure.canonicalUrl,
          ok: false,
          message: failure.message,
        });
      }
      return outcomes;
    } catch (err) {
      return [
        {
          resourceType: 'ValueSet',
          id: 'vsac-summary',
          label: 'VSAC value sets',
          ok: false,
          message: err instanceof Error ? err.message : 'VSAC value set import failed.',
        },
      ];
    }
  }

  private async translateAndStore(
    libraries: Library[],
    measures: readonly CmsMeasureSummary[],
    onProgress: CmsImportProgressReporter
  ): Promise<CmsImportOutcome[]> {
    const ordered: Library[] = [];
    const seen = new Set<string>();
    for (const library of libraries) {
      const key = `${library.name ?? ''}|${library.version ?? ''}|${library.id ?? ''}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      ordered.push(library);
    }

    const outcomes: CmsImportOutcome[] = [];
    const translated: Library[] = [];
    let stopped: CmsImportOutcome | null = null;
    for (const library of ordered) {
      const cql = readLibraryCql(library);
      const label = `${library.name ?? library.id ?? 'Library'} ${library.version ?? ''}`.trim();
      if (!cql.trim()) {
        outcomes.push(this.libraryOutcome(library, true, 'No CQL content; ELM was not generated.'));
        continue;
      }
      onProgress(importProgressForLibrary(library, measures, 'Translation', `Translating ${label}`));
      const result = await this.translation.translateCqlToElmAsync(cql);
      if (result.hasErrors || !result.elmJson?.trim()) {
        const message = result.errors.filter((item) => item.trim()).join('; ') || 'Translation failed.';
        stopped = this.libraryOutcome(library, false, message);
        break;
      }
      translated.push(attachElm(library, result.elmJson, result.elmXml));
    }

    if (translated.length > 0) {
      onProgress(
        importProgressForMeasures(
          measures,
          measures,
          'Storing ELM',
          `Storing ELM for ${translated.length} libraries on the evaluation server`
        )
      );
      const stored = await this.importer.importResources(translated);
      outcomes.push(
        ...stored.map((item) => ({
          ...item,
          message: item.ok ? `ELM stored (${item.message})` : `ELM was not stored: ${item.message}`,
        }))
      );
    }
    if (stopped) {
      outcomes.push(stopped);
    }
    return outcomes;
  }

  private cacheModelInfo(libraries: Library[]): void {
    for (const library of libraries) {
      this.modelInfo.xmlFromLibrary(library);
    }
  }

  private cacheLogicLibraries(libraries: Library[]): void {
    for (const library of libraries) {
      const cql = readLibraryCql(library);
      if (!library.name || !cql.trim()) {
        continue;
      }
      this.librarySource.setCachedCql(library.name, null, library.version, cql);
      const spec = CMS_COMPANION_LIBRARIES.find((item) => item.name === library.name);
      if (spec) {
        this.librarySource.setCachedCql(library.name, spec.system, library.version, cql);
      }
    }
  }

  private async fetchText(url: string, label: string): Promise<string> {
    try {
      const text = await this.content.fetchText(url);
      if (!text.trim()) {
        throw new Error(`${label} was empty at ${url}`);
      }
      return text;
    } catch (err) {
      throw dependencyFetchError(err, label, url);
    }
  }

  private async fetchJson(url: string, label: string): Promise<Library> {
    try {
      const body = await this.content.fetchJson<unknown>(url);
      if (!isLibrary(body)) {
        throw new Error(`${label} at ${url} is not a Library resource.`);
      }
      return body;
    } catch (err) {
      throw dependencyFetchError(err, label, url);
    }
  }

  private libraryOutcome(library: Library, ok: boolean, message: string): CmsImportOutcome {
    return {
      resourceType: 'Library',
      id: library.id ?? '',
      label: library.name || library.id || 'Library',
      ok,
      message,
    };
  }
}

function valueSetOwners(
  libraries: readonly Library[],
  measures: readonly CmsMeasureSummary[]
): Map<string, CmsMeasureSummary[]> {
  const owners = new Map<string, CmsMeasureSummary[]>();
  for (const library of libraries) {
    const matched = measures.filter((measure) =>
      measure.libraries.some((reference) => libraryReferenceMatches(library, reference))
    );
    if (matched.length === 0) {
      continue;
    }
    for (const url of extractVsacCanonicalUrls(readLibraryCql(library))) {
      const existing = owners.get(url) ?? [];
      for (const measure of matched) {
        const key = cmsMeasureKey(measure);
        if (!existing.some((item) => cmsMeasureKey(item) === key)) {
          existing.push(measure);
        }
      }
      owners.set(url, existing);
    }
  }
  return owners;
}

function isLibrary(value: unknown): value is Library {
  return !!value && typeof value === 'object' && (value as Library).resourceType === 'Library';
}

function httpStatus(err: unknown): number | null {
  return err instanceof HttpErrorResponse ? err.status : null;
}

function dependencyFetchError(err: unknown, label: string, url: string): Error {
  if (httpStatus(err) === 404) {
    return new Error(`${label} was not found at ${url}`);
  }
  if (err instanceof Error && !(err instanceof HttpErrorResponse)) {
    return err;
  }
  return new Error(`${label} could not be loaded from ${url}: ${describeFhirHttpFailure(err)}`);
}
