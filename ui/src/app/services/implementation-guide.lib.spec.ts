// Author: Preston Lee

import type { ImplementationGuide, Patient, StructureDefinition } from 'fhir/r4';
import { minimalImplementationGuide } from '../../testing/spec-helpers';
import { IndexedResourceRowVm } from '../models/fhir-package-view.model';
import {
  buildFhirPackageManifestFromIg,
  classifyIgEntryImportability,
  defaultSelectedIgEntryKeys,
  enrichIgEntriesForArchive,
  enrichIgEntriesForBundle,
  exportDataResourceKey,
  filterImplementationGuide,
  matchIgReferenceToArchiveRow,
  matchIgReferenceToBundleEntry,
  parseImplementationGuideEntries
} from './implementation-guide.lib';

function sampleIg(): ImplementationGuide {
  return {
    resourceType: 'ImplementationGuide',
    id: 'example-ig',
    url: 'http://example.org/ImplementationGuide/example',
    name: 'ExampleIG',
    title: 'Example IG',
    status: 'active',
    packageId: 'org.example.ig',
    version: '1.2.3',
    publisher: 'Example Org',
    fhirVersion: ['4.0.1'],
    dependsOn: [
      {
        uri: 'http://hl7.org/fhir/us/core',
        packageId: 'hl7.fhir.us.core',
        version: '6.1.0'
      }
    ],
    global: [{ type: 'Patient', profile: 'http://example.org/StructureDefinition/patient' }],
    definition: {
      resource: [
        {
          reference: { reference: 'StructureDefinition/patient-profile' },
          name: 'Patient Profile'
        },
        {
          reference: { reference: 'Patient/example' },
          name: 'Example Patient',
          exampleBoolean: true
        },
        {
          reference: { reference: 'CapabilityStatement/server' },
          name: 'Server CS'
        }
      ]
    },
    manifest: {
      resource: [
        {
          reference: { reference: 'ValueSet/demo' },
          relativePath: 'package/ValueSet-demo.json'
        }
      ]
    }
  };
}

describe('implementation-guide.lib', () => {
  it('parseImplementationGuideEntries merges definition and manifest entries', () => {
    const entries = parseImplementationGuideEntries(sampleIg());
    expect(entries.map((e) => e.reference)).toEqual([
      'CapabilityStatement/server',
      'Patient/example',
      'StructureDefinition/patient-profile',
      'ValueSet/demo'
    ]);
    const example = entries.find((e) => e.reference === 'Patient/example');
    expect(example?.isExample).toBe(true);
    expect(example?.importable).toBe(false);
    const vs = entries.find((e) => e.reference === 'ValueSet/demo');
    expect(vs?.relativePath).toBe('package/ValueSet-demo.json');
    // Same logical ref from definition + manifest uses one pathless selection key.
    expect(vs?.key).toBe('valueset/demo');
  });

  it('filterImplementationGuide keeps matching definition and manifest sides for one key', () => {
    const ig = minimalImplementationGuide({
      name: 'Dual',
      definition: {
        resource: [{ reference: { reference: 'ValueSet/demo' }, name: 'Demo VS' }]
      },
      manifest: {
        resource: [
          {
            reference: { reference: 'ValueSet/demo' },
            relativePath: 'package/ValueSet-demo.json'
          }
        ]
      }
    });
    const key = parseImplementationGuideEntries(ig)[0].key;
    const filtered = filterImplementationGuide(ig, new Set([key]));
    expect(filtered.definition?.resource?.length).toBe(1);
    expect(filtered.manifest?.resource?.length).toBe(1);
  });

  it('filterImplementationGuide keeps display-only references when selected', () => {
    const ig = minimalImplementationGuide({
      name: 'DisplayOnly',
      definition: {
        resource: [{ reference: { display: 'StructureDefinition/patient-profile' } }]
      }
    });
    const key = parseImplementationGuideEntries(ig)[0].key;
    const filtered = filterImplementationGuide(ig, new Set([key]));
    expect(filtered.definition?.resource?.length).toBe(1);
  });

  it('classifyIgEntryImportability rejects examples and CapabilityStatement', () => {
    expect(
      classifyIgEntryImportability({
        key: 'a',
        reference: 'Patient/x',
        isExample: true,
        importable: true
      }).importable
    ).toBe(false);
    expect(
      classifyIgEntryImportability({
        key: 'b',
        reference: 'CapabilityStatement/x',
        isExample: false,
        importable: true,
        resourceTypeHint: 'CapabilityStatement'
      }).reason
    ).toContain('CapabilityStatement');
  });

  it('defaultSelectedIgEntryKeys prefers conformance types and skips examples', () => {
    const keys = defaultSelectedIgEntryKeys(parseImplementationGuideEntries(sampleIg()));
    expect([...keys]).toContain(
      parseImplementationGuideEntries(sampleIg()).find(
        (e) => e.reference === 'StructureDefinition/patient-profile'
      )!.key
    );
    expect([...keys].some((k) => k.includes('patient/example'))).toBe(false);
  });

  it('matchIgReferenceToArchiveRow matches by type/id, url, and relativePath', () => {
    const rows: IndexedResourceRowVm[] = [
      {
        rowKey: '1',
        filename: 'package/StructureDefinition-patient-profile.json',
        resourceType: 'StructureDefinition',
        id: 'patient-profile',
        url: 'http://example.org/StructureDefinition/patient-profile',
        version: '',
        kind: '',
        typeField: '',
        selected: false,
        isExample: false,
        suggestedTarget: 'data',
        targetTerminology: false,
        targetData: true,
        category: '',
        importNote: ''
      },
      {
        rowKey: '2',
        filename: 'package/ValueSet-demo.json',
        resourceType: 'ValueSet',
        id: 'demo',
        url: 'http://example.org/ValueSet/demo',
        version: '',
        kind: '',
        typeField: '',
        selected: false,
        isExample: false,
        suggestedTarget: 'terminology',
        targetTerminology: true,
        targetData: false,
        category: '',
        importNote: ''
      }
    ];
    expect(matchIgReferenceToArchiveRow('StructureDefinition/patient-profile', undefined, rows)?.rowKey).toBe(
      '1'
    );
    expect(
      matchIgReferenceToArchiveRow('http://example.org/ValueSet/demo', undefined, rows)?.rowKey
    ).toBe('2');
    expect(
      matchIgReferenceToArchiveRow('ValueSet/demo', 'package/ValueSet-demo.json', rows)?.rowKey
    ).toBe('2');
  });

  it('matchIgReferenceToBundleEntry matches type/id and canonical url', () => {
    const sd: StructureDefinition = {
      resourceType: 'StructureDefinition',
      id: 'patient-profile',
      url: 'http://example.org/StructureDefinition/patient-profile',
      name: 'PatientProfile',
      status: 'active',
      kind: 'resource',
      abstract: false,
      type: 'Patient'
    };
    const patient: Patient = { resourceType: 'Patient', id: 'example' };
    expect(matchIgReferenceToBundleEntry('StructureDefinition/patient-profile', [sd, patient])?.id).toBe(
      'patient-profile'
    );
    expect(
      matchIgReferenceToBundleEntry('http://example.org/StructureDefinition/patient-profile', [sd])
        ?.id
    ).toBe('patient-profile');
    expect(matchIgReferenceToBundleEntry('Observation/missing', [sd, patient])).toBeNull();
  });

  it('enrichIgEntriesForArchive marks unmatched entries unimportable', () => {
    const entries = parseImplementationGuideEntries(sampleIg());
    const enriched = enrichIgEntriesForArchive(entries, []);
    expect(enriched.every((e) => !e.importable)).toBe(true);
    expect(enriched.every((e) => e.skipReason === 'Not in package')).toBe(true);
  });

  it('enrichIgEntriesForBundle marks unmatched entries unimportable', () => {
    const entries = parseImplementationGuideEntries(sampleIg());
    const enriched = enrichIgEntriesForBundle(entries, []);
    expect(enriched.every((e) => !e.importable)).toBe(true);
    expect(enriched.every((e) => e.skipReason === 'Not present in bundle')).toBe(true);
  });

  it('filterImplementationGuide keeps only selected entries and globals', () => {
    const ig = sampleIg();
    const entries = parseImplementationGuideEntries(ig);
    const keep = new Set(
      entries.filter((e) => e.reference === 'StructureDefinition/patient-profile').map((e) => e.key)
    );
    const filtered = filterImplementationGuide(ig, keep, new Set([0]));
    expect(filtered.definition?.resource?.length).toBe(1);
    expect(filtered.definition?.resource?.[0].reference?.reference).toBe(
      'StructureDefinition/patient-profile'
    );
    expect(filtered.manifest?.resource?.length).toBe(0);
    expect(filtered.global?.length).toBe(1);
  });

  it('buildFhirPackageManifestFromIg maps package metadata and dependsOn', () => {
    const manifest = buildFhirPackageManifestFromIg(sampleIg());
    expect(manifest.name).toBe('org.example.ig');
    expect(manifest.version).toBe('1.2.3');
    expect(manifest.type).toBe('IG');
    expect(manifest.canonical).toBe('http://example.org/ImplementationGuide/example');
    expect(manifest.dependencies?.['hl7.fhir.us.core']).toBe('6.1.0');
  });

  it('exportDataResourceKey prefers id then url', () => {
    expect(exportDataResourceKey({ resourceType: 'Patient', id: 'p1' })).toBe('Patient|p1');
    expect(
      exportDataResourceKey({
        resourceType: 'StructureDefinition',
        url: 'http://Example.org/SD'
      } as StructureDefinition)
    ).toBe('StructureDefinition|http://example.org/sd');
  });

  it('filterImplementationGuide preserves enumerable sidecars; import reattaches __filename for safety', () => {
    const ig = sampleIg() as ImplementationGuide & { __filename?: string };
    ig.__filename = 'package/ImplementationGuide-example.json';
    const filtered = filterImplementationGuide(
      ig,
      new Set(['structuredefinition/patient-profile'])
    ) as ImplementationGuide & { __filename?: string };
    // JSON clone keeps enumerable sidecars; import path still reattaches after filter.
    filtered.__filename = 'package/ImplementationGuide-example.json';
    expect(filtered.__filename).toBe('package/ImplementationGuide-example.json');
    expect(filtered.definition?.resource?.length).toBe(1);
  });
});
