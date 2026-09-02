// Author: Preston Lee

import { Injector, runInInjectionContext } from '@angular/core';
import { Bundle, Patient, Resource } from 'fhir/r4';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { FhirPackageImportService } from './fhir-package-import.service';
import { TerminologyService } from './terminology.service';
import { FhirClientService } from './fhir-client.service';
import { SettingsService } from './settings.service';

function withFilename<T extends Resource>(resource: T, filename: string): T {
  return Object.assign(resource, { __filename: filename });
}

function createService(opts: {
  termPost: ReturnType<typeof vi.fn>;
  dataPost: ReturnType<typeof vi.fn>;
  termUrl?: string;
  dataUrl?: string;
}): FhirPackageImportService {
  const injector = Injector.create({
    providers: [
      FhirPackageImportService,
      { provide: TerminologyService, useValue: { postBundle: opts.termPost } },
      { provide: FhirClientService, useValue: { postBundle: opts.dataPost } },
      {
        provide: SettingsService,
        useValue: {
          getEffectiveTerminologyEndpointAddress: () => opts.termUrl ?? 'http://localhost/fhir',
          getEffectiveDataEndpointAddress: () => opts.dataUrl ?? 'http://localhost/fhir'
        }
      }
    ]
  });
  return runInInjectionContext(injector, () => injector.get(FhirPackageImportService));
}

function okResponseForPostedBundle(bundle: Bundle): Bundle {
  return {
    resourceType: 'Bundle',
    type: 'transaction-response',
    entry: (bundle.entry ?? []).map(() => ({ response: { status: '201 Created' } }))
  };
}

describe('FhirPackageImportService executable Bundles', () => {
  it('posts wrapping transaction then executable transaction Bundle', async () => {
    const dataPost = vi.fn((bundle: Bundle) => of(okResponseForPostedBundle(bundle)));
    const termPost = vi.fn();
    const service = createService({ termPost, dataPost, termUrl: 'http://localhost/term', dataUrl: 'http://localhost/data' });

    const patient = withFilename(
      { resourceType: 'Patient', id: 'p1' } as Patient,
      'package/Patient-p1.json'
    );
    const tx = withFilename(
      {
        resourceType: 'Bundle',
        type: 'transaction',
        id: 'tx1',
        entry: [{ resource: { resourceType: 'Observation', id: 'o1' } }]
      } as Bundle,
      'package/Bundle-tx.json'
    );

    const outcomes = await service.importTerminologyAndData([], [patient, tx], () => undefined);

    expect(termPost).not.toHaveBeenCalled();
    expect(dataPost).toHaveBeenCalledTimes(2);

    const wrapping = dataPost.mock.calls[0]?.[0] as Bundle;
    expect(wrapping.type).toBe('transaction');
    expect(wrapping.entry?.map((e) => e.resource?.resourceType)).toEqual(['Patient']);

    const executable = dataPost.mock.calls[1]?.[0] as Bundle;
    expect(executable.type).toBe('transaction');
    expect(executable.entry?.[0]?.request).toEqual({ method: 'PUT', url: 'Observation/o1' });
    expect((executable as { __filename?: string }).__filename).toBeUndefined();

    expect(outcomes.map((o) => o.filename)).toEqual(['package/Patient-p1.json', 'package/Bundle-tx.json']);
    expect(outcomes[1]?.ok).toBe(true);
    expect(outcomes[1]?.message).toBe('Posted transaction (1 entries):\n201 Created');
  });

  it('skips searchset Bundles without posting them', async () => {
    const dataPost = vi.fn((bundle: Bundle) => of(okResponseForPostedBundle(bundle)));
    const service = createService({
      termPost: vi.fn(),
      dataPost,
      termUrl: 'http://localhost/term',
      dataUrl: 'http://localhost/data'
    });

    const searchset = withFilename(
      {
        resourceType: 'Bundle',
        type: 'searchset',
        entry: [{ resource: { resourceType: 'Patient', id: 'p1' } }]
      } as Bundle,
      'package/Bundle-ss.json'
    );

    const outcomes = await service.importTerminologyAndData([], [searchset], () => undefined);
    expect(dataPost).not.toHaveBeenCalled();
    expect(outcomes[0]?.ok).toBe(true);
    expect(outcomes[0]?.message).toContain('searchset');
  });

  it('fills missing entry.request on transaction Bundles before POST', async () => {
    const dataPost = vi.fn((bundle: Bundle) => of(okResponseForPostedBundle(bundle)));
    const service = createService({
      termPost: vi.fn(),
      dataPost,
      termUrl: 'http://localhost/term',
      dataUrl: 'http://localhost/data'
    });

    const tx = withFilename(
      {
        resourceType: 'Bundle',
        type: 'transaction',
        entry: [{ resource: { resourceType: 'Patient', id: 'abc' } }]
      } as Bundle,
      'package/Bundle-noreq.json'
    );

    await service.importTerminologyAndData([], [tx], () => undefined);
    expect(dataPost).toHaveBeenCalledTimes(1);
    const posted = dataPost.mock.calls[0]?.[0] as Bundle;
    expect(posted.entry?.[0]?.request?.method).toBe('PUT');
    expect(posted.entry?.[0]?.request?.url).toBe('Patient/abc');
  });

  it('posts a dual-target executable Bundle once on the merged channel', async () => {
    const termPost = vi.fn((bundle: Bundle) => of(okResponseForPostedBundle(bundle)));
    const dataPost = vi.fn();
    const service = createService({
      termPost,
      dataPost,
      termUrl: 'http://localhost/fhir',
      dataUrl: 'http://localhost/fhir'
    });

    const tx = withFilename(
      {
        resourceType: 'Bundle',
        type: 'transaction',
        entry: [{ resource: { resourceType: 'Patient', id: 'p1' } }]
      } as Bundle,
      'package/Bundle-dual.json'
    );

    await service.importTerminologyAndData([tx], [tx], () => undefined);
    expect(termPost).toHaveBeenCalledTimes(1);
    expect(dataPost).not.toHaveBeenCalled();
    const posted = termPost.mock.calls[0]?.[0] as Bundle;
    expect(posted.type).toBe('transaction');
    expect(posted.entry?.length).toBe(1);
  });

  it('keeps batch Bundles as type batch', async () => {
    const dataPost = vi.fn((bundle: Bundle) => of(okResponseForPostedBundle(bundle)));
    const service = createService({
      termPost: vi.fn(),
      dataPost,
      termUrl: 'http://localhost/term',
      dataUrl: 'http://localhost/data'
    });

    const batch = withFilename(
      {
        resourceType: 'Bundle',
        type: 'batch',
        entry: [{ resource: { resourceType: 'Patient', id: 'p1' } }]
      } as Bundle,
      'package/Bundle-batch.json'
    );

    const outcomes = await service.importTerminologyAndData([], [batch], () => undefined);
    const posted = dataPost.mock.calls[0]?.[0] as Bundle;
    expect(posted.type).toBe('batch');
    expect(outcomes[0]?.message).toContain('Posted batch');
  });

  it('leaves existing entry.request unchanged', async () => {
    const dataPost = vi.fn((bundle: Bundle) => of(okResponseForPostedBundle(bundle)));
    const service = createService({
      termPost: vi.fn(),
      dataPost,
      termUrl: 'http://localhost/term',
      dataUrl: 'http://localhost/data'
    });

    const tx = withFilename(
      {
        resourceType: 'Bundle',
        type: 'transaction',
        entry: [
          {
            resource: { resourceType: 'Patient', id: 'p1' },
            request: { method: 'DELETE', url: 'Patient/p1' }
          }
        ]
      } as Bundle,
      'package/Bundle-delete.json'
    );

    await service.importTerminologyAndData([], [tx], () => undefined);
    const posted = dataPost.mock.calls[0]?.[0] as Bundle;
    expect(posted.entry?.[0]?.request).toEqual({ method: 'DELETE', url: 'Patient/p1' });
  });

  it('posts executable Bundles after a wrapping transaction HTTP failure', async () => {
    const dataPost = vi.fn((bundle: Bundle) => {
      if (bundle.entry?.some((e) => e.resource?.resourceType === 'Patient')) {
        return throwError(() => new Error('wrap failed'));
      }
      return of(okResponseForPostedBundle(bundle));
    });
    const service = createService({
      termPost: vi.fn(),
      dataPost,
      termUrl: 'http://localhost/term',
      dataUrl: 'http://localhost/data'
    });

    const patient = withFilename(
      { resourceType: 'Patient', id: 'p1' } as Patient,
      'package/Patient-p1.json'
    );
    const tx = withFilename(
      {
        resourceType: 'Bundle',
        type: 'transaction',
        entry: [{ resource: { resourceType: 'Observation', id: 'o1' } }]
      } as Bundle,
      'package/Bundle-tx.json'
    );

    const outcomes = await service.importTerminologyAndData([], [patient, tx], () => undefined);
    expect(dataPost).toHaveBeenCalledTimes(2);
    expect(outcomes[0]?.ok).toBe(false);
    expect(outcomes[0]?.message).toBe('wrap failed');
    expect(outcomes[1]?.ok).toBe(true);
    expect(outcomes[1]?.filename).toBe('package/Bundle-tx.json');
  });
});
