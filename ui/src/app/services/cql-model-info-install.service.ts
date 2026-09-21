// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Library } from 'fhir/r4';
import { FhirPackageRegistryService } from './fhir-package-registry.service';
import { FhirPackageLoadService } from './fhir-package-load.service';
import { LibraryService } from './library.service';
import { decodeUtf8Bytes } from './utf8-encoding.lib';
import {
  isModelDefinitionLibrary,
  libraryTypeCode,
  LOGIC_LIBRARY_TYPE_CODE,
  MODEL_DEFINITION_TYPE_CODE,
  alignModelDefinitionIdentity,
  rewriteFhirHelpersCql,
  wrapFhirHelpersCqlAsLibrary,
  wrapModelInfoXmlAsLibrary
} from './cql-model-info.lib';
import {
  MODEL_INFO_INSTALL_CATALOG,
  ModelInfoCatalogEntry,
  ModelInfoCompanionHelpers
} from './cql-model-info-catalog.lib';
import { CqlModelInfoService } from './cql-model-info.service';
import { CqlLibrarySourceService } from './cql-library-source.service';
import { ElmIncludeParser } from './elm-include.lib';

export interface ModelInfoInstallResult {
  modelInfo: Library;
  /** Companion FHIRHelpers logic-library when installed with this catalog entry. */
  fhirHelpers?: Library;
  /** Non-fatal companion install warning (ModelInfo still succeeded). */
  helpersWarning?: string;
}

@Injectable({
  providedIn: 'root'
})
export class CqlModelInfoInstallService {
  private readonly registry = inject(FhirPackageRegistryService);
  private readonly packageLoad = inject(FhirPackageLoadService);
  private readonly libraryService = inject(LibraryService);
  private readonly modelInfoService = inject(CqlModelInfoService);
  private readonly librarySourceService = inject(CqlLibrarySourceService);

  catalog(): ModelInfoCatalogEntry[] {
    return MODEL_INFO_INSTALL_CATALOG;
  }

  async installCatalogEntry(entry: ModelInfoCatalogEntry): Promise<ModelInfoInstallResult> {
    let modelInfo: Library;
    if (entry.kind === 'bundled') {
      modelInfo = await this.installBundled(entry);
    } else {
      // Prefer published Library JSON when present (avoids huge core package downloads that
      // often lack ModelInfo, e.g. hl7.fhir.r4b.core).
      let library: Library | null = null;
      if (entry.libraryJsonUrl) {
        try {
          library = await this.fetchLibraryJson(entry.libraryJsonUrl);
        } catch (err) {
          if (!entry.packageId) {
            throw err;
          }
        }
      }
      if (!library && entry.packageId) {
        library = await this.installFromPackage(entry);
      }
      if (!library) {
        throw new Error(`Could not resolve ModelInfo Library for ${entry.label}.`);
      }
      modelInfo = await this.upsertModelDefinition(library, entry);
    }

    let fhirHelpers: Library | undefined;
    let helpersWarning: string | undefined;
    if (entry.companionHelpers) {
      try {
        fhirHelpers = await this.installCompanionHelpers(entry.companionHelpers);
      } catch (err) {
        helpersWarning =
          err instanceof Error
            ? err.message
            : `Failed to install companion FHIRHelpers ${entry.companionHelpers.version}.`;
      }
    }

    return { modelInfo, fhirHelpers, helpersWarning };
  }

  async installLibraryJson(text: string): Promise<Library> {
    const parsed = JSON.parse(text) as Library;
    if (parsed.resourceType !== 'Library') {
      throw new Error('JSON is not a FHIR Library resource.');
    }
    return this.upsertModelDefinition(parsed);
  }

  async installModelInfoXml(xml: string): Promise<Library> {
    const library = wrapModelInfoXmlAsLibrary(xml);
    return this.upsertModelDefinition(library);
  }

  private async installBundled(entry: ModelInfoCatalogEntry): Promise<Library> {
    await this.modelInfoService.ensureBundledLoaded();
    const xml = this.modelInfoService.lookupXml(entry.modelName, entry.version);
    if (!xml) {
      throw new Error(`Bundled ModelInfo missing for ${entry.label}.`);
    }
    const library = wrapModelInfoXmlAsLibrary(xml, {
      name: entry.modelName,
      version: entry.version
    });
    return this.upsertModelDefinition(library, entry);
  }

  private async installCompanionHelpers(helpers: ModelInfoCompanionHelpers): Promise<Library> {
    // Published hl7.org FHIRHelpers Library JSON often mismatches Library.version vs CQL
    // (R4B→4.0.1 CQL, R5→4.0.0 CQL). Synthesize from the Studio-bundled 4.0.1 helpers.
    const bundledPath = `/cql/FHIRHelpers-${ElmIncludeParser.BUNDLED_FHIR_HELPERS_VERSION}.cql`;
    const response = await fetch(bundledPath);
    if (!response.ok) {
      throw new Error(`Failed to load bundled FHIRHelpers: HTTP ${response.status}`);
    }
    const bundledCql = await response.text();
    const cql = rewriteFhirHelpersCql(bundledCql, helpers.version, helpers.fhirModelVersion);
    const library = wrapFhirHelpersCqlAsLibrary(cql, helpers.version, {
      title: helpers.label ?? `FHIR Helpers ${helpers.version}`
    });
    const saved = await this.upsertLogicLibrary(library);
    this.librarySourceService.setCachedCql('FHIRHelpers', null, helpers.version, cql);
    return saved;
  }

  private async installFromPackage(entry: ModelInfoCatalogEntry): Promise<Library> {
    const packageId = entry.packageId!;
    const manifest = await this.registry.getPackageManifest(`${packageId}`);
    // Prefer exact version tarball.
    let tarballUrl = manifest.versions?.[entry.version]?.dist?.tarball;
    if (!tarballUrl) {
      const matchKey = Object.keys(manifest.versions ?? {}).find((v) => v === entry.version);
      tarballUrl = matchKey ? manifest.versions?.[matchKey]?.dist?.tarball : undefined;
    }
    if (!tarballUrl) {
      throw new Error(`No tarball for ${packageId}@${entry.version} on the package registry.`);
    }
    const parsed = await this.packageLoad.fetchAndParseTarball(
      tarballUrl,
      packageId,
      `${packageId}@${entry.version}`
    );
    const library = this.findModelInfoLibraryInFiles(parsed.files, entry);
    if (!library) {
      throw new Error(
        `No model-definition Library found in ${packageId}@${entry.version} matching ${entry.modelName}.`
      );
    }
    return library;
  }

  private findModelInfoLibraryInFiles(
    files: Map<string, Uint8Array>,
    entry: ModelInfoCatalogEntry
  ): Library | null {
    const hint = (entry.libraryFilenameHint ?? '').toLowerCase();
    const candidates: Library[] = [];
    for (const [path, bytes] of files) {
      if (!path.endsWith('.json') || !path.includes('Library')) {
        continue;
      }
      if (hint && !path.toLowerCase().includes(hint.toLowerCase())) {
        // Keep as secondary candidates only when hint matches later; still parse ModelInfo names.
        if (!/modelinfo/i.test(path)) {
          continue;
        }
      }
      try {
        const text = decodeUtf8Bytes(bytes, { fatal: false });
        const obj = JSON.parse(text) as Library;
        if (obj.resourceType !== 'Library') {
          continue;
        }
        const typeCode = libraryTypeCode(obj.type);
        const isModelDef =
          typeCode === MODEL_DEFINITION_TYPE_CODE || isModelDefinitionLibrary(obj);
        if (!isModelDef && !/modelinfo/i.test(path)) {
          continue;
        }
        candidates.push(obj);
      } catch {
        // skip
      }
    }
    const byName = candidates.find(
      (l) =>
        (l.name === entry.modelName ||
          l.name === entry.normalizeNameTo ||
          l.name === 'FHIRModelDefinition') &&
        (l.version === entry.version || !entry.version)
    );
    return byName ?? candidates[0] ?? null;
  }

  private async fetchLibraryJson(url: string): Promise<Library> {
    let res: Response;
    try {
      res = await fetch(url);
    } catch {
      throw new Error(`Failed to fetch Library JSON (network/CORS): ${url}`);
    }
    if (!res.ok) {
      throw new Error(`Failed to fetch Library JSON: HTTP ${res.status}`);
    }
    const obj = (await res.json()) as Library;
    if (obj.resourceType !== 'Library') {
      throw new Error('Fetched JSON is not a FHIR Library.');
    }
    return obj;
  }

  private async upsertModelDefinition(
    library: Library,
    entry?: ModelInfoCatalogEntry
  ): Promise<Library> {
    const name =
      entry?.normalizeNameTo ||
      entry?.modelName ||
      (library.name === 'FHIRModelDefinition' ? 'FHIR' : library.name);
    const version = entry?.version || library.version;
    let next = alignModelDefinitionIdentity(library, { name, version });
    if (!next.id) {
      next = {
        ...next,
        id: `${next.name ?? 'Model'}-ModelInfo-${next.version ?? 'unknown'}`.replace(
          /[^A-Za-z0-9._-]/g,
          '-'
        )
      };
    }

    const saved = await this.upsertOnContent(
      next,
      next.name!,
      next.version,
      MODEL_DEFINITION_TYPE_CODE
    );
    this.cacheLibrary(saved);
    return saved;
  }

  private async upsertLogicLibrary(library: Library): Promise<Library> {
    return this.upsertOnContent(library, library.name!, library.version, LOGIC_LIBRARY_TYPE_CODE);
  }

  private async upsertOnContent(
    library: Library,
    name: string,
    version: string | undefined,
    typeCode: string
  ): Promise<Library> {
    let next = { ...library };
    try {
      const existing = await firstValueFrom(
        this.libraryService.findByNameAndVersion(name, version, true, typeCode)
      );
      if (existing?.id) {
        next = { ...next, id: existing.id };
        return await firstValueFrom(this.libraryService.putOnContent(next));
      }
    } catch {
      // create
    }

    try {
      return await firstValueFrom(this.libraryService.putOnContent(next));
    } catch {
      return await firstValueFrom(this.libraryService.postOnContent(next));
    }
  }

  private cacheLibrary(library: Library): void {
    this.modelInfoService.xmlFromLibrary(library);
  }
}
