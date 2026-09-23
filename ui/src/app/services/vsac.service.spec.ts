// Author: Preston Lee

import { describe, expect, it } from 'vitest';
import { vsacValueSetIdFromCanonical } from './vsac.service';

describe('vsacValueSetIdFromCanonical', () => {
  it('reads the OID from a CTS ValueSet canonical', () => {
    expect(vsacValueSetIdFromCanonical(
      'http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113762.1.4.1186.8',
    )).toBe('2.16.840.1.113762.1.4.1186.8');
    expect(vsacValueSetIdFromCanonical(
      'https://uat-cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113883.3.464.1003.198.12.1017/',
    )).toBe('2.16.840.1.113883.3.464.1003.198.12.1017');
  });

  it('ignores non-CTS URLs and bare OIDs', () => {
    expect(vsacValueSetIdFromCanonical('https://example.org/fhir/ValueSet/1')).toBeNull();
    expect(vsacValueSetIdFromCanonical('2.16.840.1.113762.1.4.1186.8')).toBeNull();
    expect(vsacValueSetIdFromCanonical('http://cts.nlm.nih.gov/fhir/ValueSet?url=1')).toBeNull();
  });
});
