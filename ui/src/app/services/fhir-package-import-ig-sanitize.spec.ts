// Author: Preston Lee

import { Injector, runInInjectionContext } from '@angular/core';
import { ImplementationGuide } from 'fhir/r4';
import { minimalImplementationGuide } from '../../testing/spec-helpers';
import { IndexedResourceRowVm } from '../models/fhir-package-view.model';
import { FhirPackageImportService } from './fhir-package-import.service';
import { parseImplementationGuideEntries } from './implementation-guide.lib';
import { TerminologyService } from './terminology.service';
import { FhirClientService } from './fhir-client.service';
import { SettingsService } from './settings.service';

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe('FhirPackageImportService IG sanitize', () => {
  it('keeps sanitized ImplementationGuide partitionable via __filename', () => {
    const injector = Injector.create({
      providers: [
        FhirPackageImportService,
        { provide: TerminologyService, useValue: {} },
        { provide: FhirClientService, useValue: {} },
        { provide: SettingsService, useValue: {} }
      ]
    });
    const service = runInInjectionContext(injector, () =>
      injector.get(FhirPackageImportService)
    );

    const ig = minimalImplementationGuide({
      id: 'example',
      name: 'Example',
      definition: {
        resource: [
          { reference: { reference: 'StructureDefinition/a' } },
          { reference: { reference: 'StructureDefinition/b' } }
        ]
      }
    });
    const filename = 'package/ImplementationGuide-example.json';
    const row: IndexedResourceRowVm = {
      rowKey: filename,
      filename,
      resourceType: 'ImplementationGuide',
      id: 'example',
      url: '',
      version: '',
      kind: '',
      typeField: '',
      selected: true,
      isExample: false,
      suggestedTarget: 'data',
      targetTerminology: false,
      targetData: true,
      category: '',
      importNote: ''
    };
    const files = new Map<string, Uint8Array>([[filename, utf8(JSON.stringify(ig))]]);
    const keep = new Set(
      parseImplementationGuideEntries(ig)
        .filter((e) => e.reference === 'StructureDefinition/a')
        .map((e) => e.key)
    );

    const { resources, errors } = service.collectResourcesFromFiles([row], files, {
      igFilename: filename,
      includedEntryKeys: keep,
      includedGlobalIndices: new Set()
    });
    expect(errors).toEqual([]);
    expect(resources.length).toBe(1);
    expect((resources[0] as ImplementationGuide).definition?.resource?.length).toBe(1);
    expect((resources[0] as { __filename?: string }).__filename).toBe(filename);

    const selectedByPath = new Map([[filename, row]]);
    const { dataRes, termRes } = service.partitionByTargets(resources, selectedByPath);
    expect(termRes.length).toBe(0);
    expect(dataRes.length).toBe(1);
    expect(dataRes[0].resourceType).toBe('ImplementationGuide');
  });
});
