// Author: Preston Lee
/** @vitest-environment node */

import { describe, it, expect } from 'vitest';
import { encodeUtf8Base64, decodeUtf8Base64, decodeUtf8Bytes } from '../../src/app/services/utf8-encoding.lib';
import { isInsideCqlString, scanInvalidCqlCharacters } from '../../src/app/services/cql-character-lint.lib';

describe('utf8-encoding.lib', () => {
  it('round-trips ASCII', () => {
    const text = 'library Test version \'1.0.0\'';
    expect(decodeUtf8Base64(encodeUtf8Base64(text))).toBe(text);
  });

  it('round-trips Unicode punctuation and letters', () => {
    const text = 'define x: \'note — ≥ ä\'';
    expect(decodeUtf8Base64(encodeUtf8Base64(text))).toBe(text);
  });

  it('differs from naive btoa for non-Latin-1', () => {
    const text = '—';
    expect(() => btoa(text)).toThrow();
    const encoded = encodeUtf8Base64(text);
    expect(encoded).not.toBe('');
    expect(decodeUtf8Base64(encoded)).toBe('—');
  });

  it('decodeUtf8Bytes uses lenient mode by default', () => {
    const bytes = new Uint8Array([0xff, 0xfe]);
    const result = decodeUtf8Bytes(bytes, { fatal: false });
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('cql-character-lint.lib', () => {
  it('detects em dash outside strings', () => {
    const code = 'define x: 1 — 2';
    const diags = scanInvalidCqlCharacters(code);
    expect(diags.length).toBe(1);
    expect(diags[0].from).toBeGreaterThan(0);
  });

  it('allows em dash inside single-quoted strings', () => {
    const code = "define x: 'note — ok'";
    const diags = scanInvalidCqlCharacters(code);
    expect(diags.length).toBe(0);
  });

  it('tracks escaped quotes in strings', () => {
    expect(isInsideCqlString("define x: 'it\\'s — fine'", 20)).toBe(true);
    expect(isInsideCqlString('define x: 1 — 2', 12)).toBe(false);
  });
});

describe('CQL grammar keyword matching', () => {
  function keywordPattern(): RegExp {
    const keywords = [
      'or after', 'or before', 'or less', 'or more', 'after', 'before', 'or', 'define',
    ];
    const escaped = keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(`^(?:${escaped.join('|')})\\b`);
  }

  it('matches keywords on Unicode lines without catastrophic backtracking', () => {
    const line = 'define x: ' + 'or '.repeat(80) + '— end';
    const keyword = keywordPattern();
    const start = performance.now();
    let pos = 0;
    while (pos < line.length) {
      const slice = line.slice(pos);
      if (/^\s/.test(slice)) {
        pos++;
        continue;
      }
      const m = keyword.exec(slice);
      if (m) {
        pos += m[0].length;
        continue;
      }
      pos++;
    }
    expect(performance.now() - start).toBeLessThan(200);
    expect(pos).toBe(line.length);
  });

  it('matches single-quoted strings in one pass', () => {
    const stringRe = /^'(?:[^\\']|\\.)*?(?:'|$)/;
    const line = "define x: 'escaped \\' quote — ok' or 1";
    let pos = 0;
    while (pos < line.length) {
      const slice = line.slice(pos);
      if (/^\s/.test(slice)) {
        pos++;
        continue;
      }
      const m = stringRe.exec(slice);
      if (m) {
        pos += m[0].length;
        continue;
      }
      pos++;
    }
    expect(pos).toBe(line.length);
  });
});
