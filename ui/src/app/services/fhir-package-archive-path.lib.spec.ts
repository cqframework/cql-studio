// Author: Preston Lee

import { describe, expect, it } from 'vitest';
import { resolvePackageArchiveKey } from './fhir-package-archive-path.lib';

describe('resolvePackageArchiveKey', () => {
  it('resolves paths without package/ prefix', () => {
    const files = new Map<string, Uint8Array>([['package/ValueSet-x.json', new Uint8Array([1])]]);
    expect(resolvePackageArchiveKey('ValueSet-x.json', files)).toBe('package/ValueSet-x.json');
  });

  it('keeps canonical package/ paths', () => {
    const files = new Map<string, Uint8Array>([['package/a/b.json', new Uint8Array([1])]]);
    expect(resolvePackageArchiveKey('package/a/b.json', files)).toBe('package/a/b.json');
  });

  it('normalizes backslashes', () => {
    const files = new Map<string, Uint8Array>([['package/foo.json', new Uint8Array([1])]]);
    expect(resolvePackageArchiveKey('package\\foo.json', files)).toBe('package/foo.json');
  });

  it('returns null when missing', () => {
    const files = new Map<string, Uint8Array>([['package/other.json', new Uint8Array([1])]]);
    expect(resolvePackageArchiveKey('nope.json', files)).toBe(null);
  });
});
