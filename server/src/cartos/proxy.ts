// Author: Preston Lee

import { createAllowlistedFhirProxyRouter } from '../fhir/allowlist-proxy.js';

export const DEFAULT_CARTOS_FHIR_BASE = 'https://cartos.healthit.gov/TerminologyServer/R4';

/**
 * Mounted at `/api/cartos/fhir`. Public ONC Cartos FHIR R4 terminology API (no auth).
 */
export const cartosFhirProxyRouter = createAllowlistedFhirProxyRouter({
  mountPath: '/api/cartos/fhir',
  allowedHosts: new Set(['cartos.healthit.gov']),
  defaultBaseUrl: DEFAULT_CARTOS_FHIR_BASE,
  baseUrlHeaderName: 'x-cartos-fhir-base-url',
  forwardAuthorization: false,
  label: 'Cartos'
});
