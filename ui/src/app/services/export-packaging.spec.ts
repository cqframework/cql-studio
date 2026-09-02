// Author: Preston Lee

import { Library, ValueSet } from 'fhir/r4';
import {
  extractElmValueSets,
  extractUsedElmValueSets,
  parseElmJsonForValueSets
} from './elm-value-set-extract.lib';
import {
  extractComposeCodeSystemUrls,
  extractComposeValueSetReferences,
  normalizeCanonicalKey
} from './valueset-compose-refs.lib';
import {
  DEFAULT_FHIR_CORE_PACKAGE,
  DEFAULT_FHIR_CORE_VERSION,
  buildFhirPackageJson,
  buildFhirPackageIndexJson,
  validateFhirPackageManifestInput
} from './fhir-package-manifest.lib';
import { FhirPackageArchiveService } from './fhir-package-archive.service';
import { FhirPackageTarService } from './fhir-package-tar.service';
import { CrmiArtifactPackageService } from './crmi-artifact-package.service';
import { normalizeBundleForBasePost } from './fhir-bundle-transaction.lib';

describe('elm-value-set-extract.lib', () => {
  const elm = {
    library: {
      valueSets: {
        def: [
          { name: 'Office Visit', id: 'http://example.org/ValueSet/office' },
          { name: 'Unused', id: 'http://example.org/ValueSet/unused' }
        ]
      },
      statements: {
        def: [
          {
            name: 'InOffice',
            expression: { type: 'ValueSetRef', name: 'Office Visit' }
          }
        ]
      }
    }
  };

  it('extractElmValueSets returns all declared sets', () => {
    const refs = extractElmValueSets(elm);
    expect(refs.length).toBe(2);
    expect(refs[0].url).toContain('office');
  });

  it('extractUsedElmValueSets filters to ValueSetRef usage', () => {
    const refs = extractUsedElmValueSets(elm);
    expect(refs.map((r) => r.name)).toEqual(['Office Visit']);
  });

  it('parseElmJsonForValueSets accepts wrapper or bare library', () => {
    expect(parseElmJsonForValueSets(JSON.stringify(elm))?.library.valueSets?.def?.length).toBe(2);
    expect(
      parseElmJsonForValueSets(JSON.stringify(elm.library))?.library.valueSets?.def?.length
    ).toBe(2);
  });
});

describe('valueset-compose-refs.lib', () => {
  const vs: ValueSet = {
    resourceType: 'ValueSet',
    status: 'active',
    compose: {
      include: [
        {
          system: 'http://loinc.org',
          valueSet: ['http://example.org/ValueSet/child-a']
        }
      ],
      exclude: [
        {
          system: 'http://snomed.info/sct',
          valueSet: ['http://example.org/ValueSet/child-b']
        }
      ]
    }
  };

  it('extractComposeValueSetReferences walks include and exclude', () => {
    const refs = extractComposeValueSetReferences(vs);
    expect(refs).toEqual([
      { relation: 'include', reference: 'http://example.org/ValueSet/child-a' },
      { relation: 'exclude', reference: 'http://example.org/ValueSet/child-b' }
    ]);
  });

  it('extractComposeCodeSystemUrls collects systems', () => {
    expect(extractComposeCodeSystemUrls(vs).sort()).toEqual(
      ['http://loinc.org', 'http://snomed.info/sct'].sort()
    );
  });

  it('normalizeCanonicalKey lowercases urls and strips urn:oid', () => {
    expect(normalizeCanonicalKey('HTTP://Example.ORG/X')).toBe('http://example.org/x');
    expect(normalizeCanonicalKey('urn:oid:1.2.3')).toBe('1.2.3');
  });
});

describe('fhir-package-manifest.lib', () => {
  it('rejects missing required fields and core dependency', () => {
    const result = validateFhirPackageManifestInput({
      name: '',
      version: '',
      author: '',
      description: '',
      dependencies: {}
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('accepts a FHIR-conformant Conformance package input', () => {
    const input = {
      name: 'org.example.cql-export',
      version: '1.0.0',
      author: 'Test Author',
      description: 'Test package',
      type: 'Conformance',
      dependencies: {
        [DEFAULT_FHIR_CORE_PACKAGE]: DEFAULT_FHIR_CORE_VERSION
      }
    };
    expect(validateFhirPackageManifestInput(input).valid).toBe(true);
    const pkg = buildFhirPackageJson(input);
    expect(pkg.name).toBe('org.example.cql-export');
    expect(pkg.dependencies?.[DEFAULT_FHIR_CORE_PACKAGE]).toBe(DEFAULT_FHIR_CORE_VERSION);
    expect(pkg.fhirVersions).toEqual(['4.0.1']);
    expect(pkg.type).toBe('Conformance');
  });

  it('builds .index.json entries from resource primitives only', () => {
    const index = buildFhirPackageIndexJson([
      {
        filename: 'Library-demo.json',
        resource: {
          resourceType: 'Library',
          id: 'demo',
          url: 'http://example.org/Library/demo',
          version: '1.0.0',
          status: 'active',
          type: { coding: [{ code: 'logic-library' }] }
        } as Library
      }
    ]);
    expect(index['index-version']).toBe(2);
    expect(index.files?.[0]).toMatchObject({
      filename: 'Library-demo.json',
      resourceType: 'Library',
      id: 'demo',
      url: 'http://example.org/Library/demo',
      version: '1.0.0'
    });
  });
});

describe('FhirPackageArchiveService', () => {
  it('round-trips a FHIR package through tar extract', () => {
    const writer = new FhirPackageArchiveService();
    const reader = new FhirPackageTarService();
    const pkg = buildFhirPackageJson({
      name: 'org.example.roundtrip',
      version: '0.1.0',
      author: 'Tester',
      description: 'Round trip',
      dependencies: { [DEFAULT_FHIR_CORE_PACKAGE]: DEFAULT_FHIR_CORE_VERSION }
    });
    const library: Library = {
      resourceType: 'Library',
      id: 'demo',
      url: 'http://example.org/Library/demo',
      version: '0.1.0',
      status: 'active',
      type: { coding: [{ code: 'logic-library' }] }
    };
    const { tgz, index } = writer.createFhirPackageTgz(pkg, [library]);
    const copy = new Uint8Array(tgz.byteLength);
    copy.set(tgz);
    const files = reader.extractTarGz(copy.buffer);
    expect(files.has('package/package.json')).toBe(true);
    expect(files.has('package/.index.json')).toBe(true);
    expect(files.has('package/Library-demo.json')).toBe(true);
    const parsedPkg = JSON.parse(new TextDecoder().decode(files.get('package/package.json')));
    expect(parsedPkg.name).toBe('org.example.roundtrip');
    expect(parsedPkg.dependencies[DEFAULT_FHIR_CORE_PACKAGE]).toBe(DEFAULT_FHIR_CORE_VERSION);
    expect(index.files?.length).toBe(1);
  });

  it('creates a zip of text files', () => {
    const writer = new FhirPackageArchiveService();
    const zip = writer.createZip({ 'cql/Demo.cql': "library Demo version '1.0'" });
    expect(zip.byteLength).toBeGreaterThan(20);
  });
});

describe('CrmiArtifactPackageService', () => {
  const service = new CrmiArtifactPackageService();

  it('puts primary library first and uses ifNoneExist for conditional create', () => {
    const primary: Library = {
      resourceType: 'Library',
      id: 'primary',
      url: 'http://example.org/Library/primary',
      version: '1.0.0',
      status: 'active',
      type: { coding: [{ code: 'logic-library' }] }
    };
    const dep: Library = {
      resourceType: 'Library',
      id: 'dep',
      url: 'http://example.org/Library/dep',
      version: '1.0.0',
      status: 'active',
      type: { coding: [{ code: 'logic-library' }] }
    };
    const bundle = service.buildArtifactBundle([primary], [dep], {
      bundleType: 'transaction',
      conditionalCreate: true
    });
    expect(bundle.type).toBe('transaction');
    expect((bundle.entry?.[0]?.resource as Library).id).toBe('primary');
    expect(bundle.entry?.[0]?.request?.method).toBe('POST');
    expect(bundle.entry?.[0]?.request?.ifNoneExist).toBe(
      `url=${encodeURIComponent('http://example.org/Library/primary')}&version=1.0.0`
    );
  });

  it('omits request entries on collection bundles', () => {
    const primary: Library = {
      resourceType: 'Library',
      id: 'primary',
      url: 'http://example.org/Library/primary',
      version: '1.0.0',
      status: 'active',
      type: { coding: [{ code: 'logic-library' }] }
    };
    const bundle = service.buildArtifactBundle([primary], [], {
      bundleType: 'collection',
      conditionalCreate: true
    });
    expect(bundle.type).toBe('collection');
    expect(bundle.entry?.[0]?.request).toBeUndefined();
  });

  it('preserves ifNoneExist when normalizeBundleForBasePost sees a transaction', () => {
    const primary: Library = {
      resourceType: 'Library',
      id: 'primary',
      url: 'http://example.org/Library/primary',
      version: '1.0.0',
      status: 'active',
      type: { coding: [{ code: 'logic-library' }] }
    };
    const bundle = service.buildArtifactBundle([primary], [], {
      bundleType: 'transaction',
      conditionalCreate: true
    });
    const normalized = normalizeBundleForBasePost(bundle);
    expect(normalized.type).toBe('transaction');
    expect(normalized.entry?.[0]?.request?.ifNoneExist).toBeTruthy();
  });

  it('builds an asset-collection when multiple primaries are selected', () => {
    const a: Library = {
      resourceType: 'Library',
      id: 'a',
      url: 'http://example.org/Library/a',
      version: '1.0.0',
      status: 'active',
      type: { coding: [{ code: 'logic-library' }] }
    };
    const b: Library = {
      resourceType: 'Library',
      id: 'b',
      url: 'http://example.org/Library/b',
      version: '1.0.0',
      status: 'active',
      type: { coding: [{ code: 'logic-library' }] }
    };
    const bundle = service.buildArtifactBundle([a, b], [], {
      packageName: 'org.example.collection',
      packageVersion: '0.2.0'
    });
    const first = bundle.entry?.[0]?.resource as Library;
    expect(first.type?.coding?.[0]?.code).toBe('asset-collection');
    expect(first.name).toBe('org.example.collection');
  });
});
