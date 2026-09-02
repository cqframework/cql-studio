// Author: Preston Lee

import { FhirPackageJson } from '../models/fhir-package-registry.types';
import {
  archivePathPrefixesForExampleDirectories,
  filenameIsUnderExamplePrefixes
} from './fhir-package-directories.lib';

describe('fhir-package-directories.lib', () => {
  it('archivePathPrefixesForExampleDirectories reads directories.example and examples', () => {
    const pkg: FhirPackageJson = {
      name: 'x',
      directories: { example: 'example', examples: 'other-examples' }
    };
    expect(archivePathPrefixesForExampleDirectories(pkg)).toEqual([
      'package/example/',
      'package/other-examples/'
    ]);
  });

  it('archivePathPrefixesForExampleDirectories returns empty when directories missing', () => {
    expect(archivePathPrefixesForExampleDirectories({})).toEqual([]);
  });

  it('archivePathPrefixesForExampleDirectories strips a leading "./"', () => {
    const pkg: FhirPackageJson = { name: 'x', directories: { example: './example' } };
    expect(archivePathPrefixesForExampleDirectories(pkg)).toEqual(['package/example/']);
  });

  it('archivePathPrefixesForExampleDirectories does not double-prefix an already-package-relative value', () => {
    const pkg: FhirPackageJson = { name: 'x', directories: { example: 'package/example' } };
    expect(archivePathPrefixesForExampleDirectories(pkg)).toEqual(['package/example/']);
  });

  it('filenameIsUnderExamplePrefixes matches package-relative paths', () => {
    const prefixes = ['package/example/'];
    expect(filenameIsUnderExamplePrefixes('package/example/Patient-1.json', prefixes)).toBe(true);
    expect(filenameIsUnderExamplePrefixes('package/foo/Patient-1.json', prefixes)).toBe(false);
    expect(filenameIsUnderExamplePrefixes('package/example', prefixes)).toBe(false);
  });
});
