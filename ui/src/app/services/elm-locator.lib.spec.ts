// Author: Preston Lee

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, beforeEach } from 'vitest';
import { ElmIncludeParser } from './elm-include.lib';
import {
  buildDefinitionIndex,
  elmColumnToCodeMirror,
  expressionDefinitions,
  findDefinition,
  findReferenceAt,
  parseLocator,
  positionContains,
  resolveDefinitionTarget,
  spanToDocPosition
} from './elm-locator.lib';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const helloCommonElm = readFileSync(join(fixturesDir, 'hello-common.elm.xml'), 'utf8');
const helloWorldElm = readFileSync(join(fixturesDir, 'hello-world.elm.xml'), 'utf8');

describe('elm-locator.lib', () => {
  let includeParser: ElmIncludeParser;

  beforeEach(() => {
    includeParser = new ElmIncludeParser();
  });

  it('parseLocator parses ELM locator strings', () => {
    expect(parseLocator('20:15-20:21')).toEqual({
      startLine: 20,
      startColumn: 15,
      endLine: 20,
      endColumn: 21
    });
  });

  it('elmColumnToCodeMirror converts 1-based ELM columns to 0-based CodeMirror columns', () => {
    expect(elmColumnToCodeMirror(15)).toBe(14);
    expect(elmColumnToCodeMirror(1)).toBe(0);
  });

  it('positionContains uses 1-based ELM spans with 0-based CodeMirror columns', () => {
    const span = parseLocator('20:15-20:21')!;
    expect(positionContains(span, 20, 14)).toBe(true);
    expect(positionContains(span, 20, 13)).toBe(false);
    expect(positionContains(span, 19, 14)).toBe(false);
  });

  it('spanToDocPosition converts ELM span to CodeMirror doc offset', () => {
    const lines = [
      'library HelloWorld version \'1.0.0\'',
      'using FHIR version \'4.0.1\'',
      'include FHIRHelpers version \'4.0.1\'',
      'include HelloCommon version \'0.0.0\'',
      'define x: Common.MagicNumber()',
      '  First(First(Patient.name).given) + \' \' + First(Patient.name).family'
    ];
    const doc = {
      line: (lineNumber: number) => {
        const text = lines[lineNumber - 1] ?? '';
        let from = 0;
        for (let i = 0; i < lineNumber - 1; i++) {
          from += (lines[i]?.length ?? 0) + 1;
        }
        return { from, to: from + text.length, length: text.length };
      }
    };

    const patientRefSpan = parseLocator('6:15-6:21')!;
    expect(spanToDocPosition(patientRefSpan, doc)).toBe(doc.line(6).from + 14);
  });

  it('buildDefinitionIndex extracts HelloCommon function definition', () => {
    const index = buildDefinitionIndex(helloCommonElm, includeParser)!;
    const magicNumber = findDefinition(index, 'MagicNumber', 'function');
    expect(magicNumber?.span).toEqual(parseLocator('5:1-6:3'));
  });

  it('buildDefinitionIndex skips bundled FHIRHelpers include statements', () => {
    const index = buildDefinitionIndex(helloCommonElm, includeParser)!;
    expect(index.includeStatements).toEqual([]);
    expect(index.includes.size).toBe(0);
  });

  it('resolves Patient expression reference to context definition in HelloWorld fixture', () => {
    const index = buildDefinitionIndex(helloWorldElm, includeParser)!;
    const match = findReferenceAt(index, 20, 14);
    expect(match?.reference.kind).toBe('expressionRef');
    expect(match?.reference.name).toBe('Patient');

    const target = resolveDefinitionTarget(match!, index);
    expect(target?.crossLibrary).toBe(false);
    expect(target?.span).toEqual(parseLocator('14:1-14:15'));
  });

  it('buildDefinitionIndex indexes valueset/codesystem defs and refs', () => {
    const terminologyElm = readFileSync(join(fixturesDir, 'terminology-sample.elm.xml'), 'utf8');
    const index = buildDefinitionIndex(terminologyElm, includeParser)!;
    const vs = findDefinition(index, 'Mammography', 'valueset');
    expect(vs?.url).toBe('http://example.org/ValueSet/mammography');
    expect(vs?.span).toEqual(parseLocator('4:1-4:90'));

    const use = findReferenceAt(index, 7, 15);
    expect(use?.reference.kind).toBe('valueSetRef');
    expect(use?.reference.name).toBe('Mammography');
    const target = resolveDefinitionTarget(use!, index);
    expect(target?.span).toEqual(vs?.span);
  });

  it('findDefinition returns null when requested kind is absent', () => {
    const terminologyElm = readFileSync(join(fixturesDir, 'terminology-sample.elm.xml'), 'utf8');
    const index = buildDefinitionIndex(terminologyElm, includeParser)!;
    expect(findDefinition(index, 'Mammography', 'expression')).toBeNull();
    expect(findDefinition(index, 'Mammography', 'function')).toBeNull();
  });

  it('findReferenceAt prefers the innermost reference span', () => {
    const index = buildDefinitionIndex(helloWorldElm, includeParser)!;
    const match = findReferenceAt(index, 20, 14);
    expect(match?.reference.span).toEqual(parseLocator('20:15-20:21'));
  });

  it('expressionDefinitions lists ExpressionDefs and skips functions and context aliases', () => {
    const terminologyElm = readFileSync(join(fixturesDir, 'terminology-sample.elm.xml'), 'utf8');
    expect(expressionDefinitions(buildDefinitionIndex(terminologyElm, includeParser)!)).toEqual([
      { name: 'In VS', modifiers: [] },
      { name: 'From LOINC', modifiers: [] }
    ]);
    expect(expressionDefinitions(buildDefinitionIndex(helloCommonElm, includeParser)!)).toEqual([]);
    expect(expressionDefinitions(buildDefinitionIndex(helloWorldElm, includeParser)!)).toEqual([
      { name: 'HelloWorld', modifiers: [] },
      { name: 'PatientName', modifiers: [] },
      { name: 'PatientAge', modifiers: [] },
      { name: 'AllTheMagic', modifiers: [] }
    ]);
  });

  it('expressionDefinitions badges private access level', () => {
    const elm = `<?xml version="1.0" encoding="UTF-8"?>
<library xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="urn:hl7-org:elm:r1">
  <statements>
    <def xsi:type="ExpressionDef" name="Visible" locator="1:1-1:20" accessLevel="Public"/>
    <def xsi:type="ExpressionDef" name="Hidden" locator="2:1-2:20" accessLevel="Private"/>
  </statements>
</library>`;
    expect(expressionDefinitions(buildDefinitionIndex(elm, includeParser)!)).toEqual([
      { name: 'Visible', modifiers: [] },
      { name: 'Hidden', modifiers: ['private'] }
    ]);
  });
});
