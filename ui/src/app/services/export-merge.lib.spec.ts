// Author: Preston Lee

import { ImplementationGuide, Library, Patient } from 'fhir/r4';
import { ExportDataSelection, IgExportOptions } from './export-data-resource.lib';
import { ExportDependencyGraph } from './export-dependency-graph.service';
import {
  applyIgSanitizeIfConfigured,
  hasNonLibraryClinicalData,
  igSyncEnabled,
  mergeExportResources,
  sanitizedIgCount
} from './export-merge.lib';
import { exportDataResourceKey } from './implementation-guide.lib';

describe('export-merge.lib', () => {
  const library: Library = {
    resourceType: 'Library',
    id: 'lib1',
    status: 'active',
    type: {}
  };
  const patient: Patient = { resourceType: 'Patient', id: 'p1' };
  const ig: ImplementationGuide = {
    resourceType: 'ImplementationGuide',
    id: 'ig1',
    url: 'http://example.org/ig',
    name: 'IG',
    status: 'active',
    packageId: 'org.example.ig',
    fhirVersion: ['4.0.1'],
    definition: {
      resource: [
        { reference: { reference: 'StructureDefinition/a' } },
        { reference: { reference: 'StructureDefinition/b' } }
      ]
    }
  };

  function emptyGraph(flat: ExportDependencyGraph['flat'] = []): ExportDependencyGraph {
    return {
      roots: [],
      libraries: [],
      valueSets: [],
      codeSystems: [],
      flat,
      missingCount: 0,
      hasBlockingMissing: false,
      optionsKey: 'test'
    };
  }

  it('mergeExportResources dedupes graph and data selections by key', () => {
    const graph = emptyGraph([
      {
        key: 'Library|lib1',
        kind: 'library',
        status: 'resolved',
        resource: library,
        label: 'lib1',
        children: []
      }
    ]);
    const data: ExportDataSelection[] = [
      { key: exportDataResourceKey(library), resource: library, label: 'lib1' },
      { key: exportDataResourceKey(patient), resource: patient, label: 'p1' }
    ];
    const merged = mergeExportResources(graph, new Set(['Library|lib1']), data, {});
    expect(merged.length).toBe(2);
    expect(merged.map((r) => exportDataResourceKey(r)).sort()).toEqual([
      'Library|lib1',
      'Patient|p1'
    ]);
  });

  it('mergeExportResources sanitizes ImplementationGuide when enabled', () => {
    const igKey = exportDataResourceKey(ig);
    const opts: Record<string, IgExportOptions> = {
      [igKey]: {
        igKey,
        sanitize: true,
        syncPackageManifest: false,
        selectedEntryKeys: ['structuredefinition/a'],
        selectedGlobalIndices: [],
        resolveReferences: false
      }
    };
    const data: ExportDataSelection[] = [{ key: igKey, resource: ig, label: 'IG' }];
    const merged = mergeExportResources(emptyGraph(), new Set(), data, opts);
    expect(merged.length).toBe(1);
    const out = merged[0] as ImplementationGuide;
    expect(out.definition?.resource?.length).toBe(1);
    expect(out.definition?.resource?.[0].reference?.reference).toBe('StructureDefinition/a');
  });

  it('hasNonLibraryClinicalData detects clinical selections', () => {
    expect(
      hasNonLibraryClinicalData([{ key: 'Patient|p1', resource: patient, label: 'p1' }])
    ).toBe(true);
    expect(
      hasNonLibraryClinicalData([{ key: 'Library|lib1', resource: library, label: 'lib1' }])
    ).toBe(false);
  });

  it('sanitizedIgCount counts IGs with sanitize enabled', () => {
    const igKey = exportDataResourceKey(ig);
    const data: ExportDataSelection[] = [{ key: igKey, resource: ig, label: 'IG' }];
    expect(sanitizedIgCount(data, { [igKey]: { igKey, sanitize: true, syncPackageManifest: false, selectedEntryKeys: [], selectedGlobalIndices: [], resolveReferences: false } })).toBe(1);
    expect(sanitizedIgCount(data, {})).toBe(0);
  });

  it('igSyncEnabled requires a currently selected IG with sync enabled', () => {
    const igKey = exportDataResourceKey(ig);
    const opts: Record<string, IgExportOptions> = {
      [igKey]: {
        igKey,
        sanitize: false,
        syncPackageManifest: true,
        selectedEntryKeys: [],
        selectedGlobalIndices: [],
        resolveReferences: false
      }
    };
    expect(igSyncEnabled([{ key: igKey, resource: ig, label: 'IG' }], opts)).toBe(true);
    expect(igSyncEnabled([], opts)).toBe(false);
  });

  it('applyIgSanitizeIfConfigured leaves the source resource unchanged when sanitize is off', () => {
    const igKey = exportDataResourceKey(ig);
    const out = applyIgSanitizeIfConfigured(ig, {
      [igKey]: {
        igKey,
        sanitize: false,
        syncPackageManifest: false,
        selectedEntryKeys: [],
        selectedGlobalIndices: [],
        resolveReferences: false
      }
    }) as ImplementationGuide;
    expect(out.definition?.resource?.length).toBe(2);
  });
});
