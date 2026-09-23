// Author: Preston Lee

import { Library } from 'fhir/r4';
import { describe, expect, it } from 'vitest';
import { encodeUtf8Base64 } from './utf8-encoding.lib';
import { decodeModelInfoXmlFromLibrary } from './cql-model-info.lib';
import {
  alignCompanionLibrary,
  CMS_COMPANION_VERSION_REWRITES,
  CMS_USQUALITYCORE_MODEL,
  prepareUsQualityCoreModelInfo,
  readLibraryCql,
} from './cms-execution-dependencies.lib';

describe('CMS execution dependency identity', () => {
  it('rewrites USQualityCore ModelInfo identity to 0.1.0-cibuild', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<modelInfo name="USQualityCore" version="0.1.0" url="http://example.org/usqualitycore"/>`;
    const library = prepareUsQualityCoreModelInfo(xml);
    expect(library.name).toBe('USQualityCore');
    expect(library.version).toBe(CMS_USQUALITYCORE_MODEL.version);
    expect(library.id).toBe('USQualityCore-ModelInfo');
    const decoded = decodeModelInfoXmlFromLibrary(library) ?? '';
    expect(decoded).toContain('version="0.1.0-cibuild"');
    expect(decoded).not.toContain('version="0.5.0"');
  });

  it('refuses to relabel a USQualityCore ModelInfo that is not 0.1.0', () => {
    const xml = `<modelInfo name="USQualityCore" version="0.5.0"/>`;
    expect(() => prepareUsQualityCoreModelInfo(xml)).toThrow(/0\.1\.0/);
  });

  it('rewrites companion library and include versions to the ballot label and drops published ELM', () => {
    const cql = [
      "library USCoreElements version '2.0.0'",
      "include USCoreCommon version '2.0.0' called UC",
      "include hl7.fhir.uv.cql.FHIRHelpers version '4.0.1'",
    ].join('\n');
    const library: Library = {
      resourceType: 'Library',
      id: 'USCoreElements',
      name: 'USCoreElements',
      version: '2.0.0',
      status: 'active',
      content: [
        { contentType: 'text/cql', data: encodeUtf8Base64(cql) },
        { contentType: 'application/elm+json', data: encodeUtf8Base64('{"library":{}}') },
      ],
    };
    const aligned = alignCompanionLibrary(
      library,
      { name: 'USCoreElements', version: '2.0.0-ballot' },
      CMS_COMPANION_VERSION_REWRITES
    );
    const rewritten = readLibraryCql(aligned);
    expect(aligned.version).toBe('2.0.0-ballot');
    expect(rewritten).toContain("library USCoreElements version '2.0.0-ballot'");
    expect(rewritten).toContain("include USCoreCommon version '2.0.0-ballot'");
    expect(rewritten).toContain("include FHIRHelpers version '4.0.1'");
    expect(rewritten).not.toContain('hl7.fhir.uv.cql.');
    expect(aligned.content?.some((item) => item.contentType === 'application/elm+json')).toBe(false);
  });
});
