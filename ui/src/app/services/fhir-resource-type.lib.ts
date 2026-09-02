import { FhirResource, Resource } from 'fhir/r4';

type ResourceTypeName = FhirResource['resourceType'];

export function resourceTypeOf(resource: Resource | undefined | null): ResourceTypeName | undefined {
  const value = (resource as { resourceType?: unknown } | undefined | null)?.resourceType;
  return typeof value === 'string' ? (value as ResourceTypeName) : undefined;
}

export function isResourceType<T extends ResourceTypeName>(
  resource: Resource | undefined | null,
  expected: T
): resource is Extract<FhirResource, { resourceType: T }> {
  return resourceTypeOf(resource) === expected;
}
