// Author: Preston Lee

import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  ModelManager,
  LibraryManager,
  CqlTranslator,
  createModelInfoProvider,
  createLibrarySourceProvider,
  createUcumService,
  stringAsSource
} from '@cqframework/cql/cql-to-elm';
// @ts-expect-error No type definitions available for @lhncbc/ucum-lhc
import * as ucum from '@lhncbc/ucum-lhc';
import { CqlLibrarySourceService } from './cql-library-source.service';
import { ElmIncludeParser } from './elm-include.lib';
import { CqlModelInfoService } from './cql-model-info.service';
import { CqlLocatorUtilsService } from './cql-locator-utils.service';
import { TranslationService } from './translation.service';
import { rewriteModelInfoXmlIdentity } from './cql-model-info.lib';

const cqlDir = join(process.cwd(), 'public/cql');
const fhirHelpers = readFileSync(join(cqlDir, 'FHIRHelpers-4.0.1.cql'), 'utf8');
const systemModelInfo = readFileSync(join(cqlDir, 'system-modelinfo.xml'), 'utf8');
const fhirModelInfo = readFileSync(join(cqlDir, 'fhir-modelinfo-4.0.1.xml'), 'utf8');

const helloCommonV1 = `library HelloCommon version '0.0.0'
include FHIRHelpers version '4.0.1'
define function MagicNumber(): 42`;

const helloCommonV2 = `library HelloCommon version '0.0.0'
include FHIRHelpers version '4.0.1'
define function MagicNumber(x Integer): x + 1`;

const helloWorld = `library HelloWorld version '1.0.0'
using FHIR version '4.0.1'
include FHIRHelpers version '4.0.1'
include HelloCommon version '0.0.0' called Common
define x: Common.MagicNumber()`;

function cacheKey(path: string, version: string): string {
  return `|${path}|${version}`;
}

function translateErrors(libraryManager: LibraryManager, cql: string): string[] {
  const translator = CqlTranslator.fromText(cql, libraryManager);
  return (translator.errors?.asJsReadonlyArrayView() ?? [])
    .filter((error): error is NonNullable<typeof error> => error != null)
    .map((error) => error.message ?? '');
}

function createHarness(): {
  service: TranslationService;
  librarySourceService: CqlLibrarySourceService;
  modelInfoService: CqlModelInfoService;
  cqlCache: Map<string, string>;
} {
  const cqlCache = new Map<string, string>();
  const elmCache = new Map<string, string>();

  const librarySourceService = Object.create(
    CqlLibrarySourceService.prototype
  ) as CqlLibrarySourceService;
  Object.assign(librarySourceService as object, {
    cqlCache,
    elmCache,
    elmIncludeParser: new ElmIncludeParser(),
    getCachedCql(path: string, system: string | null | undefined, version: string | null | undefined) {
      return cqlCache.get(new ElmIncludeParser().cacheKey(path, system, version)) ?? null;
    },
    hasCachedCql(path: string, system: string | null | undefined, version: string | null | undefined) {
      return cqlCache.has(new ElmIncludeParser().cacheKey(path, system, version));
    },
    setCachedCql(
      path: string,
      system: string | null | undefined,
      version: string | null | undefined,
      cqlContent: string
    ) {
      if (!cqlContent.trim()) {
        return;
      }
      cqlCache.set(new ElmIncludeParser().cacheKey(path, system ?? null, version ?? null), cqlContent);
    },
    invalidate(path?: string, version?: string | null, system?: string | null) {
      if (!path) {
        cqlCache.clear();
        elmCache.clear();
        return;
      }
      const key = new ElmIncludeParser().cacheKey(path, system ?? null, version ?? null);
      cqlCache.delete(key);
      elmCache.delete(key);
    },
    collectTransitiveCachedSources(
      elmXml: string,
      rootCql?: string | null
    ): Array<{ id: string; version?: string | null; system?: string | null; cql: string }> {
      return CqlLibrarySourceService.prototype.collectTransitiveCachedSources.call(
        librarySourceService,
        elmXml,
        rootCql
      );
    },
    prefetchIncludesFromCql: async () => false,
    prefetchFromStoredLibrary: async () => false,
    fetchMissingIncludes: async () => false
  });

  const modelInfoService = Object.create(CqlModelInfoService.prototype) as CqlModelInfoService;
  const xmlByKey = new Map<string, string>([
    ['System|', systemModelInfo],
    ['System|1.0.0', systemModelInfo],
    ['FHIR|4.0.1', fhirModelInfo],
    ['FHIR|4.3.0', rewriteModelInfoXmlIdentity(fhirModelInfo, 'FHIR', '4.3.0')],
    ['FHIR|5.0.0', rewriteModelInfoXmlIdentity(fhirModelInfo, 'FHIR', '5.0.0')]
  ]);
  Object.assign(modelInfoService as object, {
    xmlByKey,
    bundledReady: true,
    ensureBundledLoaded: async () => undefined,
    prefetchForCql: async () => ({ missing: [] }),
    lookupXml(id: string, version: string | null | undefined) {
      return xmlByKey.get(`${id}|${version ?? ''}`) ?? null;
    },
    snapshotForDebug() {
      return Object.fromEntries(xmlByKey);
    }
  });

  const locatorUtils = Object.create(CqlLocatorUtilsService.prototype) as CqlLocatorUtilsService;
  Object.assign(locatorUtils as object, {
    extractLocatorInfo: () => null,
    formatLocator: () => ''
  });

  const service = Object.create(TranslationService.prototype) as TranslationService;
  Object.assign(service as object, {
    locatorUtils,
    librarySourceService,
    elmIncludeParser: new ElmIncludeParser(),
    modelInfoService,
    FHIR_VERSION: '4.0.1',
    MAX_INCLUDE_RESOLVE_ITERATIONS: 5,
    librarySourceCache: new Map([['/cql/FHIRHelpers-4.0.1.cql', fhirHelpers]]),
    translationAssetsLoaded: true,
    translationAssetsLoadPromise: null,
    exclusiveTail: Promise.resolve(),
    exclusiveDepth: 0
  });

  return { service, librarySourceService, modelInfoService, cqlCache };
}

describe('TranslationService included library cache invalidation', () => {
  let libraryManager: LibraryManager;
  let librarySourceService: CqlLibrarySourceService;
  let service: TranslationService;
  let cqlCache: Map<string, string>;

  beforeEach(() => {
    const harness = createHarness();
    service = harness.service;
    librarySourceService = harness.librarySourceService;
    cqlCache = harness.cqlCache;
    cqlCache.set(cacheKey('HelloCommon', '0.0.0'), helloCommonV1);

    const modelInfoByKey: Record<string, string> = {
      'System|': systemModelInfo,
      'System|1.0.0': systemModelInfo,
      'FHIR|4.0.1': fhirModelInfo
    };
    const modelManager = new ModelManager(undefined, true);
    modelManager.modelInfoLoader.registerModelInfoProvider(
      createModelInfoProvider((id, system, version) => {
        if (system) {
          return null;
        }
        const xml = modelInfoByKey[`${id}|${version ?? ''}`];
        return xml ? stringAsSource(xml) : null;
      }),
      true
    );

    const ucumUtils = ucum.UcumLhcUtils.getInstance();
    const unsupportedUcumOp = (): never => {
      throw new Error('Unsupported operation');
    };
    libraryManager = new LibraryManager(
      modelManager,
      undefined,
      undefined,
      createUcumService(
        unsupportedUcumOp,
        (unit) => (ucumUtils.validateUnitString(unit).status === 'valid' ? null : unit),
        unsupportedUcumOp,
        unsupportedUcumOp
      )
    );
    libraryManager.librarySourceLoader.registerProvider(
      createLibrarySourceProvider((id, system, version) => {
        if (id === 'FHIRHelpers' && !system && version === '4.0.1') {
          return stringAsSource(fhirHelpers);
        }
        const cached = cqlCache.get(cacheKey(id, version ?? ''));
        return cached ? stringAsSource(cached) : null;
      })
    );
  });

  it('seeds saved CQL into cache when cqlContent is provided', () => {
    service.invalidateIncludedLibraryCache('HelloCommon', '0.0.0', null, helloCommonV2);
    expect(librarySourceService.getCachedCql('HelloCommon', null, '0.0.0')).toBe(helloCommonV2);
  });

  it('clears CQL cache so a fresh engine recompiles updated includes', async () => {
    expect(translateErrors(libraryManager, helloWorld)).toEqual([]);

    // Stale compiled ELM still succeeds until cache is invalidated and a new engine is used.
    cqlCache.set(cacheKey('HelloCommon', '0.0.0'), helloCommonV2);
    expect(translateErrors(libraryManager, helloWorld)).toEqual([]);

    service.invalidateIncludedLibraryCache('HelloCommon', '0.0.0', null, helloCommonV2);

    // Fresh engine (as TranslationService now builds per job) sees updated signatures.
    const harness = createHarness();
    harness.cqlCache.set(cacheKey('HelloCommon', '0.0.0'), helloCommonV2);
    const result = await harness.service.translateCqlToElm(helloWorld);
    expect(result.errors.some((e) => e.includes('MagicNumber'))).toBe(true);
  });

  it('emits ELM XML and JSON for a valid FHIR library', async () => {
    const result = await service.translateCqlToElm(`library Simple version '0.0.1'
using FHIR version '4.0.1'
include FHIRHelpers version '4.0.1'
define Answer: 42`);
    expect(result.hasErrors).toBe(false);
    expect(result.elmXml).toContain('<library');
    const json = JSON.parse(result.elmJson!);
    expect(json.library?.identifier?.id).toBe('Simple');
    expect(json.library?.statements?.def?.some((d: { name?: string }) => d.name === 'Answer')).toBe(
      true
    );
  });
});

describe('TranslationService isolated engines', () => {
  let service: TranslationService;
  let cqlCache: Map<string, string>;

  beforeEach(() => {
    const harness = createHarness();
    service = harness.service;
    cqlCache = harness.cqlCache;
  });

  it('translates FHIR 4.3.0 then 5.0.0 sequentially without already-loaded errors', async () => {
    const cql43 = `library Lib43 version '1.0.0'
using FHIR version '4.3.0'
include FHIRHelpers version '4.3.0'
define Answer: 43`;

    const cql50 = `library Lib50 version '1.0.0'
using FHIR version '5.0.0'
include FHIRHelpers version '5.0.0'
define Answer: 50`;

    const first = await service.translateCqlToElm(cql43);
    const second = await service.translateCqlToElm(cql50);

    expect(first.hasErrors).toBe(false);
    expect(second.hasErrors).toBe(false);
    expect(first.errors.join(' ')).not.toMatch(/already loaded/i);
    expect(second.errors.join(' ')).not.toMatch(/already loaded/i);
  });

  it('completes overlapping async translates with different FHIR versions', async () => {
    const cql43 = `library Async43 version '1.0.0'
using FHIR version '4.3.0'
include FHIRHelpers version '4.3.0'
define Answer: 43`;

    const cql50 = `library Async50 version '1.0.0'
using FHIR version '5.0.0'
include FHIRHelpers version '5.0.0'
define Answer: 50`;

    const [a, b] = await Promise.all([
      service.translateCqlToElmAsync(cql43),
      service.translateCqlToElmAsync(cql50)
    ]);

    expect(a.hasErrors).toBe(false);
    expect(b.hasErrors).toBe(false);
    expect(a.errors.join(' ')).not.toMatch(/already loaded/i);
    expect(b.errors.join(' ')).not.toMatch(/already loaded/i);
  });

  it('returns an explicit conflict when include graph mixes FHIR versions', async () => {
    const includeCql = `library OtherLib version '1.0.0'
using FHIR version '4.3.0'
include FHIRHelpers version '4.3.0'
define Helper: 1`;

    cqlCache.set(new ElmIncludeParser().cacheKey('OtherLib', null, '1.0.0'), includeCql);

    const root = `library RootLib version '1.0.0'
using FHIR version '5.0.0'
include FHIRHelpers version '5.0.0'
include OtherLib version '1.0.0'
define Answer: OtherLib.Helper`;

    const result = await service.translateCqlToElm(root);
    expect(result.hasErrors).toBe(true);
    expect(result.errors[0]).toMatch(/Conflicting FHIR model versions/i);
    expect(result.errors[0]).toMatch(/5\.0\.0/);
    expect(result.errors[0]).toMatch(/4\.3\.0/);
    expect(result.errors.join(' ')).not.toMatch(/already loaded/i);
  });

  it('does not treat FHIRHelpers using-version as a graph conflict', async () => {
    // Helpers stay on 4.0.1 labels but are rewritten to root FHIR; should compile.
    const root = `library HelpersOk version '1.0.0'
using FHIR version '5.0.0'
include FHIRHelpers version '4.0.1'
define Answer: 1`;

    const result = await service.translateCqlToElm(root);
    expect(result.hasErrors).toBe(false);
  });

  it('serializes exclusive async jobs in FIFO order', async () => {
    const order: string[] = [];
    const original = (service as unknown as { translateCqlToElmWithEngine: (...args: unknown[]) => unknown })
      .translateCqlToElmWithEngine.bind(service);

    vi.spyOn(
      service as unknown as { translateCqlToElmWithEngine: (...args: unknown[]) => unknown },
      'translateCqlToElmWithEngine'
    ).mockImplementation((...args: unknown[]) => {
      const cql = String(args[0] ?? '');
      const id = cql.includes('First') ? 'first' : 'second';
      order.push(`start:${id}`);
      const result = original(...args);
      order.push(`end:${id}`);
      return result;
    });

    const first = `library First version '1.0.0'
using FHIR version '4.0.1'
include FHIRHelpers version '4.0.1'
define Answer: 1`;
    const second = `library Second version '1.0.0'
using FHIR version '4.0.1'
include FHIRHelpers version '4.0.1'
define Answer: 2`;

    await Promise.all([
      service.translateCqlToElmAsync(first),
      service.translateCqlToElmAsync(second)
    ]);

    expect(order).toEqual(['start:first', 'end:first', 'start:second', 'end:second']);
  });
});
