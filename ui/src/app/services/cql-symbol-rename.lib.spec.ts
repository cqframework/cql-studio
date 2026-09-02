// Author: Preston Lee

import { describe, expect, it } from 'vitest';
import {
  collectLocalRenameSpans,
  findDefineNameTokenSpan,
  formatRenameReplacement,
  isValidCqlIdentifier
} from './cql-symbol-rename.lib';
import { CqlDefinitionIndex, CqlSourceSpan } from './elm-locator.lib';

function span(line: number, start: number, end: number): CqlSourceSpan {
  return { startLine: line, startColumn: start, endLine: line, endColumn: end };
}

describe('cql-symbol-rename.lib', () => {
  it('finds quoted and bare define name tokens', () => {
    const quoted = findDefineNameTokenSpan('define "Foo": 1', {
      name: 'Foo',
      kind: 'expression',
      span: span(1, 1, 14)
    });
    expect(quoted).toEqual(span(1, 8, 12));

    const bare = findDefineNameTokenSpan('define Bar: 1', {
      name: 'Bar',
      kind: 'expression',
      span: span(1, 1, 12)
    });
    expect(bare).toEqual(span(1, 8, 10));
  });

  it('collects def name + local refs for rename', () => {
    const source = `define Foo: 1\ndefine Bar: Foo`;
    const index: CqlDefinitionIndex = {
      definitions: new Map([
        ['Foo', [{ name: 'Foo', kind: 'expression', span: span(1, 1, 13) }]]
      ]),
      references: [
        {
          kind: 'expressionRef',
          name: 'Foo',
          libraryName: null,
          span: span(2, 13, 15)
        }
      ],
      includeStatements: [],
      includes: new Map(),
      libraryHeaderSpan: null
    };

    const spans = collectLocalRenameSpans(source, index, 'Foo', 'expression');
    expect(spans).toHaveLength(2);
  });

  it('formats rename replacements and validates identifiers', () => {
    expect(formatRenameReplacement('Foo', 'Bar', '"Foo"')).toBe('"Bar"');
    expect(formatRenameReplacement('Foo', 'Bar', 'Foo')).toBe('Bar');
    expect(formatRenameReplacement('Foo', 'A B', 'Foo')).toBe('"A B"');
    expect(formatRenameReplacement('Foo', 'Bar', ' "Foo"')).toBe(' "Bar"');
    expect(isValidCqlIdentifier('My_Def1')).toBe(true);
    expect(isValidCqlIdentifier('1bad')).toBe(false);
  });

  it('refines expressionRef spans that include ELM leading whitespace', () => {
    const source = `define Foo: 1\ndefine Bar:  Foo`;
    const index: CqlDefinitionIndex = {
      definitions: new Map([
        ['Foo', [{ name: 'Foo', kind: 'expression', span: span(1, 1, 13) }]]
      ]),
      references: [
        {
          kind: 'expressionRef',
          name: 'Foo',
          libraryName: null,
          // Deliberately padded like some ELM locators (space before name).
          span: span(2, 13, 17)
        }
      ],
      includeStatements: [],
      includes: new Map(),
      libraryHeaderSpan: null
    };

    const spans = collectLocalRenameSpans(source, index, 'Foo', 'expression');
    expect(spans).toContainEqual(span(2, 14, 16));
  });
});
