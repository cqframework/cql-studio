// Author: Preston Lee

import '@angular/compiler';
import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, test, beforeEach, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import type { Bundle, Patient } from 'fhir/r4';
import { SqlOnFhirExecutionDataService } from './sql-on-fhir-execution-data.service';
import { mergeBundles, bundleHasClinicalResources, summarizeBundleResources } from './sql-on-fhir-execution-data.lib';
import cms125Bundle from '../../../../public/fhir/sql-on-fhir/cms125-bundle.json';

describe('sql-on-fhir-execution-data.service', () => {
  describe('mergeBundles and bundleHasClinicalResources', () => {
    test('mergeBundles deduplicates resources by type and id', () => {
      const a: Bundle = {
        resourceType: 'Bundle',
        type: 'searchset',
        entry: [{ resource: { resourceType: 'Patient', id: 'p1' } }],
      };
      const b: Bundle = {
        resourceType: 'Bundle',
        type: 'searchset',
        entry: [
          { resource: { resourceType: 'Patient', id: 'p1' } },
          { resource: { resourceType: 'Observation', id: 'o1' } },
        ],
      };
      const merged = mergeBundles([a, b]);
      expect(merged.entry?.length).toBe(2);
    });

    test('bundleHasClinicalResources detects patient data', () => {
      const bundle: Bundle = {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [{ resource: { resourceType: 'Patient', id: 'p1' } }],
      };
      expect(bundleHasClinicalResources(bundle)).toBe(true);
    });

    test('summarizeBundleResources counts patients and clinical types', () => {
      const merged = mergeBundles([
        {
          resourceType: 'Bundle',
          type: 'collection',
          entry: [
            { resource: { resourceType: 'Patient', id: 'p1' } },
            { resource: { resourceType: 'Encounter', id: 'e1' } },
          ],
        },
        {
          resourceType: 'Bundle',
          type: 'collection',
          entry: [
            { resource: { resourceType: 'Patient', id: 'p2' } },
            { resource: { resourceType: 'Observation', id: 'o1' } },
          ],
        },
      ]);
      const summary = summarizeBundleResources(merged);
      expect(summary.patientIds).toEqual(['p1', 'p2']);
      expect(summary.countsByType['Patient']).toBe(2);
      expect(summary.countsByType['Encounter']).toBe(1);
      expect(summary.countsByType['Observation']).toBe(1);
      expect(summary.totalResources).toBe(4);
    });
  });

  describe('buildBundleFromPatients', () => {
    let service: SqlOnFhirExecutionDataService;
    const patientService = {
      get: vi.fn(),
      getEverything: vi.fn(),
    };
    const fhirSearch = {
      search: vi.fn(),
      fetchFromUrl: vi.fn(),
    };

    function createService(): SqlOnFhirExecutionDataService {
      const instance = Object.create(SqlOnFhirExecutionDataService.prototype) as SqlOnFhirExecutionDataService;
      Object.assign(instance as object, { patientService, fhirSearch });
      return instance;
    }

    beforeEach(() => {
      vi.clearAllMocks();
      service = createService();
    });

    test('Patient-only fetch skips $everything', async () => {
      patientService.get.mockReturnValue(of({ resourceType: 'Patient', id: 'p1' }));
      const bundle = await service.buildBundleFromPatients([{ resourceType: 'Patient', id: 'p1' }], {
        resourceTypes: ['Patient'],
      });
      expect(patientService.getEverything).not.toHaveBeenCalled();
      expect(bundle.entry?.length).toBe(1);
      expect(bundle.entry?.[0]?.resource?.resourceType).toBe('Patient');
    });

    test('calls $everything with filtered _type for non-Patient types', async () => {
      patientService.get.mockReturnValue(of({ resourceType: 'Patient', id: 'p1' }));
      patientService.getEverything.mockReturnValue(
        of({
          resourceType: 'Bundle',
          type: 'searchset',
          entry: [{ resource: { resourceType: 'Encounter', id: 'e1' } }],
        }),
      );
      await service.buildBundleFromPatients([{ resourceType: 'Patient', id: 'p1' }], {
        resourceTypes: ['Patient', 'Encounter', 'Observation'],
      });
      expect(patientService.getEverything).toHaveBeenCalledWith('p1', {
        types: ['Encounter', 'Observation'],
      });
    });

    test('falls back to compartment search when $everything is unsupported', async () => {
      patientService.get.mockReturnValue(of({ resourceType: 'Patient', id: 'p1' }));
      patientService.getEverything.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 501 })),
      );
      fhirSearch.search.mockReturnValue(
        of({
          resourceType: 'Bundle',
          type: 'searchset',
          entry: [{ resource: { resourceType: 'Observation', id: 'o1' } }],
        }),
      );
      const bundle = await service.buildBundleFromPatients([{ resourceType: 'Patient', id: 'p1' }], {
        resourceTypes: ['Patient', 'Observation'],
      });
      expect(fhirSearch.search).toHaveBeenCalledWith(
        'Observation',
        { patient: 'Patient/p1' },
        expect.objectContaining({ count: 200 }),
      );
      const types = (bundle.entry ?? []).map(e => e.resource?.resourceType);
      expect(types).toContain('Patient');
      expect(types).toContain('Observation');
    });

    test('rethrows when $everything fails with a non-operation error', async () => {
      patientService.get.mockReturnValue(of({ resourceType: 'Patient', id: 'p1' }));
      patientService.getEverything.mockReturnValue(throwError(() => new Error('network down')));
      await expect(
        service.buildBundleFromPatients([{ resourceType: 'Patient', id: 'p1' }], {
          resourceTypes: ['Patient', 'Observation'],
        }),
      ).rejects.toThrow('network down');
      expect(fhirSearch.search).not.toHaveBeenCalled();
    });

    test('buildDataKeyFromPatients includes sorted patient ids and resource types', () => {
      expect(
        service.buildDataKeyFromPatients(
          [{ resourceType: 'Patient', id: 'b' }, { resourceType: 'Patient', id: 'a' }],
          ['Observation', 'Patient'],
        ),
      ).toBe('patients:a,b|types:Observation,Patient');
    });
  });

  describe('publishBundleToServer', () => {
    test('posts a transaction bundle to the FHIR server', async () => {
      const fhirClient = {
        getBaseUrl: vi.fn(() => 'http://localhost:8080/fhir'),
        postBundle: vi.fn(() => of({ resourceType: 'Bundle', type: 'transaction-response' })),
      };
      const instance = Object.create(SqlOnFhirExecutionDataService.prototype) as SqlOnFhirExecutionDataService;
      Object.assign(instance as object, { fhirClient });

      await instance.publishBundleToServer(cms125Bundle as Bundle);

      expect(fhirClient.postBundle).toHaveBeenCalledTimes(1);
      const posted = (fhirClient.postBundle as ReturnType<typeof vi.fn>).mock.calls[0][0] as Bundle;
      expect(posted.type).toBe('transaction');
      expect(posted.entry?.length).toBe(12);
    });

    test('throws when FHIR base URL is not configured', async () => {
      const fhirClient = {
        getBaseUrl: vi.fn(() => ''),
        postBundle: vi.fn(),
      };
      const instance = Object.create(SqlOnFhirExecutionDataService.prototype) as SqlOnFhirExecutionDataService;
      Object.assign(instance as object, { fhirClient });

      await expect(instance.publishBundleToServer(cms125Bundle as Bundle)).rejects.toThrow(
        /FHIR base URL is not configured/,
      );
      expect(fhirClient.postBundle).not.toHaveBeenCalled();
    });
  });
});
