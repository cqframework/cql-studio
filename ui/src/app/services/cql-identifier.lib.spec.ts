// Author: Preston Lee

import { describe, expect, it } from 'vitest';
import {
  findBareCqlIdentifierSpan,
  findCqlNameTokenSpanOnLine,
  isInsideCqlLineCommentOrString,
  isValidCqlIdentifier,
  matchIncludeCompletionPrefix,
  quoteCqlIdentifier,
  toCqlCalledIdentifier
} from './cql-identifier.lib';

describe('cql-identifier.lib', () => {
  it('validates unquoted CQL identifiers', () => {
    expect(isValidCqlIdentifier('My_Def1')).toBe(true);
    expect(isValidCqlIdentifier('_x')).toBe(true);
    expect(isValidCqlIdentifier('1bad')).toBe(false);
    expect(isValidCqlIdentifier('has-dash')).toBe(false);
    expect(isValidCqlIdentifier('')).toBe(false);
  });

  it('finds bare identifier spans without matching substrings of longer idents', () => {
    expect(findBareCqlIdentifierSpan('define Foo: BarFoo', 'Foo')).toEqual({ start: 7, end: 10 });
    expect(findBareCqlIdentifierSpan('define FooBar: 1', 'Foo')).toBeNull();
  });

  it('refines name tokens and ignores ELM leading-space padding', () => {
    const line = 'define "In VS": "Mammography"';
    expect(findCqlNameTokenSpanOnLine(line, 7, 'Mammography')).toEqual({
      startLine: 7,
      startColumn: 17,
      endLine: 7,
      endColumn: 29
    });
  });

  it('matches include completion prefixes at end of line text', () => {
    expect(matchIncludeCompletionPrefix('include Hel')).toEqual({ term: 'Hel', termStart: 8 });
    expect(matchIncludeCompletionPrefix('  include ')).toEqual({ term: '', termStart: 10 });
    expect(matchIncludeCompletionPrefix('include')).toEqual({ term: '', termStart: 7 });
    expect(matchIncludeCompletionPrefix('reinclude X')).toBeNull();
    expect(matchIncludeCompletionPrefix('include Foo version')).toBeNull();
  });

  it('rejects include completion inside comments or strings', () => {
    expect(matchIncludeCompletionPrefix('// include Hel')).toBeNull();
    expect(matchIncludeCompletionPrefix("'include Hel")).toBeNull();
    expect(isInsideCqlLineCommentOrString('// include', 3)).toBe(true);
  });

  it('quotes identifiers and sanitizes called aliases', () => {
    expect(quoteCqlIdentifier('A B')).toBe('"A B"');
    expect(toCqlCalledIdentifier('Hello.World')).toBe('Hello_World');
    expect(toCqlCalledIdentifier('123')).toBe('_123');
  });
});
