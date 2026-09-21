// Author: Preston Lee

import { describe, expect, it } from 'vitest';
import {
  decodeModelInfoXmlFromLibrary,
  extractCqlUsingDeclarations,
  isModelDefinitionLibrary,
  isModelDefinitionTypeField,
  libraryTypeCode,
  libraryTypeSearchToken,
  LOGIC_LIBRARY_TYPE_CODE,
  MODEL_DEFINITION_TYPE_CODE,
  modelInfoCacheKey,
  normalizeModelDefinitionLibrary,
  alignModelDefinitionIdentity,
  parseModelInfoXmlIdentity,
  resolveModelInfoIdentity,
  rewriteModelInfoXmlIdentity,
  wrapModelInfoXmlAsLibrary,
  rewriteFhirHelpersCql,
  wrapFhirHelpersCqlAsLibrary
} from './cql-model-info.lib';
import type { Library } from 'fhir/r4';
import { encodeUtf8Base64 } from './utf8-encoding.lib';

describe('cql-model-info.lib', () => {
  it('extractCqlUsingDeclarations parses models and versions', () => {
    const cql = `
library Test version '1.0.0'
using FHIR version '4.0.1'
using QICore version '6.0.0'
// using Ignored version '9.0.0'
include FHIRHelpers version '4.0.1' called FHIRHelpers
`;
    expect(extractCqlUsingDeclarations(cql)).toEqual([
      { name: 'FHIR', version: '4.0.1' },
      { name: 'QICore', version: '6.0.0' }
    ]);
  });

  it('modelInfoCacheKey joins name and version', () => {
    expect(modelInfoCacheKey('QICore', '6.0.0')).toBe('QICore|6.0.0');
    expect(modelInfoCacheKey('System', null)).toBe('System|');
  });

  it('libraryTypeSearchToken builds system|code tokens', () => {
    expect(libraryTypeSearchToken(LOGIC_LIBRARY_TYPE_CODE)).toBe(
      'http://terminology.hl7.org/CodeSystem/library-type|logic-library'
    );
    expect(libraryTypeSearchToken(MODEL_DEFINITION_TYPE_CODE)).toBe(
      'http://terminology.hl7.org/CodeSystem/library-type|model-definition'
    );
  });

  it('detects model-definition type codes', () => {
    expect(isModelDefinitionTypeField('model-definition')).toBe(true);
    expect(
      libraryTypeCode({
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/library-type',
            code: 'model-definition'
          }
        ]
      })
    ).toBe('model-definition');
  });

  it('decodes ModelInfo XML and normalizes FHIRModelDefinition name', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<modelInfo xmlns="urn:hl7-org:elm-modelinfo:r1" name="FHIR" version="5.0.0">
</modelInfo>`;
    const library: Library = {
      resourceType: 'Library',
      name: 'FHIRModelDefinition',
      version: '5.0.0',
      type: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/library-type',
            code: 'model-definition'
          }
        ]
      },
      content: [{ contentType: 'application/xml', data: encodeUtf8Base64(xml) }]
    };
    expect(isModelDefinitionLibrary(library)).toBe(true);
    expect(decodeModelInfoXmlFromLibrary(library)?.includes('name="FHIR"')).toBe(true);
    const identity = resolveModelInfoIdentity(library, xml);
    expect(identity.name).toBe('FHIR');
    expect(identity.version).toBe('5.0.0');
    const normalized = normalizeModelDefinitionLibrary(library);
    expect(normalized.name).toBe('FHIR');
  });

  it('alignModelDefinitionIdentity rewrites embedded XML version to catalog version', () => {
    const xml = `<?xml version="1.0"?><modelInfo name="FHIR" version="4.0.1" url="http://hl7.org/fhir"></modelInfo>`;
    const library: Library = {
      resourceType: 'Library',
      name: 'FHIR',
      version: '4.3.0',
      type: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/library-type',
            code: 'model-definition'
          }
        ]
      },
      content: [{ contentType: 'application/xml', data: encodeUtf8Base64(xml) }]
    };
    const aligned = alignModelDefinitionIdentity(library, { name: 'FHIR', version: '4.3.0' });
    expect(aligned.version).toBe('4.3.0');
    const decoded = decodeModelInfoXmlFromLibrary(aligned)!;
    expect(decoded).toContain('version="4.3.0"');
    expect(decoded).not.toContain('version="4.0.1"');
    expect(parseModelInfoXmlIdentity(decoded)).toEqual({ name: 'FHIR', version: '4.3.0' });
  });

  it('rewriteModelInfoXmlIdentity handles namespaced modelInfo roots', () => {
    const xml = `<?xml version="1.0"?><ns4:modelInfo name="FHIR" version="4.0.0" url="http://hl7.org/fhir" xmlns:ns4="urn:hl7-org:elm-modelinfo:r1"/>`;
    const rewritten = rewriteModelInfoXmlIdentity(xml, 'FHIR', '5.0.0');
    expect(parseModelInfoXmlIdentity(rewritten)).toEqual({ name: 'FHIR', version: '5.0.0' });
    expect(rewritten).not.toContain('version="4.0.0"');
  });

  it('rewriteModelInfoXmlIdentity can retarget 4.3.0 XML to 5.0.0', () => {
    const xml = `<?xml version="1.0"?><modelInfo xmlns="urn:hl7-org:elm-modelinfo:r1" name="FHIR" version="4.3.0" url="http://hl7.org/fhir"></modelInfo>`;
    const rewritten = rewriteModelInfoXmlIdentity(xml, 'FHIR', '5.0.0');
    expect(parseModelInfoXmlIdentity(rewritten)?.version).toBe('5.0.0');
  });

  it('wrapModelInfoXmlAsLibrary builds a model-definition Library', () => {
    const xml = `<?xml version="1.0"?><modelInfo name="QICore" version="6.0.0"></modelInfo>`;
    const library = wrapModelInfoXmlAsLibrary(xml);
    expect(library.resourceType).toBe('Library');
    expect(library.name).toBe('QICore');
    expect(library.version).toBe('6.0.0');
    expect(parseModelInfoXmlIdentity(xml)).toEqual({ name: 'QICore', version: '6.0.0' });
  });

  it('rewriteFhirHelpersCql updates library and using versions', () => {
    const cql = `library FHIRHelpers version '4.0.1'

using FHIR version '4.0.1'

define function ToString(value String): value`;
    const rewritten = rewriteFhirHelpersCql(cql, '5.0.0', '5.0.0');
    expect(rewritten).toContain(`library FHIRHelpers version '5.0.0'`);
    expect(rewritten).toContain(`using FHIR version '5.0.0'`);
    const library = wrapFhirHelpersCqlAsLibrary(rewritten, '5.0.0');
    expect(library.name).toBe('FHIRHelpers');
    expect(library.version).toBe('5.0.0');
    expect(libraryTypeCode(library.type)).toBe('logic-library');
  });
});
