// Author: Preston Lee

import { guessResourceTypeFromCanonicalUrl } from './fhir-resource-endpoint.lib';

describe('fhir-resource-endpoint.lib canonical helpers', () => {
  it('guessResourceTypeFromCanonicalUrl infers type from path segments', () => {
    expect(
      guessResourceTypeFromCanonicalUrl('http://example.org/ValueSet/demo')
    ).toBe('ValueSet');
    expect(
      guessResourceTypeFromCanonicalUrl(
        'http://example.org/StructureDefinition/patient|1.0.0'
      )
    ).toBe('StructureDefinition');
    expect(
      guessResourceTypeFromCanonicalUrl('http://example.org/CodeSystem/loinc')
    ).toBe('CodeSystem');
  });

  it('guessResourceTypeFromCanonicalUrl returns undefined without a type segment', () => {
    expect(guessResourceTypeFromCanonicalUrl('http://example.org/fhir')).toBeUndefined();
    expect(guessResourceTypeFromCanonicalUrl('urn:uuid:abc')).toBeUndefined();
  });
});
