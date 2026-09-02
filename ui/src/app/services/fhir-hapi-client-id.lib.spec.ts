// Author: Preston Lee

import { Patient, Resource } from 'fhir/r4';
import { cloneResourcesWithHapiSafeClientIds, mangleNumericOnlyIdsForHapi } from './fhir-hapi-client-id.lib';

describe('fhir-hapi-client-id.lib', () => {
  it('prefixes numeric-only logical ids and leaves non-numeric ids unchanged', () => {
    const p: Patient = { resourceType: 'Patient', id: '101' };
    mangleNumericOnlyIdsForHapi(p);
    expect(p.id).toBe('n101');
    const q: Patient = { resourceType: 'Patient', id: 'abc' };
    mangleNumericOnlyIdsForHapi(q);
    expect(q.id).toBe('abc');
  });

  it('rewrites Reference.reference when target is another transaction entry', () => {
    const patient: Patient = { resourceType: 'Patient', id: '99' };
    const obs: Resource = {
      resourceType: 'Observation',
      id: '1',
      subject: { reference: 'Patient/99' }
    } as Resource;
    const [p2, o2] = cloneResourcesWithHapiSafeClientIds([patient, obs]);
    expect(p2.id).toBe('n99');
    expect(o2.id).toBe('n1');
    expect((o2 as { subject?: { reference?: string } }).subject?.reference).toBe('Patient/n99');
  });

  it('preserves version suffix on reference after pipe', () => {
    const patient: Patient = { resourceType: 'Patient', id: '7' };
    const obs: Resource = {
      resourceType: 'Observation',
      id: '2',
      subject: { reference: 'Patient/7|http://example.org/fhir' }
    } as Resource;
    const [, o2] = cloneResourcesWithHapiSafeClientIds([patient, obs]);
    expect((o2 as { subject?: { reference?: string } }).subject?.reference).toBe(
      'Patient/n7|http://example.org/fhir'
    );
  });

  it('mangles contained resource ids', () => {
    const p: Patient = {
      resourceType: 'Patient',
      id: '5',
      contained: [{ resourceType: 'Observation', id: '8', status: 'final', code: { text: 'x' } } as Resource]
    };
    mangleNumericOnlyIdsForHapi(p);
    expect(p.id).toBe('n5');
    expect(p.contained?.[0].id).toBe('n8');
  });

  it('rewrites local "#id" references to a mangled contained resource id', () => {
    const p: Patient = {
      resourceType: 'Patient',
      id: '5',
      contained: [{ resourceType: 'Observation', id: '8', status: 'final', code: { text: 'x' } } as Resource],
      generalPractitioner: [{ reference: '#8' }]
    } as Patient;
    mangleNumericOnlyIdsForHapi(p);
    expect(p.contained?.[0].id).toBe('n8');
    expect((p.generalPractitioner ?? [])[0]?.reference).toBe('#n8');
  });

  it('cloneResourcesWithHapiSafeClientIds does not mutate originals', () => {
    const original: Patient = { resourceType: 'Patient', id: '42' };
    const [clone] = cloneResourcesWithHapiSafeClientIds([original]);
    expect(original.id).toBe('42');
    expect(clone.id).toBe('n42');
  });
});
