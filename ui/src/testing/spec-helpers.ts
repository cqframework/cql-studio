// Author: Preston Lee

import type { ImplementationGuide, Library, ValueSet } from 'fhir/r4';
import type { CqlEnvironment } from '../app/models/environment.model';

/** Writable test double for assigning protected/private service dependencies. */
export function asTestDouble<T extends object>(): T {
  return Object.create(null) as T;
}

export function assignTestDeps<T extends object, D extends object>(target: T, deps: D): T & D {
  return Object.assign(target as object, deps) as T & D;
}

export const minimalLibraryFields = {
  status: 'active' as const,
  type: { coding: [{ code: 'logic-library' as const }] },
};

export function minimalLibrary(overrides: Partial<Library> = {}): Library {
  return {
    resourceType: 'Library',
    ...minimalLibraryFields,
    ...overrides,
  };
}

export function minimalImplementationGuide(overrides: Partial<ImplementationGuide> = {}): ImplementationGuide {
  return {
    resourceType: 'ImplementationGuide',
    url: 'http://example.org/ImplementationGuide/example',
    name: 'example',
    status: 'active',
    packageId: 'example',
    fhirVersion: ['4.0.1'],
    ...overrides,
  };
}

export function testEnvironment(overrides: Partial<CqlEnvironment> = {}): CqlEnvironment {
  return {
    id: 'default',
    name: 'Default',
    evaluationServer: { address: 'http://localhost/fhir' },
    dataEndpoint: { address: '' },
    terminologyEndpoint: { address: '' },
    contentEndpoint: { address: '' },
    ...overrides,
  };
}

export function asValueSet(value: object): ValueSet {
  return value as ValueSet;
}

export function asValueSets(values: object[]): ValueSet[] {
  return values as ValueSet[];
}
