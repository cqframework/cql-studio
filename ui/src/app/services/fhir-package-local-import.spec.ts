// Author: Preston Lee

import { gzipSync } from 'fflate';
import { Library } from 'fhir/r4';
import {
  DEFAULT_FHIR_CORE_PACKAGE,
  DEFAULT_FHIR_CORE_VERSION,
  buildFhirPackageJson,
  validateFhirPackageJson
} from './fhir-package-manifest.lib';
import { FhirPackageArchiveService } from './fhir-package-archive.service';
import { FhirPackageTarService } from './fhir-package-tar.service';
import { FhirPackageMetadataService } from './fhir-package-metadata.service';
import { FhirPackageJson } from '../models/fhir-package-registry.types';
import { FhirPackageLocalUploadStagingService } from './fhir-package-local-upload-staging.service';
import { decodeUtf8Bytes } from './utf8-encoding.lib';

describe('validateFhirPackageJson', () => {
  it('accepts an exporter-style Conformance package.json', () => {
    const pkg = buildFhirPackageJson({
      name: 'org.example.cql-export',
      version: '1.0.0',
      author: 'Test Author',
      description: 'Exported CQL Studio package',
      type: 'Conformance',
      dependencies: {
        [DEFAULT_FHIR_CORE_PACKAGE]: DEFAULT_FHIR_CORE_VERSION
      }
    });
    expect(validateFhirPackageJson(pkg).valid).toBe(true);
  });

  it('rejects a generic NPM-like package.json (scoped name, no FHIR core dep)', () => {
    const npmLike: FhirPackageJson = {
      name: '@acme/my-cli',
      version: '1.2.3',
      description: 'A Node CLI',
      author: 'Someone',
      dependencies: {
        lodash: '^4.17.21'
      }
    };
    const result = validateFhirPackageJson(npmLike);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /dotted namespaces/i.test(e))).toBe(true);
    expect(result.errors.some((e) => /core package/i.test(e))).toBe(true);
  });

  it('rejects missing author and description', () => {
    const pkg: FhirPackageJson = {
      name: 'org.example.incomplete',
      version: '1.0.0',
      dependencies: {
        [DEFAULT_FHIR_CORE_PACKAGE]: DEFAULT_FHIR_CORE_VERSION
      }
    };
    const result = validateFhirPackageJson(pkg);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /author/i.test(e))).toBe(true);
    expect(result.errors.some((e) => /description/i.test(e))).toBe(true);
  });

  it('requires canonical when type is IG', () => {
    const pkg: FhirPackageJson = {
      name: 'org.example.myig',
      version: '1.0.0',
      author: 'Author',
      description: 'An IG',
      type: 'IG',
      dependencies: {
        [DEFAULT_FHIR_CORE_PACKAGE]: DEFAULT_FHIR_CORE_VERSION
      }
    };
    const result = validateFhirPackageJson(pkg);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /canonical/i.test(e))).toBe(true);
  });
});

describe('local FHIR package .tgz compliance', () => {
  const tar = new FhirPackageTarService();
  const metadata = new FhirPackageMetadataService();

  function assertStrictLocalPackage(tgzBytes: ArrayBuffer): {
    packageName: string;
    rowCount: number;
  } {
    const files = tar.extractTarGz(tgzBytes);
    const raw = files.get('package/package.json');
    if (!raw) {
      throw new Error(
        'Not a FHIR package: package/package.json not found in archive. ' +
          'FHIR packages must be a .tgz with a package/ folder containing package.json.'
      );
    }
    const pkgJson = JSON.parse(decodeUtf8Bytes(raw, { fatal: false })) as FhirPackageJson;
    const validation = validateFhirPackageJson(pkgJson);
    if (!validation.valid) {
      throw new Error('Not a FHIR-compliant package: ' + validation.errors.join(' '));
    }
    const rows = metadata.buildIndexedRows(null, files, pkgJson);
    return { packageName: (pkgJson.name ?? '').trim(), rowCount: rows.length };
  }

  it('accepts a round-tripped exporter FHIR package', () => {
    const writer = new FhirPackageArchiveService();
    const pkg = buildFhirPackageJson({
      name: 'org.example.roundtrip-import',
      version: '0.2.0',
      author: 'Tester',
      description: 'Round trip import',
      dependencies: { [DEFAULT_FHIR_CORE_PACKAGE]: DEFAULT_FHIR_CORE_VERSION }
    });
    const library: Library = {
      resourceType: 'Library',
      id: 'demo',
      url: 'http://example.org/Library/demo',
      version: '0.2.0',
      status: 'active',
      type: { coding: [{ code: 'logic-library' }] }
    };
    const { tgz } = writer.createFhirPackageTgz(pkg, [library]);
    const copy = new Uint8Array(tgz.byteLength);
    copy.set(tgz);
    const parsed = assertStrictLocalPackage(copy.buffer);
    expect(parsed.packageName).toBe('org.example.roundtrip-import');
    expect(parsed.rowCount).toBeGreaterThanOrEqual(1);
  });

  it('round-trips a zero-byte tar member without corrupting subsequent entries', () => {
    const writer = new FhirPackageArchiveService();
    const files = new Map<string, Uint8Array>([
      ['package/empty.txt', new Uint8Array(0)],
      ['package/after.txt', new TextEncoder().encode('still here')]
    ]);
    const tarBytes = (
      writer as unknown as { buildUstarTar(f: Map<string, Uint8Array>): Uint8Array }
    ).buildUstarTar(files);
    const tgz = gzipSync(tarBytes, { level: 6 });
    const copy = new Uint8Array(tgz.byteLength);
    copy.set(tgz);
    const extracted = tar.extractTarGz(copy.buffer);
    expect(extracted.get('package/empty.txt')?.length).toBe(0);
    expect(decodeUtf8Bytes(extracted.get('package/after.txt')!, { fatal: false })).toBe(
      'still here'
    );
  });

  it('rejects a tarball with package/package.json that fails FHIR rules', () => {
    const badPkgJson: FhirPackageJson = {
      name: 'lodash',
      version: '4.17.21',
      author: 'npm',
      description: 'not fhir',
      dependencies: { leftpad: '1.0.0' }
    };
    const tarBytes = buildMinimalUstarTar(
      new Map([['package/package.json', new TextEncoder().encode(JSON.stringify(badPkgJson))]])
    );
    const badTgz = gzipSync(tarBytes, { level: 6 });
    const copy = new Uint8Array(badTgz.byteLength);
    copy.set(badTgz);
    expect(() => assertStrictLocalPackage(copy.buffer)).toThrow(/Not a FHIR-compliant package/i);
  });

  it('rejects archives missing package/package.json', () => {
    const tarBytes = buildMinimalUstarTar(
      new Map([['readme.txt', new TextEncoder().encode('hello')]])
    );
    const tgz = gzipSync(tarBytes, { level: 6 });
    const copy = new Uint8Array(tgz.byteLength);
    copy.set(tgz);
    expect(() => assertStrictLocalPackage(copy.buffer)).toThrow(/package\/package\.json/i);
  });
});

describe('FhirPackageLocalUploadStagingService', () => {
  it('stages and consumes once', () => {
    const staging = new FhirPackageLocalUploadStagingService();
    const bytes = new ArrayBuffer(8);
    staging.stage('demo.tgz', bytes);
    expect(staging.peek()?.fileName).toBe('demo.tgz');
    const first = staging.consume();
    expect(first?.fileName).toBe('demo.tgz');
    expect(staging.consume()).toBeNull();
  });
});

/** Minimal ustar builder for tests (mirrors FhirPackageArchiveService layout). */
function buildMinimalUstarTar(files: Map<string, Uint8Array>): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const [path, content] of files) {
    const header = new Uint8Array(512);
    const nameBytes = new TextEncoder().encode(path.slice(0, 100));
    header.set(nameBytes, 0);
    header.set(new TextEncoder().encode('0000644\0'), 100);
    header.set(new TextEncoder().encode('0000000\0'), 108);
    header.set(new TextEncoder().encode('0000000\0'), 116);
    header.set(
      new TextEncoder().encode(content.byteLength.toString(8).padStart(11, '0') + '\0'),
      124
    );
    header.set(
      new TextEncoder().encode(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0'),
      136
    );
    header[156] = 48;
    header.set(new TextEncoder().encode('ustar\0'), 257);
    header.set(new TextEncoder().encode('00'), 263);
    header.set(new TextEncoder().encode('        '), 148);
    let sum = 0;
    for (let i = 0; i < 512; i++) {
      sum += header[i];
    }
    header.set(new TextEncoder().encode(sum.toString(8).padStart(6, '0') + '\0 '), 148);
    blocks.push(header);
    const pad = Math.ceil(content.byteLength / 512) * 512;
    const data = new Uint8Array(pad);
    data.set(content);
    blocks.push(data);
  }
  blocks.push(new Uint8Array(1024));
  const total = blocks.reduce((n, b) => n + b.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const b of blocks) {
    out.set(b, offset);
    offset += b.byteLength;
  }
  return out;
}
