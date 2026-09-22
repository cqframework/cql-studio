// Author: Preston Lee

import { Injector, runInInjectionContext } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Bundle, Library, Patient, Resource, ValueSet } from 'fhir/r4';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import {
  ExportPublishService,
  ExportPublishTarget
} from './export-publish.service';

function createService(httpPost: ReturnType<typeof vi.fn>): ExportPublishService {
  const injector = Injector.create({
    providers: [
      ExportPublishService,
      { provide: HttpClient, useValue: { post: httpPost } }
    ]
  });
  return runInInjectionContext(injector, () => injector.get(ExportPublishService));
}

function okResponse(bundle: Bundle): Bundle {
  return {
    resourceType: 'Bundle',
    type: 'transaction-response',
    entry: (bundle.entry ?? []).map(() => ({ response: { status: '201 Created' } }))
  };
}

function target(opts: {
  data?: string;
  terminology?: string;
  content?: string;
}): ExportPublishTarget {
  return {
    data: { address: opts.data ?? '', headers: {} },
    terminology: { address: opts.terminology ?? '', headers: {} },
    content: { address: opts.content ?? '', headers: {} }
  };
}

describe('ExportPublishService', () => {
  it('partitions Library to content, ValueSet to terminology, Patient to data', () => {
    const service = createService(vi.fn());
    const library = { resourceType: 'Library', id: 'lib1' } as Library;
    const vs = { resourceType: 'ValueSet', id: 'vs1' } as ValueSet;
    const patient = { resourceType: 'Patient', id: 'p1' } as Patient;

    const partition = service.partitionResources([library, vs, patient]);

    expect(partition.contentRes).toEqual([library]);
    expect(partition.termRes).toEqual([vs]);
    expect(partition.dataRes).toEqual([patient]);
  });

  it('posts Libraries to the content endpoint base URL', async () => {
    const httpPost = vi.fn((_url: string, bundle: Bundle) => of(okResponse(bundle)));
    const service = createService(httpPost);
    const library = { resourceType: 'Library', id: 'lib1' } as Library;

    const outcomes = await service.publishResources(
      [library],
      target({
        content: 'https://server.fire.ly/administration',
        data: 'https://server.fire.ly/R4',
        terminology: 'https://server.fire.ly/administration'
      })
    );

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.success).toBe(true);
    expect(outcomes[0]?.channel).toBe('content');
    expect(httpPost).toHaveBeenCalledTimes(1);
    expect(httpPost.mock.calls[0]?.[0]).toBe('https://server.fire.ly/administration');
    const posted = httpPost.mock.calls[0]?.[1] as Bundle;
    expect(posted.entry?.[0]?.resource).toMatchObject({ resourceType: 'Library', id: 'lib1' });
  });

  it('does not post Libraries to the data endpoint when content differs', async () => {
    const httpPost = vi.fn((_url: string, bundle: Bundle) => of(okResponse(bundle)));
    const service = createService(httpPost);
    const library = { resourceType: 'Library', id: 'lib1' } as Library;

    await service.publishResources(
      [library],
      target({
        content: 'https://example.org/content',
        data: 'https://example.org/data',
        terminology: 'https://example.org/term'
      })
    );

    const urls = httpPost.mock.calls.map((c) => c[0] as string);
    expect(urls).toEqual(['https://example.org/content']);
    expect(urls).not.toContain('https://example.org/data');
  });

  it('posts Library and ValueSet as one merged transaction when content and terminology share a base', async () => {
    const httpPost = vi.fn((_url: string, bundle: Bundle) => of(okResponse(bundle)));
    const service = createService(httpPost);
    const library = { resourceType: 'Library', id: 'lib1' } as Library;
    const vs = { resourceType: 'ValueSet', id: 'vs1' } as ValueSet;

    const outcomes = await service.publishResources(
      [library, vs],
      target({
        content: 'https://server.fire.ly/administration',
        terminology: 'https://server.fire.ly/administration',
        data: 'https://server.fire.ly/R4'
      })
    );

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.channel).toBe('merged');
    expect(httpPost).toHaveBeenCalledTimes(1);
    expect(httpPost.mock.calls[0]?.[0]).toBe('https://server.fire.ly/administration');
    const posted = httpPost.mock.calls[0]?.[1] as Bundle;
    const types = (posted.entry ?? []).map((e) => (e.resource as Resource).resourceType);
    expect(types).toEqual(['ValueSet', 'Library']);
  });

  it('keeps clinical data on the data endpoint when content differs', async () => {
    const httpPost = vi.fn((_url: string, bundle: Bundle) => of(okResponse(bundle)));
    const service = createService(httpPost);
    const library = { resourceType: 'Library', id: 'lib1' } as Library;
    const patient = { resourceType: 'Patient', id: 'p1' } as Patient;

    const outcomes = await service.publishResources(
      [library, patient],
      target({
        content: 'https://example.org/content',
        data: 'https://example.org/data',
        terminology: 'https://example.org/term'
      })
    );

    expect(outcomes).toHaveLength(2);
    expect(httpPost).toHaveBeenCalledTimes(2);
    const urls = httpPost.mock.calls.map((c) => c[0] as string).sort();
    expect(urls).toEqual(['https://example.org/content', 'https://example.org/data']);
  });

  it('preserves conditional-create Library entries when model-definition normalize assigns an id', async () => {
    const httpPost = vi.fn((_url: string, bundle: Bundle) => of(okResponse(bundle)));
    const service = createService(httpPost);
    // No id — normalizeModelDefinitionLibrary synthesizes one from name+version.
    const modelLib = {
      resourceType: 'Library',
      name: 'FHIR',
      version: '4.0.1',
      url: 'http://example.org/Library/FHIR-ModelInfo',
      type: {
        coding: [{ system: 'http://terminology.hl7.org/CodeSystem/library-type', code: 'model-definition' }]
      }
    } as Library;

    const bundle: Bundle = {
      resourceType: 'Bundle',
      type: 'transaction',
      entry: [
        {
          resource: modelLib,
          request: {
            method: 'POST',
            url: 'Library',
            ifNoneExist: `url=${encodeURIComponent(modelLib.url!)}&version=4.0.1`
          }
        }
      ]
    };

    const outcomes = await service.publishBundle(
      bundle,
      target({
        content: 'https://example.org/content',
        data: 'https://example.org/data',
        terminology: 'https://example.org/term'
      })
    );

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.success).toBe(true);
    expect(outcomes[0]?.channel).toBe('content');
    expect(httpPost).toHaveBeenCalledTimes(1);
    expect(httpPost.mock.calls[0]?.[0]).toBe('https://example.org/content');
    const posted = httpPost.mock.calls[0]?.[1] as Bundle;
    expect(posted.entry).toHaveLength(1);
    expect(posted.entry?.[0]?.request?.ifNoneExist).toContain('url=');
    expect((posted.entry?.[0]?.resource as Library).id).toBe('FHIR-ModelInfo-4.0.1');
  });
});
