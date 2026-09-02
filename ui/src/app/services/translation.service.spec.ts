// Author: Preston Lee

import '@angular/compiler';
// @ts-expect-error No type definitions available for @lhncbc/ucum-lhc
import * as ucum from '@lhncbc/ucum-lhc';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';
import {
  ModelManager,
  LibraryManager,
  CqlTranslator,
  createModelInfoProvider,
  createLibrarySourceProvider,
  createUcumService,
  stringAsSource
} from '@cqframework/cql/cql-to-elm';
import { CqlLibrarySourceService } from './cql-library-source.service';
import { ElmIncludeParser } from './elm-include.lib';
import { TranslationService } from './translation.service';

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
    .map(error => error.message ?? '');
}

describe('TranslationService included library cache invalidation', () => {
  let service: TranslationService;
  let libraryManager: LibraryManager;
  let librarySourceService: CqlLibrarySourceService;
  let cqlCache: Map<string, string>;

  beforeEach(() => {
    cqlCache = new Map([[cacheKey('HelloCommon', '0.0.0'), helloCommonV1]]);

    const modelManager = new ModelManager(undefined, true);
    modelManager.modelInfoLoader.registerModelInfoProvider(
      createModelInfoProvider((id, system, version) => {
        if (id === 'System' && !system && !version) {
          return stringAsSource(systemModelInfo);
        }
        if (id === 'FHIR' && !system && version === '4.0.1') {
          return stringAsSource(fhirModelInfo);
        }
        return null;
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
        unit => (ucumUtils.validateUnitString(unit).status === 'valid' ? null : unit),
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

    librarySourceService = Object.create(CqlLibrarySourceService.prototype) as CqlLibrarySourceService;
    Object.assign(librarySourceService as object, {
      cqlCache,
      elmCache: new Map(),
      elmIncludeParser: new ElmIncludeParser(),
    });

    service = Object.create(TranslationService.prototype) as TranslationService;
    Object.assign(service as object, {
      libraryManager,
      librarySourceService,
    });
  });

  it('recompiles included libraries after invalidateIncludedLibraryCache', () => {
    expect(translateErrors(libraryManager, helloWorld)).toEqual([]);

    cqlCache.set(cacheKey('HelloCommon', '0.0.0'), helloCommonV2);
    expect(translateErrors(libraryManager, helloWorld)).toEqual([]);

    service.invalidateIncludedLibraryCache('HelloCommon', '0.0.0', null, helloCommonV2);
    expect(translateErrors(libraryManager, helloWorld)).toEqual([
      'Could not resolve call to operator MagicNumber with signature ().'
    ]);
  });

  it('seeds saved CQL into cache when cqlContent is provided', () => {
    service.invalidateIncludedLibraryCache('HelloCommon', '0.0.0', null, helloCommonV2);
    expect(librarySourceService.getCachedCql('HelloCommon', null, '0.0.0')).toBe(helloCommonV2);
  });

  it('preserves FHIRHelpers in compiledLibraries while clearing user libraries', () => {
    expect(translateErrors(libraryManager, helloWorld)).toEqual([]);
    const before = [...libraryManager.compiledLibraries.asJsMapView().keys()].map(k => k.id).sort();
    expect(before).toEqual(['FHIRHelpers', 'HelloCommon']);

    service.invalidateIncludedLibraryCache('HelloCommon', '0.0.0', null, helloCommonV2);
    const after = [...libraryManager.compiledLibraries.asJsMapView().keys()].map(k => k.id);
    expect(after).toEqual(['FHIRHelpers']);
  });

  it('emits ELM XML and JSON for a valid FHIR library', () => {
    const translator = CqlTranslator.fromText(
      `library Simple version '0.0.1'
using FHIR version '4.0.1'
include FHIRHelpers version '4.0.1'
define Answer: 42`,
      libraryManager
    );
    expect([...translator.errors.asJsReadonlyArrayView()]).toHaveLength(0);
    expect(translator.toXml()).toContain('<library');
    const json = JSON.parse(translator.toJson());
    expect(json.library?.identifier?.id).toBe('Simple');
    expect(json.library?.statements?.def?.some((d: { name?: string }) => d.name === 'Answer')).toBe(true);
  });
});
