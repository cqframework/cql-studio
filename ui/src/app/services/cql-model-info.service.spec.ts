// Author: Preston Lee

import { Injector, runInInjectionContext } from '@angular/core';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { CqlModelInfoService } from './cql-model-info.service';
import { LibraryService } from './library.service';
import { EnvironmentService } from './environment.service';
import type { Library } from 'fhir/r4';
import { encodeUtf8Base64 } from './utf8-encoding.lib';

describe('CqlModelInfoService', () => {
  it('resolves content then evaluation and caches XML', async () => {
    const xml = `<?xml version="1.0"?><modelInfo name="QICore" version="6.0.0"></modelInfo>`;
    const library: Library = {
      resourceType: 'Library',
      name: 'QICore',
      version: '6.0.0',
      type: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/library-type',
            code: 'model-definition'
          }
        ]
      },
      content: [{ contentType: 'application/xml', data: encodeUtf8Base64(xml) }]
    };

    const findByNameAndVersion = vi
      .fn()
      .mockReturnValueOnce(of(null))
      .mockReturnValueOnce(of(library));

    const injector = Injector.create({
      providers: [
        CqlModelInfoService,
        {
          provide: LibraryService,
          useValue: { findByNameAndVersion }
        },
        {
          provide: EnvironmentService,
          useValue: {
            getEffectiveAddressForRole: () => 'http://content/fhir'
          }
        }
      ]
    });

    const service = runInInjectionContext(injector, () => injector.get(CqlModelInfoService));
    service.setCachedXml('System', null, '<modelInfo name="System" version="1.0.0"/>');
    service.setCachedXml('FHIR', '4.0.1', '<modelInfo name="FHIR" version="4.0.1"/>');

    const { missing } = await service.prefetchForCql(`using QICore version '6.0.0'`);
    expect(missing).toEqual([]);
    expect(service.lookupXml('QICore', '6.0.0')).toContain('QICore');
    expect(findByNameAndVersion).toHaveBeenNthCalledWith(1, 'QICore', '6.0.0', true, 'model-definition');
    expect(findByNameAndVersion).toHaveBeenNthCalledWith(2, 'QICore', '6.0.0', false, 'model-definition');
  });

  it('reports missing ModelInfo when content and evaluation miss', async () => {
    const findByNameAndVersion = vi.fn().mockReturnValue(of(null));
    const injector = Injector.create({
      providers: [
        CqlModelInfoService,
        { provide: LibraryService, useValue: { findByNameAndVersion } },
        {
          provide: EnvironmentService,
          useValue: { getEffectiveAddressForRole: () => 'http://content/fhir' }
        }
      ]
    });
    const service = runInInjectionContext(injector, () => injector.get(CqlModelInfoService));
    service.setCachedXml('System', null, '<modelInfo name="System" version="1.0.0"/>');
    service.setCachedXml('FHIR', '4.0.1', '<modelInfo name="FHIR" version="4.0.1"/>');

    const { missing } = await service.prefetchForCql(`using USQualityCore version '0.5.0'`);
    expect(missing).toEqual([{ name: 'USQualityCore', version: '0.5.0' }]);
    expect(service.lookupXml('USQualityCore', '0.5.0')).toBeNull();
  });

  it('clears non-bundled cache when content address changes', async () => {
    let address = 'http://content/a';
    const findByNameAndVersion = vi.fn().mockReturnValue(of(null));
    const injector = Injector.create({
      providers: [
        CqlModelInfoService,
        { provide: LibraryService, useValue: { findByNameAndVersion } },
        {
          provide: EnvironmentService,
          useValue: { getEffectiveAddressForRole: () => address }
        }
      ]
    });
    const service = runInInjectionContext(injector, () => injector.get(CqlModelInfoService));
    service.setCachedXml('System', null, '<system/>');
    service.setCachedXml('FHIR', '4.0.1', '<fhir/>');
    service.setCachedXml('QICore', '6.0.0', '<qicore/>');
    await service.prefetchForCql(`using FHIR version '4.0.1'`);

    address = 'http://content/b';
    await service.prefetchForCql(`using FHIR version '4.0.1'`);
    expect(service.lookupXml('QICore', '6.0.0')).toBeNull();
    expect(service.lookupXml('FHIR', '4.0.1')).toBe('<fhir/>');
  });
});
