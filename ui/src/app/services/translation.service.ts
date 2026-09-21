// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
// @ts-expect-error No type definitions available for @lhncbc/ucum-lhc
import * as ucum from '@lhncbc/ucum-lhc';
import {
  ModelManager,
  LibraryManager,
  CqlTranslator,
  CqlCompilerException,
  createModelInfoProvider,
  createLibrarySourceProvider,
  createUcumService,
  stringAsSource
} from '@cqframework/cql/cql-to-elm';
import { CqlLocatorUtilsService } from './cql-locator-utils.service';
import { CqlLibrarySourceService, LibraryTranslationContext } from './cql-library-source.service';
import { ElmIncludeParser } from './elm-include.lib';
import { CqlModelInfoService } from './cql-model-info.service';
import {
  extractCqlUsingDeclarations,
  modelInfoCacheKey,
  parseModelInfoXmlIdentity,
  rewriteFhirHelpersCql,
  rewriteModelInfoXmlIdentity
} from './cql-model-info.lib';

export type { LibraryTranslationContext } from './cql-library-source.service';

export interface TranslationResult {
  elmXml: string | null;
  elmJson: string | null;
  errors: string[];
  warnings: string[];
  messages: string[];
  hasErrors: boolean;
}

export interface RawTranslationResult {
  elmXml: string | null;
  elmJson: string | null;
  errors: CqlCompilerException[];
  warnings: CqlCompilerException[];
  messages: CqlCompilerException[];
  hasErrors: boolean;
}

/** Per-translate isolated engine. ModelManager allows only one FHIR version by name. */
interface TranslationEngine {
  modelManager: ModelManager;
  libraryManager: LibraryManager;
  /** Root library `using FHIR` version, if any. */
  fhirModelVersion: string | null;
}

@Injectable({
  providedIn: 'root'
})
export class TranslationService {
  private locatorUtils = inject(CqlLocatorUtilsService);
  private librarySourceService = inject(CqlLibrarySourceService);
  private elmIncludeParser = inject(ElmIncludeParser);
  private modelInfoService = inject(CqlModelInfoService);

  private readonly FHIR_VERSION = '4.0.1';
  private readonly MAX_INCLUDE_RESOLVE_ITERATIONS = 5;

  private librarySourceCache = new Map<string, string>();
  private translationAssetsLoaded = false;
  private translationAssetsLoadPromise: Promise<void> | null = null;

  /** FIFO queue so concurrent lint/translate jobs do not interleave. */
  private exclusiveTail: Promise<void> = Promise.resolve();
  /** >0 while an exclusive job is running (including awaits). Enables reentrancy. */
  private exclusiveDepth = 0;

  private async fetchTextResource(path: string): Promise<string> {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${path}: ${response.status} ${response.statusText}`);
    }
    return await response.text();
  }

  /**
   * Preload translation assets asynchronously to avoid blocking the UI thread.
   * Providers registered with @cqframework/cql are synchronous, so we cache the
   * fetched text and serve from memory synchronously during translation.
   */
  async ensureTranslationAssetsLoaded(): Promise<void> {
    if (this.translationAssetsLoaded) {
      return;
    }
    if (this.translationAssetsLoadPromise) {
      return this.translationAssetsLoadPromise;
    }

    this.translationAssetsLoadPromise = Promise.all([
      this.modelInfoService.ensureBundledLoaded(),
      this.fetchTextResource(`/cql/FHIRHelpers-${this.FHIR_VERSION}.cql`).then((text) => {
        this.librarySourceCache.set(`/cql/FHIRHelpers-${this.FHIR_VERSION}.cql`, text);
      })
    ]).then(() => {
      this.translationAssetsLoaded = true;
    });

    return this.translationAssetsLoadPromise;
  }

  constructor() {
    void this.ensureTranslationAssetsLoaded();
  }

  /**
   * Serialize translate jobs. Re-entrant: nested calls (e.g. definition-index compiling
   * an include while already inside an exclusive job) run immediately to avoid deadlock.
   */
  private runExclusive<T>(fn: () => T | Promise<T>): Promise<T> {
    if (this.exclusiveDepth > 0) {
      return Promise.resolve().then(() => fn());
    }
    const run = this.exclusiveTail.then(async () => {
      this.exclusiveDepth++;
      try {
        return await fn();
      } finally {
        this.exclusiveDepth--;
      }
    });
    this.exclusiveTail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  /**
   * Build a fresh ModelManager/LibraryManager for one translate job.
   * Closures capture this engine so concurrent jobs cannot steal managers.
   */
  private createTranslationEngine(cql: string): TranslationEngine {
    const fhirModelVersion =
      extractCqlUsingDeclarations(cql).find((d) => d.name === 'FHIR')?.version?.trim() || null;

    const modelManager = new ModelManager(undefined, false);

    const ucumUtils = ucum.UcumLhcUtils.getInstance();
    const validateUnit = (unit: string): string | null => {
      const result = ucumUtils.validateUnitString(unit);
      return result.status === 'valid' ? null : result.msg[0];
    };
    const unsupportedUcumOp = (): never => {
      throw new Error('Unsupported operation');
    };
    const ucumService = createUcumService(
      unsupportedUcumOp,
      validateUnit,
      unsupportedUcumOp,
      unsupportedUcumOp
    );

    modelManager.modelInfoLoader.registerModelInfoProvider(
      createModelInfoProvider((id, system, version) => {
        if (system) {
          return null;
        }
        let xml = this.modelInfoService.lookupXml(id, version);
        if (!xml) {
          return null;
        }
        const requested = version?.trim();
        if (requested) {
          const xmlId = parseModelInfoXmlIdentity(xml);
          if (!xmlId || xmlId.version !== requested || xmlId.name !== id) {
            xml = rewriteModelInfoXmlIdentity(xml, id, requested);
          }
        }
        return stringAsSource(xml);
      }),
      true
    );

    const libraryManager = new LibraryManager(modelManager, undefined, undefined, ucumService);

    libraryManager.librarySourceLoader.registerProvider(
      createLibrarySourceProvider((id, system, version) => {
        const cachedCql = this.librarySourceService.getCachedCql(id, system, version);
        if (cachedCql) {
          return stringAsSource(
            this.alignFhirHelpersCqlIfNeeded(id, version, cachedCql, fhirModelVersion)
          );
        }

        if (id === 'FHIRHelpers' && !system) {
          const requested = version?.trim() || this.FHIR_VERSION;
          const bundled = this.librarySourceCache.get(`/cql/FHIRHelpers-${this.FHIR_VERSION}.cql`);
          if (!bundled) {
            return null;
          }
          if (requested !== this.FHIR_VERSION) {
            console.warn(
              `FHIRHelpers version '${requested}' was not found on the content/evaluation FHIR server; using bundled ${this.FHIR_VERSION} (version label adjusted).`
            );
          }
          return stringAsSource(
            this.alignFhirHelpersCqlIfNeeded(id, requested, bundled, fhirModelVersion)
          );
        }

        return null;
      })
    );

    return { modelManager, libraryManager, fhirModelVersion };
  }

  /**
   * Translate CQL to ELM, prefetching included libraries from the FHIR server first.
   * Discovers dependencies from stored ELM and compiler output ELM (not CQL text).
   */
  translateCqlToElmAsync(
    cql: string,
    context?: LibraryTranslationContext
  ): Promise<TranslationResult> {
    return this.runExclusive(() => this.translateCqlToElmAsyncExclusive(cql, context));
  }

  private async translateCqlToElmAsyncExclusive(
    cql: string,
    context?: LibraryTranslationContext
  ): Promise<TranslationResult> {
    await this.ensureTranslationAssetsLoaded();
    await this.prefetchTranslationDependencies(cql, context);

    const conflict = this.findFhirModelVersionConflict(cql);
    if (conflict) {
      return {
        elmXml: null,
        elmJson: null,
        errors: [conflict],
        warnings: [],
        messages: [],
        hasErrors: true
      };
    }

    let engine = this.createTranslationEngine(cql);
    let result = this.translateCqlToElmWithEngine(cql, engine);

    for (let iteration = 0; iteration < this.MAX_INCLUDE_RESOLVE_ITERATIONS; iteration++) {
      const missingRefs = this.getUncachedFhirIncludesFromElm(result.elmXml);
      if (missingRefs.length === 0) {
        break;
      }

      const fetchedAny = await this.librarySourceService.fetchMissingIncludes(missingRefs);
      if (!fetchedAny) {
        break;
      }

      const again = this.findFhirModelVersionConflict(cql);
      if (again) {
        return {
          elmXml: null,
          elmJson: null,
          errors: [again],
          warnings: [],
          messages: [],
          hasErrors: true
        };
      }

      // Fresh engine after cache growth so compiledLibraries cannot retain a partial first pass.
      engine = this.createTranslationEngine(cql);
      result = this.translateCqlToElmWithEngine(cql, engine);
    }

    return result;
  }

  /**
   * Translate CQL to ELM and return raw exceptions, prefetching FHIR library includes first.
   */
  translateCqlToElmRawAsync(
    cql: string,
    context?: LibraryTranslationContext
  ): Promise<RawTranslationResult> {
    return this.runExclusive(() => this.translateCqlToElmRawAsyncExclusive(cql, context));
  }

  private async translateCqlToElmRawAsyncExclusive(
    cql: string,
    context?: LibraryTranslationContext
  ): Promise<RawTranslationResult> {
    await this.ensureTranslationAssetsLoaded();
    await this.prefetchTranslationDependencies(cql, context);

    const conflict = this.findFhirModelVersionConflict(cql);
    if (conflict) {
      return {
        elmXml: null,
        elmJson: null,
        errors: [{ message: conflict } as CqlCompilerException],
        warnings: [],
        messages: [],
        hasErrors: true
      };
    }

    let engine = this.createTranslationEngine(cql);
    let result = this.translateCqlToElmRawWithEngine(cql, engine);

    for (let iteration = 0; iteration < this.MAX_INCLUDE_RESOLVE_ITERATIONS; iteration++) {
      const missingRefs = this.getUncachedFhirIncludesFromElm(result.elmXml);
      if (missingRefs.length === 0) {
        break;
      }

      const fetchedAny = await this.librarySourceService.fetchMissingIncludes(missingRefs);
      if (!fetchedAny) {
        break;
      }

      const again = this.findFhirModelVersionConflict(cql);
      if (again) {
        return {
          elmXml: null,
          elmJson: null,
          errors: [{ message: again } as CqlCompilerException],
          warnings: [],
          messages: [],
          hasErrors: true
        };
      }

      engine = this.createTranslationEngine(cql);
      result = this.translateCqlToElmRawWithEngine(cql, engine);
    }

    return result;
  }

  private async prefetchTranslationDependencies(
    cql: string,
    context?: LibraryTranslationContext
  ): Promise<void> {
    const { missing } = await this.modelInfoService.prefetchForCql(cql);
    if (missing.length > 0) {
      const detail = missing
        .map((m) => (m.version ? `${m.name} version '${m.version}'` : m.name))
        .join(', ');
      console.warn(
        `ModelInfo not found on content/evaluation FHIR for: ${detail}. Translation may fail.`
      );
    }

    if (context?.fhirLibraryId && !context.isDirty) {
      try {
        await this.librarySourceService.prefetchFromStoredLibrary(context.fhirLibraryId);
      } catch (error) {
        console.warn('Failed to prefetch library includes from stored ELM:', error);
      }
    } else {
      try {
        await this.librarySourceService.prefetchIncludesFromCql(cql);
      } catch (error) {
        console.warn('Failed to prefetch library includes from CQL:', error);
      }
    }
  }

  /**
   * Drop cached CQL/ELM for included libraries. Each translate uses a fresh engine, so
   * compiledLibraries need not be cleared on a shared manager.
   */
  invalidateIncludedLibraryCache(
    path?: string,
    version?: string | null,
    system?: string | null,
    cqlContent?: string | null
  ): void {
    this.librarySourceService.invalidate(path, version, system);
    if (path && cqlContent?.trim()) {
      this.librarySourceService.setCachedCql(path, system, version, cqlContent);
    }
  }

  private getUncachedFhirIncludesFromElm(elmXml: string | null) {
    if (!elmXml) {
      return [];
    }
    return this.elmIncludeParser.extractFhirIncludes(elmXml).filter(
      (ref) => !this.librarySourceService.hasCachedCql(ref.path, ref.system, ref.version)
    );
  }

  /**
   * Detect conflicting `using FHIR` versions across root + cached includes (excluding
   * FHIRHelpers, which are rewritten to the root FHIR version).
   */
  private findFhirModelVersionConflict(cql: string): string | null {
    const versions = new Map<string, string[]>();

    const add = (source: string, version: string | null): void => {
      if (!version?.trim()) {
        return;
      }
      const v = version.trim();
      const list = versions.get(v) ?? [];
      list.push(source);
      versions.set(v, list);
    };

    const rootDecls = extractCqlUsingDeclarations(cql);
    for (const d of rootDecls) {
      if (d.name === 'FHIR') {
        add('root library', d.version);
      }
    }

    const includes = this.librarySourceService.collectTransitiveCachedSources('', cql);
    for (const include of includes) {
      if (include.id === 'FHIRHelpers') {
        continue;
      }
      for (const d of extractCqlUsingDeclarations(include.cql)) {
        if (d.name === 'FHIR') {
          add(
            `include ${include.id}${include.version ? ` version '${include.version}'` : ''}`,
            d.version
          );
        }
      }
    }

    if (versions.size <= 1) {
      return null;
    }

    const detail = [...versions.entries()]
      .map(([version, sources]) => `FHIR ${version} (${sources.join(', ')})`)
      .join('; ');
    return (
      `Conflicting FHIR model versions in the library graph: ${detail}. ` +
      `The translator can load only one FHIR model version per compile. ` +
      `Align all non-FHIRHelpers libraries to the same \`using FHIR version\`, or open them separately.`
    );
  }

  private alignFhirHelpersCqlIfNeeded(
    id: string,
    helpersVersion: string | null | undefined,
    cql: string,
    rootFhirModelVersion: string | null
  ): string {
    if (id !== 'FHIRHelpers') {
      return cql;
    }
    const helpersVer = helpersVersion?.trim() || this.FHIR_VERSION;
    const fhirVer = rootFhirModelVersion?.trim() || helpersVer;
    return rewriteFhirHelpersCql(cql, helpersVer, fhirVer);
  }

  /**
   * Translate CQL to ELM. Serialized via the exclusive FIFO queue (same as async APIs).
   */
  translateCqlToElm(cql: string): Promise<TranslationResult> {
    return this.runExclusive(() => this.translateCqlToElmExclusive(cql));
  }

  private translateCqlToElmExclusive(cql: string): TranslationResult {
    if (!this.translationAssetsLoaded) {
      return {
        elmXml: null,
        elmJson: null,
        errors: ['Translation assets are still loading. Please try again in a moment.'],
        warnings: [],
        messages: [],
        hasErrors: true
      };
    }
    const conflict = this.findFhirModelVersionConflict(cql);
    if (conflict) {
      return {
        elmXml: null,
        elmJson: null,
        errors: [conflict],
        warnings: [],
        messages: [],
        hasErrors: true
      };
    }
    return this.translateCqlToElmWithEngine(cql, this.createTranslationEngine(cql));
  }

  private translateCqlToElmWithEngine(cql: string, engine: TranslationEngine): TranslationResult {
    try {
      const translator = CqlTranslator.fromText(cql, engine.libraryManager);

      const errors = [...(translator.errors?.asJsReadonlyArrayView() ?? [])];
      const warnings = [...(translator.warnings?.asJsReadonlyArrayView() ?? [])];
      const messages = [...(translator.messages?.asJsReadonlyArrayView() ?? [])];

      const errorMessages = errors
        .filter((e: CqlCompilerException | null | undefined): e is CqlCompilerException => e != null)
        .map((e: CqlCompilerException) => this.formatException(e));
      const warningMessages = warnings
        .filter((e: CqlCompilerException | null | undefined): e is CqlCompilerException => e != null)
        .map((e: CqlCompilerException) => this.formatException(e));
      const infoMessages = messages
        .filter((e: CqlCompilerException | null | undefined): e is CqlCompilerException => e != null)
        .map((e: CqlCompilerException) => this.formatException(e));

      let elmXml: string | null = null;
      try {
        elmXml = translator.toXml();
      } catch (e) {
        console.warn('Failed to generate ELM XML:', e);
      }

      let elmJson: string | null = null;
      try {
        elmJson = translator.toJson();
      } catch (e) {
        console.warn('Failed to generate ELM JSON:', e);
      }

      return {
        elmXml,
        elmJson,
        errors: errorMessages,
        warnings: warningMessages,
        messages: infoMessages,
        hasErrors: errorMessages.length > 0
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        elmXml: null,
        elmJson: null,
        errors: [`Translation failed: ${errorMessage}`],
        warnings: [],
        messages: [],
        hasErrors: true
      };
    }
  }

  /**
   * Translate CQL to ELM and return raw exceptions. Serialized via the exclusive FIFO queue.
   */
  translateCqlToElmRaw(cql: string): Promise<RawTranslationResult> {
    return this.runExclusive(() => this.translateCqlToElmRawExclusive(cql));
  }

  private translateCqlToElmRawExclusive(cql: string): RawTranslationResult {
    if (!this.translationAssetsLoaded) {
      return {
        elmXml: null,
        elmJson: null,
        errors: [
          {
            message: 'Translation assets are still loading. Please try again in a moment.'
          } as CqlCompilerException
        ],
        warnings: [],
        messages: [],
        hasErrors: true
      };
    }
    const conflict = this.findFhirModelVersionConflict(cql);
    if (conflict) {
      return {
        elmXml: null,
        elmJson: null,
        errors: [{ message: conflict } as CqlCompilerException],
        warnings: [],
        messages: [],
        hasErrors: true
      };
    }
    return this.translateCqlToElmRawWithEngine(cql, this.createTranslationEngine(cql));
  }

  private translateCqlToElmRawWithEngine(
    cql: string,
    engine: TranslationEngine
  ): RawTranslationResult {
    try {
      const translator = CqlTranslator.fromText(cql, engine.libraryManager);

      const errors = [...(translator.errors?.asJsReadonlyArrayView() ?? [])];
      const warnings = [...(translator.warnings?.asJsReadonlyArrayView() ?? [])];
      const messages = [...(translator.messages?.asJsReadonlyArrayView() ?? [])];

      const rawErrors = errors.filter(
        (e: CqlCompilerException | null | undefined): e is CqlCompilerException => e != null
      );
      const rawWarnings = warnings.filter(
        (e: CqlCompilerException | null | undefined): e is CqlCompilerException => e != null
      );
      const rawMessages = messages.filter(
        (e: CqlCompilerException | null | undefined): e is CqlCompilerException => e != null
      );

      let elmXml: string | null = null;
      try {
        elmXml = translator.toXml();
      } catch (e) {
        console.warn('Failed to generate ELM XML:', e);
      }

      let elmJson: string | null = null;
      try {
        elmJson = translator.toJson();
      } catch (e) {
        console.warn('Failed to generate ELM JSON:', e);
      }

      return {
        elmXml,
        elmJson,
        errors: rawErrors,
        warnings: rawWarnings,
        messages: rawMessages,
        hasErrors: rawErrors.length > 0
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        elmXml: null,
        elmJson: null,
        errors: [{ message: `Translation failed: ${errorMessage}` } as CqlCompilerException],
        warnings: [],
        messages: [],
        hasErrors: true
      };
    }
  }

  /**
   * Snapshot of translation assets for in-browser debug Workers (plain strings only).
   */
  getDebugTranslationAssets(cql?: string): {
    systemModelInfoXml: string;
    fhirModelInfoXml: string;
    fhirHelpersCql: string;
    modelInfoByKey: Record<string, string>;
  } {
    const fhirHelpersCql = this.librarySourceCache.get(`/cql/FHIRHelpers-${this.FHIR_VERSION}.cql`);
    const systemModelInfoXml =
      this.modelInfoService.lookupXml('System', null) ??
      this.modelInfoService.lookupXml('System', '1.0.0');
    const fhirModelInfoXml = this.modelInfoService.lookupXml('FHIR', this.FHIR_VERSION);
    if (!systemModelInfoXml || !fhirModelInfoXml || !fhirHelpersCql) {
      throw new Error(
        'Translation assets are not loaded yet. Call ensureTranslationAssetsLoaded() first.'
      );
    }
    const decls = cql ? extractCqlUsingDeclarations(cql) : [];
    const keys = [
      { name: 'System', version: null as string | null },
      { name: 'System', version: '1.0.0' },
      { name: 'FHIR', version: this.FHIR_VERSION },
      ...decls.map((d) => ({ name: d.name, version: d.version }))
    ];
    const modelInfoByKey = this.modelInfoService.snapshotForDebug(keys);
    modelInfoByKey[modelInfoCacheKey('System', null)] = systemModelInfoXml;
    modelInfoByKey[modelInfoCacheKey('FHIR', this.FHIR_VERSION)] = fhirModelInfoXml;
    return { systemModelInfoXml, fhirModelInfoXml, fhirHelpersCql, modelInfoByKey };
  }

  formatException(exception: CqlCompilerException): string {
    const message = exception.message || 'Unknown error';
    const locatorInfo = this.locatorUtils.extractLocatorInfo(exception);
    const locatorStr = this.locatorUtils.formatLocator(locatorInfo);

    return locatorStr ? `${message} ${locatorStr}` : message;
  }
}
