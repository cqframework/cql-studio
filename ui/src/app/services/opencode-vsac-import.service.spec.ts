// Author: Preston Lee

import { Injector, runInInjectionContext } from '@angular/core';
import type { Bundle, ValueSet } from 'fhir/r4';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { SettingsService } from './settings.service';
import { TerminologyService } from './terminology.service';
import { VsacService } from './vsac.service';
import {
  extractVsacCanonicalUrls,
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
    expect(terminologyExpand).toHaveBeenCalledWith({ url: canonical, count: 1 });
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

    const result = await service.importForCql(`valueset "Diabetes": '${canonical}'`);

    expect(result.imported).toBe(1);
    const posted = terminologyPost.mock.calls[0]?.[0] as Bundle;
    expect(posted.entry?.[0]?.resource).toMatchObject({ url: canonical, expansion: { total: 1 } });
  });

  it('refuses to import into an NLM endpoint', async () => {
    const service = serviceWith({
      terminologySearch: vi.fn(),
      terminologyUrl: 'https://cts.nlm.nih.gov/fhir',
    });
    await expect(service.importForCql(`valueset "Diabetes": '${canonical}'`))
      .rejects.toThrow(/read-only/);
  });
});
