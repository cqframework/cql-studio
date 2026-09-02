// Author: Preston Lee

import { normalizeFhirBaseUrlForBundlePost } from './fhir-server-base.lib';

describe('fhir-server-base.lib', () => {
  it('normalizeFhirBaseUrlForBundlePost strips trailing /Bundle (HAPI transaction target)', () => {
    expect(normalizeFhirBaseUrlForBundlePost('http://localhost:8080/fhir/Bundle')).toBe(
      'http://localhost:8080/fhir'
    );
    expect(normalizeFhirBaseUrlForBundlePost('http://localhost:8080/fhir/Bundle/')).toBe(
      'http://localhost:8080/fhir'
    );
  });

  it('normalizeFhirBaseUrlForBundlePost leaves a normal base URL unchanged', () => {
    expect(normalizeFhirBaseUrlForBundlePost('http://localhost:8080/fhir')).toBe(
      'http://localhost:8080/fhir'
    );
    expect(normalizeFhirBaseUrlForBundlePost('http://localhost:8080/fhir/')).toBe(
      'http://localhost:8080/fhir'
    );
  });
});
