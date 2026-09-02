// Author: Preston Lee

import { describe, expect, test } from 'vitest';
import { minimalLibrary } from '../../../testing/spec-helpers';
import {
  buildDefaultParameterValues,
  buildLibraryParameterSpecs,
  extractReferencedParameterNames,
  measurementPeriodFromValues,
} from './library-parameters.lib';

describe('library-parameters.lib', () => {
  const library = minimalLibrary({
    parameter: [
      {
        name: 'Measurement Period',
        use: 'in' as const,
        min: 1,
        max: '1',
        type: 'Period',
        extension: [
          {
            url: 'http://hl7.org/fhir/us/cqfmeasures/StructureDefinition/cqfm-defaultValue',
            valuePeriod: { start: '2024-01-01T00:00:00Z', end: '2024-12-31T23:59:59Z' },
          },
        ],
      },
    ],
  });

  const elmJson = JSON.stringify({
    library: {
      parameters: {
        def: [
          {
            name: 'Measurement Period',
            parameterTypeSpecifier: {
              type: 'IntervalTypeSpecifier',
              pointType: { type: 'NamedTypeSpecifier', name: '{urn:hl7-org:elm-types:r1}DateTime' },
            },
          },
        ],
      },
      statements: {
        def: [{ name: 'Initial Population', context: 'Patient', expression: { type: 'Null' } }],
      },
    },
  });

  test('extractReferencedParameterNames finds Measurement Period', () => {
    const json = '{"type":"ParameterRef","name":"Measurement Period"}';
    expect([...extractReferencedParameterNames(json)]).toEqual(['Measurement Period']);
  });

  test('buildLibraryParameterSpecs merges FHIR and ELM parameters', () => {
    const specs = buildLibraryParameterSpecs(library, elmJson);
    expect(specs.some(s => s.name === 'Measurement Period')).toBe(true);
    expect(specs.find(s => s.name === 'Measurement Period')?.valueKind).toBe('period');
  });

  test('buildDefaultParameterValues uses FHIR default period', () => {
    const specs = buildLibraryParameterSpecs(library, elmJson);
    const values = buildDefaultParameterValues(specs, library, elmJson);
    expect(values['Measurement Period']).toEqual({
      kind: 'period',
      start: '2024-01-01T00:00:00Z',
      end: '2024-12-31T23:59:59Z',
    });
  });

  test('measurementPeriodFromValues reads period parameter', () => {
    const period = measurementPeriodFromValues({
      'Measurement Period': {
        kind: 'period',
        start: '2023-06-01T00:00:00Z',
        end: '2023-12-31T23:59:59Z',
      },
    });
    expect(period.start).toContain('2023-06-01');
  });
});
