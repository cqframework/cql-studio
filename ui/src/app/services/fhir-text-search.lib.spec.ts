// Author: Preston Lee

import {
  buildTextSearchParams,
  resolveBestTextSearchParam
} from './fhir-text-search.lib';

describe('fhir-text-search.lib', () => {
  describe('resolveBestTextSearchParam', () => {
    it('always uses title:contains for Library', () => {
      const resolved = resolveBestTextSearchParam('Library', [
        { name: 'title', type: 'string' },
        { name: '_content', type: 'string' },
        { name: '_text', type: 'string' }
      ]);
      expect(resolved?.param).toBe('title:contains');
    });

    it('prefers _content when advertised for non-Library types', () => {
      const resolved = resolveBestTextSearchParam('Measure', [
        { name: 'title', type: 'string' },
        { name: '_content', type: 'string' },
        { name: '_text', type: 'string' }
      ]);
      expect(resolved?.param).toBe('_content');
    });

    it('prefers _text when _content is absent for non-Library types', () => {
      const resolved = resolveBestTextSearchParam('Measure', [
        { name: 'title', type: 'string' },
        { name: '_text', type: 'string' }
      ]);
      expect(resolved?.param).toBe('_text');
    });

    it('uses name:contains for Patient', () => {
      const resolved = resolveBestTextSearchParam('Patient', [
        { name: 'name', type: 'string' },
        { name: 'identifier', type: 'token' }
      ]);
      expect(resolved?.param).toBe('name:contains');
    });

    it('falls back to conventional Patient name search without capability', () => {
      const resolved = resolveBestTextSearchParam('Patient', []);
      expect(resolved?.param).toBe('name:contains');
    });

    it('falls back to title:contains for knowledge resources without capability', () => {
      const resolved = resolveBestTextSearchParam('Measure', undefined);
      expect(resolved?.param).toBe('title:contains');
    });

    it('does not apply :contains to token fields', () => {
      const resolved = resolveBestTextSearchParam('Bundle', [
        { name: 'type', type: 'token' }
      ]);
      expect(resolved?.param).toBe('type');
    });

    it('returns null when capability lists no usable string params', () => {
      const resolved = resolveBestTextSearchParam('Observation', [
        { name: 'date', type: 'date' },
        { name: 'patient', type: 'reference' }
      ]);
      expect(resolved).toBeNull();
    });
  });

  describe('buildTextSearchParams', () => {
    it('returns empty object for blank query', () => {
      expect(buildTextSearchParams('Library', '  ', [{ name: '_text' }])).toEqual({});
    });

    it('maps query onto the resolved param', () => {
      expect(
        buildTextSearchParams('Library', 'diabetes', [
          { name: 'title', type: 'string' }
        ])
      ).toEqual({ 'title:contains': 'diabetes' });
    });
  });
});
