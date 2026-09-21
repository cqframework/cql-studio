// Author: Preston Lee

import { describe, expect, it } from 'vitest';
import { lookupModelInfoXmlFromPayload } from './cql-debug-model-info.lib';

describe('lookupModelInfoXmlFromPayload', () => {
  it('prefers modelInfoByKey over deprecated fields', () => {
    const xml = lookupModelInfoXmlFromPayload(
      {
        systemModelInfoXml: '<old-system/>',
        fhirModelInfoXml: '<old-fhir/>',
        modelInfoByKey: {
          'System|': '<system/>',
          'FHIR|4.0.1': '<fhir/>',
          'QICore|6.0.0': '<qicore/>'
        }
      },
      'QICore',
      '6.0.0'
    );
    expect(xml).toBe('<qicore/>');
  });

  it('falls back to deprecated System/FHIR fields', () => {
    expect(
      lookupModelInfoXmlFromPayload(
        {
          systemModelInfoXml: '<system/>',
          fhirModelInfoXml: '<fhir/>',
          modelInfoByKey: {}
        },
        'System',
        null
      )
    ).toBe('<system/>');
    expect(
      lookupModelInfoXmlFromPayload(
        {
          systemModelInfoXml: '<system/>',
          fhirModelInfoXml: '<fhir/>',
          modelInfoByKey: {}
        },
        'FHIR',
        '4.0.1'
      )
    ).toBe('<fhir/>');
  });

  it('returns null for unknown models', () => {
    expect(
      lookupModelInfoXmlFromPayload(
        {
          systemModelInfoXml: '<system/>',
          fhirModelInfoXml: '<fhir/>',
          modelInfoByKey: {}
        },
        'USQualityCore',
        '0.5.0'
      )
    ).toBeNull();
  });
});
