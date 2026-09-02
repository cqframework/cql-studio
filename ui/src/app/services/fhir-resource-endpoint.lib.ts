// Author: Preston Lee

export type FhirEndpointRole = 'evaluation' | 'data' | 'terminology' | 'content';

const TERMINOLOGY_TYPES = new Set([
  'CodeSystem',
  'ValueSet',
  'ConceptMap',
  'NamingSystem'
]);

const EVALUATION_TYPES = new Set(['Library', 'Measure', 'MeasureReport']);

const CONFORMANCE_TYPES = new Set([
  'StructureDefinition',
  'SearchParameter',
  'OperationDefinition',
  'CompartmentDefinition',
  'ImplementationGuide',
  'CapabilityStatement',
  'MessageDefinition',
  'StructureMap',
  'TestScript',
  'TestReport'
]);

export function primaryEndpointForResourceType(resourceType: string): FhirEndpointRole {
  if (EVALUATION_TYPES.has(resourceType)) {
    return 'evaluation';
  }
  if (TERMINOLOGY_TYPES.has(resourceType)) {
    return 'terminology';
  }
  return 'data';
}

export function fallbackEndpointsForResourceType(resourceType: string): FhirEndpointRole[] {
  const primary = primaryEndpointForResourceType(resourceType);
  const fallbacks: FhirEndpointRole[] = [];
  if (primary === 'data' && (TERMINOLOGY_TYPES.has(resourceType) || CONFORMANCE_TYPES.has(resourceType))) {
    fallbacks.push('terminology');
  }
  if (primary === 'terminology' && CONFORMANCE_TYPES.has(resourceType)) {
    fallbacks.push('data');
  }
  if (resourceType === 'Library') {
    fallbacks.push('content');
  }
  if (resourceType === 'ImplementationGuide') {
    fallbacks.push('terminology');
  }
  return fallbacks;
}

export function endpointOrderForResourceType(resourceType: string): FhirEndpointRole[] {
  const primary = primaryEndpointForResourceType(resourceType);
  const seen = new Set<FhirEndpointRole>([primary]);
  const order = [primary];
  for (const fb of fallbackEndpointsForResourceType(resourceType)) {
    if (!seen.has(fb)) {
      seen.add(fb);
      order.push(fb);
    }
  }
  return order;
}

export function isConformanceResourceType(resourceType: string): boolean {
  return (
    TERMINOLOGY_TYPES.has(resourceType) ||
    EVALUATION_TYPES.has(resourceType) ||
    CONFORMANCE_TYPES.has(resourceType)
  );
}

/** Infer FHIR type from a canonical URL path segment (e.g. .../ValueSet/foo). */
export function guessResourceTypeFromCanonicalUrl(canonicalUrl: string): string | undefined {
  const path = canonicalUrl.split('|')[0] ?? '';
  const match = /\/([A-Z][A-Za-z0-9]+)\//.exec(path);
  return match?.[1];
}
