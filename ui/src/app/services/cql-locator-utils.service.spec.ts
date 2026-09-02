// Author: Preston Lee

import '@angular/compiler';
// @ts-expect-error No type definitions available for @lhncbc/ucum-lhc
import * as ucum from '@lhncbc/ucum-lhc';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ModelManager,
  LibraryManager,
  CqlTranslator,
  createModelInfoProvider,
  createUcumService,
  stringAsSource
} from '@cqframework/cql/cql-to-elm';
import { CqlLocatorUtilsService } from './cql-locator-utils.service';

const cqlDir = join(process.cwd(), 'public/cql');
const systemModelInfo = readFileSync(join(cqlDir, 'system-modelinfo.xml'), 'utf8');
const fhirModelInfo = readFileSync(join(cqlDir, 'fhir-modelinfo-4.0.1.xml'), 'utf8');

function createLibraryManager(): LibraryManager {
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

  const unsupportedUcumOp = (): never => {
    throw new Error('Unsupported operation');
  };
  const ucumUtils = ucum.UcumLhcUtils.getInstance();
  return new LibraryManager(
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
}

describe('CqlLocatorUtilsService', () => {
  it('uses startLine/startChar when present on the locator', () => {
    const service = new CqlLocatorUtilsService();

    const locatorInfo = service.extractLocatorInfo({
      message: 'Could not load source',
      locator: {
        startLine: 3,
        startChar: 1,
        endLine: 3,
        endChar: 35
      }
    } as any);

    expect(locatorInfo).toEqual({ line: 3, column: 1, endLine: 3, endColumn: 35 });
  });

  it('parses TrackBack.toString() when property names are mangled', () => {
    const service = new CqlLocatorUtilsService();
    const locator = {
      r89_1: {},
      s89_1: 5,
      t89_1: 13,
      u89_1: 5,
      v89_1: 15,
      toString() {
        return "TrackBack{library='[object Object]', startLine=5, startChar=13, endLine=5, endChar=15}";
      }
    };

    const locatorInfo = service.extractLocatorInfo({
      message: 'Could not resolve identifier',
      locator
    } as any);

    expect(locatorInfo).toEqual({ line: 5, column: 13, endLine: 5, endColumn: 15 });
  });

  it('extracts 1-based TrackBack columns from live semantic exceptions', () => {
    const service = new CqlLocatorUtilsService();
    const cql = `library Test version '1.0.0'
using FHIR version '4.0.1'
define X: Foo`;
    const translator = CqlTranslator.fromText(cql, createLibraryManager());
    const error = [...translator.errors.asJsReadonlyArrayView()].find(e => e != null);
    expect(error).toBeTruthy();

    const locatorInfo = service.extractLocatorInfo(error!);
    const lineText = cql.split('\n')[2];
    // TrackBack startChar is already 1-based for semantic errors; Foo starts at column 11.
    expect(locatorInfo.line).toBe(3);
    expect(locatorInfo.column).toBe(11);
    expect(locatorInfo.endColumn).toBe(13);
    expect(lineText.slice(locatorInfo.column! - 1, locatorInfo.endColumn!)).toBe('Foo');
  });

  it('normalizes ANTLR 0-based syntax exception columns to 1-based', () => {
    const service = new CqlLocatorUtilsService();
    const cql = `library Test version '1.0.0'
define X: ,`;
    const translator = CqlTranslator.fromText(cql, createLibraryManager());
    const error = [...translator.errors.asJsReadonlyArrayView()].find(
      e => e != null && e.constructor?.name === 'CqlSyntaxException'
    );
    expect(error).toBeTruthy();

    const locatorInfo = service.extractLocatorInfo(error!);
    const lineText = cql.split('\n')[1];
    expect(locatorInfo.line).toBe(2);
    expect(lineText.slice(locatorInfo.column! - 1, locatorInfo.endColumn!)).toBe(',');
  });
});
