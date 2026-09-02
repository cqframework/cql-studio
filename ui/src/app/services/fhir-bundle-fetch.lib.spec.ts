// Author: Preston Lee

import { describe, expect, test, vi } from 'vitest';
import type { Bundle } from 'fhir/r4';
import { fetchAllBundlePages } from './fhir-bundle-fetch.lib';

describe('fhir-bundle-fetch.lib', () => {
  test('fetchAllBundlePages follows next links and dedupes entries', async () => {
    const page1: Bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      entry: [{ resource: { resourceType: 'Observation', id: 'o1' } }],
      link: [{ relation: 'next', url: 'http://example.org/Observation?page=2' }],
    };
    const page2: Bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      entry: [
        { resource: { resourceType: 'Observation', id: 'o1' } },
        { resource: { resourceType: 'Observation', id: 'o2' } },
      ],
    };
    const fetchPage = vi.fn(async (url: string) => {
      expect(url).toBe('http://example.org/Observation?page=2');
      return page2;
    });
    const merged = await fetchAllBundlePages(page1, fetchPage);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(merged.entry?.length).toBe(2);
  });
});
