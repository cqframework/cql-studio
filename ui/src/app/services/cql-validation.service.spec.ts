// Author: Preston Lee

import '@angular/compiler';
// @ts-expect-error No type definitions available for @lhncbc/ucum-lhc
import * as ucum from '@lhncbc/ucum-lhc';
import { Injector } from '@angular/core';
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
import { CqlValidationService } from './cql-validation.service';
import { CqlLocatorUtilsService } from './cql-locator-utils.service';
import { TranslationService } from './translation.service';

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

describe('CqlValidationService', () => {
  function configureServiceWithErrors(errors: any[]): CqlValidationService {
    const injector = Injector.create({
      providers: [
        CqlValidationService,
        CqlLocatorUtilsService,
        {
          provide: TranslationService,
          useValue: {
            translateCqlToElmRaw: () => ({
              elmXml: null,
              errors,
              warnings: [],
              messages: [],
              hasErrors: errors.length > 0
            })
          }
        }
      ]
    });

    return injector.get(CqlValidationService);
  }

  it('deduplicates equivalent CodeMirror diagnostics', () => {
    const duplicateError = {
      message: 'Syntax error at ,',
      locator: {
        startLine: 2,
        startChar: 7,
        endLine: 2,
        endChar: 16
      }
    };
    const service = configureServiceWithErrors([duplicateError, duplicateError]);
    const doc = {
      line: () => ({ from: 24, length: 20, to: 44 })
    };

    const result = service.validate('library Test', doc);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      message: 'Syntax error at ,',
      line: 2,
      column: 7,
      from: 30,
      to: 40
    });
  });

  it('deduplicates equivalent structured errors for the Problems panel', () => {
    const duplicateError = {
      message: 'Syntax error at ,',
      locator: {
        startLine: 2,
        startChar: 7,
        endLine: 2,
        endChar: 16
      }
    };
    const service = configureServiceWithErrors([duplicateError, duplicateError]);

    const result = service.getStructuredErrors('library Test');

    expect(result).toEqual([
      {
        message: 'Syntax error at ,',
        line: 2,
        column: 7,
        severity: 'error',
        formattedMessage: 'Syntax error at , (line 2, column 7)'
      }
    ]);
  });

  it('maps live translator TrackBack columns to CodeMirror 0-based offsets', () => {
    const cql = `library Test version '1.0.0'
using FHIR version '4.0.1'
define X: Foo`;
    const translator = CqlTranslator.fromText(cql, createLibraryManager());
    const errors = [...translator.errors.asJsReadonlyArrayView()].filter(e => e != null);
    expect(errors.length).toBeGreaterThan(0);

    const service = configureServiceWithErrors(errors);
    const lines = cql.split('\n');
    let offset = 0;
    const lineStarts = lines.map(line => {
      const start = offset;
      offset += line.length + 1;
      return start;
    });
    const doc = {
      line: (n: number) => {
        const text = lines[n - 1] ?? '';
        const from = lineStarts[n - 1] ?? 0;
        return { from, length: text.length, to: from + text.length };
      }
    };

    const result = service.validate(cql, doc);
    const error = result.errors[0];
    expect(error.line).toBe(3);
    expect(error.column).toBe(11);
    // 1-based column 11..13 => CodeMirror slice covering "Foo"
    expect(cql.slice(error.from, error.to)).toBe('Foo');
  });

  it('maps live syntax exception columns onto the offending token', () => {
    const cql = `library Test version '1.0.0'
define X: ,`;
    const translator = CqlTranslator.fromText(cql, createLibraryManager());
    const errors = [...translator.errors.asJsReadonlyArrayView()].filter(
      e => e != null && e.constructor?.name === 'CqlSyntaxException'
    );
    expect(errors.length).toBeGreaterThan(0);

    const service = configureServiceWithErrors(errors);
    const lines = cql.split('\n');
    let offset = 0;
    const lineStarts = lines.map(line => {
      const start = offset;
      offset += line.length + 1;
      return start;
    });
    const doc = {
      line: (n: number) => {
        const text = lines[n - 1] ?? '';
        const from = lineStarts[n - 1] ?? 0;
        return { from, length: text.length, to: from + text.length };
      }
    };

    const result = service.validate(cql, doc);
    const error = result.errors[0];
    expect(cql.slice(error.from, error.to)).toBe(',');
  });

  it('highlights the last character for EOF syntax errors past line end', () => {
    const cql = `library Test version '1.0.0'
define X: (`;
    const translator = CqlTranslator.fromText(cql, createLibraryManager());
    const errors = [...translator.errors.asJsReadonlyArrayView()].filter(
      e => e != null && e.constructor?.name === 'CqlSyntaxException'
    );
    expect(errors.length).toBeGreaterThan(0);

    const service = configureServiceWithErrors(errors);
    const lines = cql.split('\n');
    let offset = 0;
    const lineStarts = lines.map(line => {
      const start = offset;
      offset += line.length + 1;
      return start;
    });
    const doc = {
      line: (n: number) => {
        const text = lines[n - 1] ?? '';
        const from = lineStarts[n - 1] ?? 0;
        return { from, length: text.length, to: from + text.length };
      }
    };

    const result = service.validate(cql, doc);
    const error = result.errors[0];
    expect(error.from).toBeLessThan(error.to);
    expect(cql.slice(error.from, error.to)).toBe('(');
  });
});
