// Author: Preston Lee

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractLocatorInfo, formatLocator } from '../build/cql-locator.js';

describe('extractLocatorInfo', () => {
  it('uses startLine/startChar when present on the locator', () => {
    const locatorInfo = extractLocatorInfo({
      message: 'Could not load source',
      locator: {
        startLine: 3,
        startChar: 1,
        endLine: 3,
        endChar: 35
      }
    });

    assert.deepEqual(locatorInfo, { line: 3, column: 1, endLine: 3, endColumn: 35 });
  });

  it('parses TrackBack.toString() when property names are mangled', () => {
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

    const locatorInfo = extractLocatorInfo({
      message: 'Could not resolve identifier',
      locator
    });

    assert.deepEqual(locatorInfo, { line: 5, column: 13, endLine: 5, endColumn: 15 });
  });

  it('falls back to ordered numeric mangled fields when toString is unavailable', () => {
    const locatorInfo = extractLocatorInfo({
      message: 'error',
      locator: {
        r89_1: {},
        s89_1: 2,
        t89_1: 10,
        u89_1: 2,
        v89_1: 12
      }
    });

    assert.deepEqual(locatorInfo, { line: 2, column: 10, endLine: 2, endColumn: 12 });
  });

  it('normalizes ANTLR 0-based syntax exception columns to 1-based', () => {
    class CqlSyntaxException {
      name = 'CqlSyntaxException';
      message: string;
      locator: object;
      constructor(message: string, locator: object) {
        this.message = message;
        this.locator = locator;
      }
    }

    const locatorInfo = extractLocatorInfo(
      new CqlSyntaxException('mismatched input', {
        startLine: 2,
        startChar: 10,
        endLine: 2,
        endChar: 10
      })
    );

    assert.deepEqual(locatorInfo, { line: 2, column: 11, endLine: 2, endColumn: 11 });
  });

  it('normalizes line 0 to 1', () => {
    const locatorInfo = extractLocatorInfo({
      locator: { startLine: 0, startChar: 1, endLine: 0, endChar: 1 }
    });

    assert.equal(locatorInfo.line, 1);
    assert.equal(locatorInfo.endLine, 1);
  });

  it('returns nulls when locator is missing', () => {
    assert.deepEqual(extractLocatorInfo({ message: 'x' }), {
      line: null,
      column: null,
      endLine: null,
      endColumn: null
    });
  });
});

describe('formatLocator', () => {
  it('formats line and column', () => {
    assert.equal(
      formatLocator({ line: 5, column: 13, endLine: 5, endColumn: 15 }),
      '(line 5, column 13)'
    );
  });

  it('uses ? when column is missing', () => {
    assert.equal(
      formatLocator({ line: 2, column: null, endLine: null, endColumn: null }),
      '(line 2, column ?)'
    );
  });

  it('returns empty string when line is missing', () => {
    assert.equal(formatLocator({ line: null, column: null, endLine: null, endColumn: null }), '');
  });
});
