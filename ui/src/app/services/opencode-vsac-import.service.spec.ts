// Author: Preston Lee

import { Injector, runInInjectionContext } from '@angular/core';
import type { Bundle, ValueSet } from 'fhir/r4';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { SettingsService } from './settings.service';
import { TerminologyService } from './terminology.service';
import { VsacService } from './vsac.service';
import {
  extractVsacCanonicalUrls,
  includedVsacValueSetUrls,
  isVsacCanonicalUrl,
  OpenCodeVsacImportService,
} from './opencode-vsac-import.service';

const canonical = 'http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113883.3.1';

function serviceWith(options: {
  terminologySearch: ReturnType<typeof vi.fn>;
  terminologyExpand?: ReturnType<typeof vi.fn>;
  terminologyPost?: ReturnType<typeof vi.fn>;
  vsacFetch?: ReturnType<typeof vi.fn>;
  vsacExpand?: ReturnType<typeof vi.fn>;
  terminologyUrl?: string;
  hasCredentials?: boolean;
}): OpenCodeVsacImportService {
  const injector = Injector.create({ providers: [
    OpenCodeVsacImportService,
    {
      provide: SettingsService,
      useValue: {
        getEffectiveTerminologyEndpointAddress: () => options.terminologyUrl ?? 'http://localhost:8080/fhir',
        vsacHasApiCredentials: () => options.hasCredentials ?? true,
      },
    },
    {
      provide: TerminologyService,
      useValue: {
        searchValueSets: options.terminologySearch,
        expandValueSet: options.terminologyExpand ?? vi.fn(),
        postBundle: options.terminologyPost ?? vi.fn(() => of({ resourceType: 'Bundle', type: 'transaction-response' })),
      },
    },
    {
      provide: VsacService,
      useValue: {
        fetchValueSetByOidOrCanonicalUrl: options.vsacFetch ?? vi.fn(),
        expandValueSetGet: options.vsacExpand ?? vi.fn(),
      },
    },
  ] });
  return runInInjectionContext(injector, () => injector.get(OpenCodeVsacImportService));
}

describe('OpenCode VSAC terminology import', () => {
  it('extracts only declared VSAC ValueSet canonicals', () => {
    const cql = [
      `valueset "Diabetes": '${canonical}'`,
      `codesystem "Not a ValueSet": 'http://cts.nlm.nih.gov/fhir/ValueSet/ignored'`,
      `// valueset "Commented": 'http://cts.nlm.nih.gov/fhir/ValueSet/commented'`,
      `valueset "External": 'https://example.org/fhir/ValueSet/external'`,
      `valueset "Duplicate": '${canonical}'`,
    ].join('\n');
    expect(extractVsacCanonicalUrls(cql)).toEqual([canonical]);
    expect(isVsacCanonicalUrl(canonical)).toBe(true);
    expect(isVsacCanonicalUrl('https://example.org/fhir/ValueSet/test')).toBe(false);
  });

  it('collects included VSAC ValueSets and drops canonical versions', () => {
    const child = 'http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113883.3.117.1.7.1.201';
    expect(includedVsacValueSetUrls({
      resourceType: 'ValueSet',
      status: 'active',
      compose: {
        include: [{ valueSet: [`${child}|2024`] }],
        exclude: [{ valueSet: ['http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113762.1.4.1110.61', 'https://example.org/fhir/ValueSet/other'] }],
      },
    })).toEqual([
      child,
      'http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113762.1.4.1110.61',
    ]);
  });

  it('skips an exact canonical already present on the terminology server', async () => {
    const existing: ValueSet = { resourceType: 'ValueSet', id: 'existing', url: canonical, title: 'Existing' };
    const terminologySearch = vi.fn(() => of({
      resourceType: 'Bundle', type: 'searchset', entry: [{ resource: existing }],
    } as Bundle));
    const vsacFetch = vi.fn();
    const terminologyExpand = vi.fn(() => of({
      ...existing,
      expansion: { timestamp: '2026-09-03T00:00:00Z', total: 1, contains: [{ code: '1' }] },
    }));
    const service = serviceWith({ terminologySearch, terminologyExpand, vsacFetch, hasCredentials: false });

    const result = await service.importForCql(`valueset "Existing": '${canonical}'`);

    expect(result.imported).toBe(0);
    expect(result.alreadyPresent).toBe(1);
    expect(terminologyExpand).toHaveBeenCalledWith({ id: 'existing', count: 1 });
    expect(vsacFetch).not.toHaveBeenCalled();
  });

  it('prefers an expandable sibling when duplicate canonicals exist', async () => {
    const broken: ValueSet = { resourceType: 'ValueSet', id: 'custom-id', url: canonical, title: 'Broken' };
    const good: ValueSet = {
      resourceType: 'ValueSet',
      id: '2.16.840.1.113883.3.1',
      url: canonical,
      title: 'Good',
      expansion: { timestamp: '2026-09-03T00:00:00Z', total: 2, contains: [{ code: '1' }, { code: '2' }] },
    };
    const vsacFetch = vi.fn();
    const terminologyExpand = vi.fn((params: { id?: string }) => {
      if (params.id === good.id) {
        return of({
          ...good,
          expansion: good.expansion,
        });
      }
      return throwError(() => new Error('HAPI-0889: Unknown ValueSet'));
    });
    const service = serviceWith({
      terminologySearch: vi.fn(() => of({
        resourceType: 'Bundle',
        type: 'searchset',
        entry: [{ resource: broken }, { resource: good }],
      } as Bundle)),
      terminologyExpand,
      vsacFetch,
      hasCredentials: false,
    });

    const result = await service.importCanonicalUrls([canonical]);

    expect(result.imported).toBe(0);
    expect(result.alreadyPresent).toBe(1);
    expect(result.items[0]?.title).toBe('Good');
    expect(terminologyExpand).toHaveBeenCalledWith({ id: 'custom-id', count: 1 });
    expect(terminologyExpand).toHaveBeenCalledWith({ id: good.id, count: 1 });
    expect(vsacFetch).not.toHaveBeenCalled();
  });

  it('expands by resource id when the search hit lacks an expansion', async () => {
    const existing: ValueSet = { resourceType: 'ValueSet', id: 'local-id', url: canonical, title: 'Local' };
    const terminologyExpand = vi.fn((params: { id?: string; url?: string }) => {
      if (params.id === 'local-id') {
        return of({
          ...existing,
          expansion: { timestamp: '2026-09-03T00:00:00Z', total: 1, contains: [{ code: '1' }] },
        });
      }
      return throwError(() => new Error('ambiguous url'));
    });
    const vsacFetch = vi.fn();
    const service = serviceWith({
      terminologySearch: vi.fn(() => of({
        resourceType: 'Bundle', type: 'searchset', entry: [{ resource: existing }],
      } as Bundle)),
      terminologyExpand,
      vsacFetch,
      hasCredentials: false,
    });

    const result = await service.importCanonicalUrls([canonical]);

    expect(result.imported).toBe(0);
    expect(result.alreadyPresent).toBe(1);
    expect(terminologyExpand).toHaveBeenCalledWith({ id: 'local-id', count: 1 });
    expect(vsacFetch).not.toHaveBeenCalled();
  });

  it('refreshes an existing ValueSet that the terminology server cannot expand', async () => {
    const existing: ValueSet = { resourceType: 'ValueSet', id: 'local-existing-id', url: canonical, title: 'Broken copy' };
    const terminologyPost = vi.fn(() => of({ resourceType: 'Bundle', type: 'transaction-response' } as Bundle));
    const definition: ValueSet = { resourceType: 'ValueSet', id: 'vsac-oid', url: canonical, title: 'Authoritative copy' };
    const expanded: ValueSet = {
      ...definition,
      expansion: { timestamp: '2026-09-03T00:00:00Z', total: 1, contains: [{ code: '1' }] },
    };
    const service = serviceWith({
      terminologySearch: vi.fn(() => of({
        resourceType: 'Bundle', type: 'searchset', entry: [{ resource: existing }],
      } as Bundle)),
      terminologyExpand: vi.fn(() => { throw new Error('not expandable'); }),
      terminologyPost,
      vsacFetch: vi.fn(() => of(definition)),
      vsacExpand: vi.fn(() => of(expanded)),
    });

    const result = await service.importForCql(`valueset "Diabetes": '${canonical}'`);

    expect(result.imported).toBe(1);
    const posted = terminologyPost.mock.calls[0]?.[0] as Bundle;
    expect(posted.entry?.[0]?.resource).toMatchObject({ id: 'local-existing-id', url: canonical });
  });

  it('imports an exact expanded VSAC ValueSet when it is missing', async () => {
    const terminologySearch = vi.fn(() => of({ resourceType: 'Bundle', type: 'searchset' } as Bundle));
    const terminologyPost = vi.fn(() => of({ resourceType: 'Bundle', type: 'transaction-response' } as Bundle));
    const definition: ValueSet = { resourceType: 'ValueSet', id: '2.16.840.1.113883.3.1', url: canonical, title: 'Diabetes' };
    const expanded: ValueSet = {
      ...definition,
      expansion: { timestamp: '2026-09-03T00:00:00Z', total: 1, contains: [{ system: 'http://snomed.info/sct', code: '1' }] },
    };
    const service = serviceWith({
      terminologySearch,
      terminologyPost,
      vsacFetch: vi.fn(() => of(definition)),
      vsacExpand: vi.fn(() => of(expanded)),
    });

    const result = await service.importCanonicalUrls([canonical]);

    expect(result.imported).toBe(1);
    const posted = terminologyPost.mock.calls[0]?.[0] as Bundle;
    expect(posted.entry?.[0]?.resource).toMatchObject({
      url: canonical,
      expansion: { total: 1 },
      compose: {
        include: [{ system: 'http://snomed.info/sct', concept: [{ code: '1' }] }],
      },
    });
  });

  it('reimports a grouping ValueSet when stored expansion cannot be expanded', async () => {
    const child = 'http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113883.3.117.1.7.1.201';
    const existing: ValueSet = {
      resourceType: 'ValueSet',
      id: '2.16.840.1.113762.1.4.1110.62',
      url: canonical,
      title: 'Grouping',
      compose: { include: [{ valueSet: [child] }] },
      expansion: {
        timestamp: '2026-09-22T00:00:00Z',
        total: 1,
        contains: [{ system: 'http://snomed.info/sct', code: '9', display: 'Stored' }],
      },
    };
    const definition: ValueSet = {
      resourceType: 'ValueSet',
      id: existing.id,
      url: canonical,
      title: 'Grouping',
      compose: existing.compose,
    };
    const grandchild = 'http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113762.1.4.1110.61';
    const childDefinition: ValueSet = {
      resourceType: 'ValueSet',
      id: '2.16.840.1.113883.3.117.1.7.1.201',
      url: child,
      title: 'Child',
      compose: { include: [{ valueSet: [grandchild] }] },
    };
    const grandchildDefinition: ValueSet = {
      resourceType: 'ValueSet',
      id: '2.16.840.1.113762.1.4.1110.61',
      url: grandchild,
      title: 'Grandchild',
    };
    const terminologyPost = vi.fn(() => of({ resourceType: 'Bundle', type: 'transaction-response' } as Bundle));
    const service = serviceWith({
      terminologySearch: vi.fn((params: { url?: string }) => of({
        resourceType: 'Bundle',
        type: 'searchset',
        entry: params.url === canonical ? [{ resource: existing }] : [],
      } as Bundle)),
      terminologyExpand: vi.fn(() => throwError(() => new Error('HAPI-0889: Unknown ValueSet'))),
      terminologyPost,
      vsacFetch: vi.fn((url: string) => {
        if (url === child) return of(childDefinition);
        if (url === grandchild) return of(grandchildDefinition);
        return of(definition);
      }),
      vsacExpand: vi.fn(() => of({
        resourceType: 'ValueSet',
        expansion: {
          timestamp: '2026-09-22T00:00:00Z',
          total: 1,
          contains: [{ system: 'http://snomed.info/sct', code: '9', display: 'Stored' }],
        },
      } as ValueSet)),
    });

    const postedUrls = () => terminologyPost.mock.calls.flatMap(call =>
      ((call[0] as Bundle).entry ?? []).map(entry => (entry.resource as ValueSet).url)
    );

    const batched = await service.importCanonicalUrlsBatched([canonical]);
    expect(batched.alreadyPresent).toBe(0);
    expect(batched.imported).toBe(3);
    expect(postedUrls().sort()).toEqual([canonical, child, grandchild].sort());
    const parent = (terminologyPost.mock.calls[0]?.[0] as Bundle).entry?.[0]?.resource as ValueSet;
    expect(parent.compose?.include?.some(include => include.valueSet?.length)).toBe(false);
    expect(parent.compose?.include?.[0]).toMatchObject({
      system: 'http://snomed.info/sct',
      concept: [{ code: '9', display: 'Stored' }],
    });

    terminologyPost.mockClear();
    const single = await service.importCanonicalUrls([canonical]);
    expect(single.imported).toBe(3);
    expect(postedUrls().sort()).toEqual([canonical, child, grandchild].sort());
  });

  it('does not revisit a ValueSet include cycle', async () => {
    const child = 'http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113883.3.117.1.7.1.201';
    const parent: ValueSet = {
      resourceType: 'ValueSet',
      id: 'parent',
      url: canonical,
      compose: { include: [{ valueSet: [child] }] },
    };
    const childDefinition: ValueSet = {
      resourceType: 'ValueSet',
      id: 'child',
      url: child,
      compose: { include: [{ valueSet: [canonical] }] },
    };
    const vsacFetch = vi.fn((url: string) => of(url === child ? childDefinition : parent));
    const service = serviceWith({
      terminologySearch: vi.fn(() => of({ resourceType: 'Bundle', type: 'searchset' } as Bundle)),
      terminologyPost: vi.fn(() => of({ resourceType: 'Bundle', type: 'transaction-response' } as Bundle)),
      vsacFetch,
      vsacExpand: vi.fn(() => of({
        resourceType: 'ValueSet',
        expansion: { timestamp: '2026-09-22T00:00:00Z', total: 0, contains: [] },
      } as ValueSet)),
    });

    const result = await service.importCanonicalUrlsBatched([canonical]);

    expect(result.imported).toBe(2);
    expect(vsacFetch).toHaveBeenCalledTimes(2);
  });

  it('treats a not-yet-preexpanded ValueSet as already present', async () => {
    const existing: ValueSet = {
      resourceType: 'ValueSet',
      id: 'local-id',
      url: canonical,
      title: 'Extensional',
      expansion: {
        timestamp: '2026-09-22T00:00:00Z',
        total: 124,
        contains: [{ system: 'http://snomed.info/sct', code: '1' }],
      },
    };
    const vsacFetch = vi.fn();
    const service = serviceWith({
      terminologySearch: vi.fn(() => of({
        resourceType: 'Bundle', type: 'searchset', entry: [{ resource: existing }],
      } as Bundle)),
      terminologyExpand: vi.fn(() => throwError(() => new Error(
        'HAPI-0831: Expansion of ValueSet produced too many codes (maximum 1)'
      ))),
      vsacFetch,
      hasCredentials: false,
    });

    const result = await service.importCanonicalUrls([canonical]);

    expect(result.imported).toBe(0);
    expect(result.alreadyPresent).toBe(1);
    expect(result.items[0]?.conceptCount).toBe(124);
    expect(vsacFetch).not.toHaveBeenCalled();
  });

  it('refuses to import into an NLM endpoint', async () => {
    const service = serviceWith({
      terminologySearch: vi.fn(() => of({ resourceType: 'Bundle', type: 'searchset' } as Bundle)),
      terminologyUrl: 'https://cts.nlm.nih.gov/fhir',
    });
    await expect(service.importForCql(`valueset "Diabetes": '${canonical}'`))
      .rejects.toThrow(/read-only/);
  });

  it('allows more than 50 VSAC references when all are already present', async () => {
    const urls = Array.from({ length: 51 }, (_, i) => `http://cts.nlm.nih.gov/fhir/ValueSet/present.${i}`);
    const terminologySearch = vi.fn((params: { url: string }) => {
      const existing: ValueSet = {
        resourceType: 'ValueSet',
        id: params.url.split('/').pop(),
        url: params.url,
        title: params.url,
        expansion: { timestamp: '2026-09-03T00:00:00Z', total: 0, contains: [] },
      };
      return of({ resourceType: 'Bundle', type: 'searchset', entry: [{ resource: existing }] } as Bundle);
    });
    const vsacFetch = vi.fn();
    const terminologyExpand = vi.fn((params: { id?: string }) => of({
      resourceType: 'ValueSet',
      id: params.id,
      expansion: { timestamp: '2026-09-03T00:00:00Z', total: 0, contains: [] },
    } as ValueSet));
    const service = serviceWith({ terminologySearch, terminologyExpand, vsacFetch, hasCredentials: false });
    const cql = urls.map((url, i) => `valueset "VS${i}": '${url}'`).join('\n');

    const result = await service.importForCql(cql);

    expect(result.imported).toBe(0);
    expect(result.alreadyPresent).toBe(51);
    expect(vsacFetch).not.toHaveBeenCalled();
  });

  it('rejects when more than 50 ValueSets still need importing', async () => {
    const urls = Array.from({ length: 51 }, (_, i) => `http://cts.nlm.nih.gov/fhir/ValueSet/missing.${i}`);
    const service = serviceWith({
      terminologySearch: vi.fn(() => of({ resourceType: 'Bundle', type: 'searchset' } as Bundle)),
    });
    const cql = urls.map((url, i) => `valueset "VS${i}": '${url}'`).join('\n');

    await expect(service.importForCql(cql)).rejects.toThrow(
      /Import requires 51 VSAC ValueSets.*at most 50/,
    );
  });

  it('batches more than 50 ValueSets and records a per-URL expansion failure', async () => {
    const urls = Array.from({ length: 51 }, (_, i) => `http://cts.nlm.nih.gov/fhir/ValueSet/missing.${i}`);
    const failing = urls[3];
    const terminologyPost = vi.fn(() => of({ resourceType: 'Bundle', type: 'transaction-response' } as Bundle));
    const service = serviceWith({
      terminologySearch: vi.fn(() => of({ resourceType: 'Bundle', type: 'searchset' } as Bundle)),
      terminologyPost,
      vsacFetch: vi.fn((url: string) => of({
        resourceType: 'ValueSet',
        id: url.endsWith('missing.3') ? 'bad' : `id-${url.split('.').pop()}`,
        url,
      } as ValueSet)),
      vsacExpand: vi.fn((id: string) => {
        if (id === 'bad') {
          return throwError(() => new Error('expand failed'));
        }
        return of({
          resourceType: 'ValueSet',
          id,
          expansion: { timestamp: '2026-09-22T00:00:00Z', total: 1, contains: [{ code: '1' }] },
        } as ValueSet);
      }),
    });

    const phases = new Set<string>();
    const result = await service.importCanonicalUrlsBatched(urls, (progress) => {
      phases.add(progress.phase);
      if (progress.phase === 'expand') {
        expect(progress.canonicalUrl).toContain('/ValueSet/');
        expect(progress.index).toBeGreaterThan(0);
        expect(progress.total).toBe(51);
      }
    });

    expect([...phases].sort()).toEqual(['check', 'expand', 'post']);
    expect(result.imported).toBe(50);
    expect(result.failures).toEqual([
      expect.objectContaining({ canonicalUrl: failing, message: expect.stringContaining('expand failed') }),
    ]);
    expect(terminologyPost).toHaveBeenCalledTimes(2);
    const sizes = terminologyPost.mock.calls.map((call) => (call[0] as Bundle).entry?.length);
    expect(sizes).toEqual([49, 1]);
  });

  it('pages a VSAC expansion that returns fewer concepts than its total', async () => {
    const terminologyPost = vi.fn(() => of({ resourceType: 'Bundle', type: 'transaction-response' } as Bundle));
    const definition: ValueSet = { resourceType: 'ValueSet', id: '2.16.840.1.113883.3.1', url: canonical, title: 'Paged' };
    const vsacExpand = vi.fn((_id: string, query: { offset?: number }) => {
      const offset = query.offset ?? 0;
      const page = offset === 0
        ? [{ code: 'a' }, { code: 'b' }]
        : [{ code: 'c' }];
      return of({
        resourceType: 'ValueSet',
        id: definition.id,
        expansion: { timestamp: '2026-09-22T00:00:00Z', total: 3, offset, contains: page },
      } as ValueSet);
    });
    const service = serviceWith({
      terminologySearch: vi.fn(() => of({ resourceType: 'Bundle', type: 'searchset' } as Bundle)),
      terminologyPost,
      vsacFetch: vi.fn(() => of(definition)),
      vsacExpand,
    });

    const result = await service.importCanonicalUrls([canonical]);

    expect(result.imported).toBe(1);
    expect(result.items[0]?.conceptCount).toBe(3);
    expect(vsacExpand).toHaveBeenCalledTimes(2);
    const posted = terminologyPost.mock.calls[0]?.[0] as Bundle;
    const resource = posted.entry?.[0]?.resource as ValueSet;
    expect(resource.expansion?.contains?.map(item => item.code)).toEqual(['a', 'b', 'c']);
  });
});
