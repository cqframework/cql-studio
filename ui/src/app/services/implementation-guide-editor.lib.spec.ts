// Author: Preston Lee

import type { ImplementationGuide, Library } from 'fhir/r4';
import { minimalImplementationGuide, minimalLibrary } from '../../testing/spec-helpers';
import {
  applyGuideEdits,
  dependenciesFromGuide,
  guideSearchAttempts,
  memberEndpointRoles,
  memberReferenceFor,
  memberSearchAttempts,
  membersFromGuide,
  validateGuideDraft,
  type GuideDraft
} from './implementation-guide-editor.lib';

function draft(overrides: Partial<GuideDraft> = {}): GuideDraft {
  return {
    url: 'http://example.org/ImplementationGuide/example',
    version: '1.0.0',
    name: 'ExampleIG',
    title: 'Example IG',
    status: 'draft',
    experimental: false,
    date: '2026-09-21',
    publisher: 'Example Org',
    description: 'A guide.',
    packageId: 'org.example.ig',
    fhirVersion: ['4.0.1'],
    dependencies: [],
    members: [],
    ...overrides
  };
}

function richGuide(): ImplementationGuide {
  return minimalImplementationGuide({
    id: 'example-ig',
    url: 'http://example.org/ImplementationGuide/example',
    version: '1.2.3',
    name: 'ExampleIG',
    title: 'Example IG',
    status: 'active',
    experimental: true,
    publisher: 'Example Org',
    description: 'Original description',
    packageId: 'org.example.ig',
    license: 'Apache-2.0',
    contact: [{ name: 'Ops' }],
    meta: { versionId: '3', tag: [{ system: 'http://example.org/tags', code: 'keep' }] },
    fhirVersion: ['4.0.1'],
    global: [{ type: 'Patient', profile: 'http://example.org/StructureDefinition/patient' }],
    dependsOn: [{
      id: 'core',
      uri: 'http://hl7.org/fhir/us/core/ImplementationGuide/us-core',
      packageId: 'hl7.fhir.us.core',
      version: '6.1.0',
      extension: [{ url: 'http://example.org/dep', valueBoolean: true }]
    }],
    definition: {
      id: 'definition',
      grouping: [{ id: 'conformance', name: 'Conformance' }],
      page: { nameUrl: 'index.html', title: 'Home', generation: 'markdown' },
      parameter: [{ code: 'generate-json', value: 'true' }],
      resource: [{
        id: 'lib',
        extension: [{ url: 'http://example.org/ext', valueBoolean: true }],
        reference: { reference: 'Library/lib', display: 'Logic' },
        name: 'Logic',
        groupingId: 'conformance',
        exampleCanonical: 'http://example.org/StructureDefinition/lib'
      }]
    },
    manifest: {
      resource: [{ reference: { reference: 'Library/lib' }, relativePath: 'package/Library-lib.json' }]
    }
  });
}

describe('implementation-guide-editor.lib', () => {
  it('preserves unmanaged ImplementationGuide content when listed fields change', () => {
    const source = richGuide();
    const members = membersFromGuide(source);
    expect(members[0]?.example).toBe(true);
    expect(members[0]?.exampleCanonical).toBe('http://example.org/StructureDefinition/lib');

    const updated = applyGuideEdits(source, draft({
      version: '1.3.0',
      description: 'Updated description',
      experimental: false,
      dependencies: dependenciesFromGuide(source).map((dependency) => ({
        ...dependency,
        version: '7.0.0'
      })),
      members: members.map((member) => ({ ...member, name: 'Logic library' }))
    }));

    expect(updated.id).toBe('example-ig');
    expect(updated.version).toBe('1.3.0');
    expect(updated.description).toBe('Updated description');
    expect(updated.experimental).toBe(false);
    expect(updated.license).toBe('Apache-2.0');
    expect(updated.contact?.[0]?.name).toBe('Ops');
    expect(updated.meta?.versionId).toBe('3');
    expect(updated.meta?.tag?.[0]?.code).toBe('keep');
    expect(updated.global?.[0]?.profile).toBe('http://example.org/StructureDefinition/patient');
    expect(updated.manifest?.resource?.[0]?.relativePath).toBe('package/Library-lib.json');
    expect(updated.definition?.id).toBe('definition');
    expect(updated.definition?.grouping?.[0]?.name).toBe('Conformance');
    expect(updated.definition?.page?.title).toBe('Home');
    expect(updated.definition?.parameter?.[0]?.code).toBe('generate-json');
    expect(updated.dependsOn?.[0]?.version).toBe('7.0.0');
    expect(updated.dependsOn?.[0]?.extension?.[0]?.url).toBe('http://example.org/dep');

    const resource = updated.definition?.resource?.[0];
    expect(resource?.name).toBe('Logic library');
    expect(resource?.groupingId).toBe('conformance');
    expect(resource?.exampleCanonical).toBe('http://example.org/StructureDefinition/lib');
    expect(resource?.exampleBoolean).toBeUndefined();
    expect(resource?.reference?.display).toBe('Logic');
    expect(resource?.extension?.[0]?.url).toBe('http://example.org/ext');
  });

  it('clears example markers without dropping the resource entry', () => {
    const source = richGuide();
    const updated = applyGuideEdits(source, draft({
      dependencies: dependenciesFromGuide(source),
      members: membersFromGuide(source).map((member) => ({ ...member, example: false }))
    }));
    const resource = updated.definition?.resource?.[0];
    expect(resource?.reference?.reference).toBe('Library/lib');
    expect(resource?.exampleBoolean).toBeUndefined();
    expect(resource?.exampleCanonical).toBeUndefined();
    expect(resource?.groupingId).toBe('conformance');
    expect(updated.definition?.page?.title).toBe('Home');
  });

  it('removes definition resources while keeping the manifest and global profiles', () => {
    const source = minimalImplementationGuide({
      name: 'ExampleIG',
      version: '1.0.0',
      global: [{ type: 'Patient', profile: 'http://example.org/StructureDefinition/patient' }],
      definition: { resource: [{ reference: { reference: 'Library/lib' }, name: 'Logic' }] },
      manifest: { resource: [{ reference: { reference: 'Library/lib' } }] }
    });
    const updated = applyGuideEdits(source, draft({ members: [] }));
    expect(updated.definition).toBeUndefined();
    expect(updated.manifest?.resource?.length).toBe(1);
    expect(updated.global?.length).toBe(1);
  });

  it('rejects clearing every resource when the definition still has build metadata', () => {
    const source = richGuide();
    const fields = draft({ members: [], dependencies: dependenciesFromGuide(source) });
    expect(validateGuideDraft(fields, source)).toMatch(/at least one listed resource/);
    expect(() => applyGuideEdits(source, fields)).toThrow(/at least one listed resource/);
  });

  it('rejects a machine name that does not match the FHIR name invariant', () => {
    expect(validateGuideDraft(draft({ name: 'example-ig' }), null)).toMatch(/uppercase/);
  });

  it('searches NamingSystem by name and other types by title, then name', () => {
    expect(memberSearchAttempts('NamingSystem', 'ICD')).toEqual([
      { _count: '25', _total: 'accurate', 'name:contains': 'ICD' }
    ]);
    expect(memberSearchAttempts('Library', 'Diabetes')).toEqual([
      { _count: '25', _total: 'accurate', 'title:contains': 'Diabetes' },
      { _count: '25', _total: 'accurate', 'name:contains': 'Diabetes' }
    ]);
    expect(memberSearchAttempts('Library', 'Library/lib-1')).toEqual([
      { _count: '25', _total: 'accurate', _id: 'lib-1' }
    ]);
    expect(guideSearchAttempts('http://example.org/ImplementationGuide/example|1.0.0')).toEqual([
      { _count: '50', _total: 'accurate', url: 'http://example.org/ImplementationGuide/example' }
    ]);
  });

  it('uses a canonical URL when the artifact was found off the content endpoint', () => {
    const library: Library = minimalLibrary({
      id: 'lib',
      url: 'http://example.org/Library/lib',
      name: 'Logic'
    });
    expect(memberReferenceFor(library, true)).toBe('Library/lib');
    expect(memberReferenceFor(library, false)).toBe('http://example.org/Library/lib');
    expect(memberEndpointRoles('ValueSet')).toEqual(['content', 'terminology']);
    expect(memberEndpointRoles('Library')).toEqual(['content', 'evaluation']);
  });
});
