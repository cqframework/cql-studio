// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Library, Measure, Resource } from 'fhir/r4';
import { SettingsService } from './settings.service';
import { CmsContentSource } from './cms-content-sources';
import {
  GithubContentEntry,
  isMeasureContentFile,
  libraryDependencyRefs,
  matchLibraryPath,
  parseCmsMeasureSummary,
  canonicalLibraryName,
  CmsMeasureSummary,
  resourceDedupeKey,
} from './cms-measure-catalog.lib';
import { CmsImportProgressReporter, importProgressForMeasures } from './cms-import-progress';

@Injectable({
  providedIn: 'root',
})
export class CmsContentService {
  private readonly http = inject(HttpClient);
  private readonly settingsService = inject(SettingsService);
  private readonly catalogCache = new Map<string, CmsMeasureSummary[]>();
  private readonly libraryListCache = new Map<string, GithubContentEntry[]>();
  private readonly resourceCache = new Map<string, Resource>();

  async listMeasures(
    source: CmsContentSource,
    onProgress?: (message: string) => void
  ): Promise<{ measures: CmsMeasureSummary[]; errors: string[] }> {
    const cached = this.catalogCache.get(source.id);
    if (cached) {
      return { measures: cached, errors: [] };
    }
    const entries = await this.getJson<GithubContentEntry[] | GithubContentEntry>(
      this.contentsUrl(source, source.measurePath)
    );
    const files = (Array.isArray(entries) ? entries : [entries]).filter(isMeasureContentFile);
    const summaries: CmsMeasureSummary[] = [];
    const errors: string[] = [];
    let index = 0;
    await this.mapPool(files, 6, async (file) => {
      index += 1;
      onProgress?.(`Loading ${source.label} measures (${index} of ${files.length})`);
      try {
        const resource = await this.getResource(source, file.path);
        if (resource?.resourceType === 'Measure') {
          const summary = parseCmsMeasureSummary(resource as Measure, source, file.path);
          if (summary) {
            summaries.push(summary);
          }
        }
      } catch (err) {
        errors.push(`${file.name}: ${err instanceof Error ? err.message : 'failed to load'}`);
      }
    });
    summaries.sort((a, b) => a.title.localeCompare(b.title) || a.cmsId.localeCompare(b.cmsId));
    if (errors.length === 0) {
      this.catalogCache.set(source.id, summaries);
    }
    return { measures: summaries, errors };
  }

  /**
   * Loads the selected measures and the library closure that resolves inside the same repo.
   * Libraries are ordered so dependencies precede dependents.
   */
  async loadImportResources(
    source: CmsContentSource,
    measures: readonly CmsMeasureSummary[],
    onProgress?: CmsImportProgressReporter
  ): Promise<{ resources: Resource[]; unresolved: string[] }> {
    const report = (scope: readonly CmsMeasureSummary[], detail: string) => {
      onProgress?.(importProgressForMeasures(scope, measures, 'Resolving libraries', detail));
    };
    report(measures, 'Loading the library index');
    const libraryFiles = await this.listLibraries(source);
    const unresolved: string[] = [];
    const ordered: Resource[] = [];
    const seen = new Set<string>();

    const visitLibrary = async (ref: string, scope: readonly CmsMeasureSummary[]): Promise<void> => {
      const path = matchLibraryPath(ref, libraryFiles);
      if (!path) {
        unresolved.push(ref);
        return;
      }
      if (seen.has(path)) {
        return;
      }
      seen.add(path);
      report(scope, `Loading library ${canonicalLibraryName(ref) || ref}`);
      const resource = await this.getResource(source, path);
      if (!resource || resource.resourceType !== 'Library') {
        unresolved.push(ref);
        return;
      }
      for (const dependency of libraryDependencyRefs(resource as Library, libraryFiles)) {
        await visitLibrary(dependency, scope);
      }
      const key = resourceDedupeKey(resource);
      if (!seen.has(key)) {
        seen.add(key);
        ordered.push(resource);
      }
    };

    for (const measure of measures) {
      report([measure], 'Resolving library references');
      for (const library of measure.libraries) {
        await visitLibrary(library, [measure]);
      }
    }

    for (const measure of measures) {
      report([measure], 'Loading measure definition');
      const resource = await this.getResource(source, measure.path);
      if (!resource) {
        unresolved.push(measure.path);
        continue;
      }
      const key = resourceDedupeKey(resource);
      if (!seen.has(key)) {
        seen.add(key);
        ordered.push(resource);
      }
    }

    return { resources: ordered, unresolved };
  }

  private async listLibraries(source: CmsContentSource): Promise<GithubContentEntry[]> {
    const cached = this.libraryListCache.get(source.id);
    if (cached) {
      return cached;
    }
    const entries = await this.getJson<GithubContentEntry[] | GithubContentEntry>(
      this.contentsUrl(source, source.libraryPath)
    );
    const files = (Array.isArray(entries) ? entries : [entries]).filter(isMeasureContentFile);
    this.libraryListCache.set(source.id, files);
    return files;
  }

  private async getResource(source: CmsContentSource, path: string): Promise<Resource | null> {
    const cacheKey = `${source.id}:${path}`;
    const cached = this.resourceCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const resource = await this.getJson<Resource>(this.rawUrl(source, path));
    if (!resource || typeof resource !== 'object' || !('resourceType' in resource)) {
      return null;
    }
    this.resourceCache.set(cacheKey, resource);
    return resource;
  }

  private contentsUrl(source: CmsContentSource, path: string): string {
    const url = new URL(
      `https://api.github.com/repos/${source.owner}/${source.repo}/contents/${path}`
    );
    url.searchParams.set('ref', source.ref);
    return url.toString();
  }

  private rawUrl(source: CmsContentSource, path: string): string {
    const encoded = path
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    return `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${encodeURIComponent(source.ref)}/${encoded}`;
  }

  private proxyUrl(target: string): string {
    const base = this.settingsService.getEffectiveServerBaseUrl().replace(/\/+$/, '');
    return `${base}/api/cms-content?url=${encodeURIComponent(target)}`;
  }

  async fetchText(target: string): Promise<string> {
    const response = await firstValueFrom(
      this.http.get(this.proxyUrl(target), {
        observe: 'response',
        responseType: 'text',
        headers: { Accept: 'text/plain, application/xml, application/fhir+json, application/json' },
      })
    );
    return response.body ?? '';
  }

  async fetchJson<T>(target: string): Promise<T> {
    const response = await firstValueFrom(
      this.http.get(this.proxyUrl(target), {
        observe: 'response',
        responseType: 'json',
        headers: { Accept: 'application/fhir+json, application/json' },
      })
    );
    return response.body as T;
  }

  private async getJson<T>(target: string): Promise<T> {
    const response = await firstValueFrom(
      this.http.get(this.proxyUrl(target), {
        observe: 'response',
        responseType: 'json',
      })
    );
    return response.body as T;
  }

  private async mapPool<T>(
    items: readonly T[],
    limit: number,
    fn: (item: T) => Promise<void>
  ): Promise<void> {
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        await fn(items[index]);
      }
    };
    const workers = Math.min(limit, items.length);
    await Promise.all(Array.from({ length: workers }, () => worker()));
  }
}
