// Author: Preston Lee

import { describe, expect, it } from 'vitest';
import { CmsMeasureSummary } from './cms-measure-catalog.lib';
import {
  describeVsacImportActivity,
  formatCmsMeasureLabel,
  importProgressForLibrary,
  importProgressForMeasures,
} from './cms-import-progress';

function measure(cmsId: string, libraryUrl: string): CmsMeasureSummary {
  return {
    sourceId: 'cms-2025-au',
    sourceLabel: '2025 AU',
    path: `input/resources/measure/${cmsId}.json`,
    id: cmsId,
    url: `http://example.org/Measure/${cmsId}`,
    title: `${cmsId} title`,
    name: cmsId,
    cmsId,
    version: '1.0.0',
    description: '',
    status: 'active',
    publisher: 'CMS',
    libraries: [libraryUrl],
  };
}

describe('cms import progress', () => {
  it('formats a measure label from the CMS id and title', () => {
    expect(formatCmsMeasureLabel({ cmsId: 'CMS125', title: 'Breast Cancer Screening' })).toBe(
      'CMS125 · Breast Cancer Screening'
    );
  });

  it('names the single owning measure for a library step', () => {
    const selected = [
      measure('CMS125', 'http://example.org/Library/BreastCancerScreening'),
      measure('CMS130', 'http://example.org/Library/ColorectalCancerScreening'),
    ];

    const progress = importProgressForLibrary(
      { name: 'BreastCancerScreening', url: 'http://example.org/Library/BreastCancerScreening' },
      selected,
      'Translation',
      'Translating BreastCancerScreening 1.0.0'
    );

    expect(progress).toEqual({
      measureKey: 'cms-2025-au:input/resources/measure/CMS125.json',
      measure: 'CMS125 · CMS125 title',
      index: 1,
      total: 2,
      stage: 'Translation',
      detail: 'Translating BreastCancerScreening 1.0.0',
    });
  });

  it('keeps a shared step on the selected measures without picking one row', () => {
    const selected = [
      measure('CMS125', 'http://example.org/Library/A'),
      measure('CMS130', 'http://example.org/Library/B'),
    ];

    const progress = importProgressForMeasures(selected, selected, 'ModelInfo', 'Loading USCore ModelInfo');

    expect(progress.measureKey).toBeNull();
    expect(progress.index).toBeNull();
    expect(progress.measure).toBe('CMS125, CMS130');
    expect(progress.stage).toBe('ModelInfo');
    expect(progress.detail).toBe('Loading USCore ModelInfo');
  });

  it('describes value set checks, expansions, and posts', () => {
    expect(
      describeVsacImportActivity({
        phase: 'expand',
        canonicalUrl: 'http://cts.nlm.nih.gov/fhir/ValueSet/2.16.840.1.113762.1.4.1',
        index: 3,
        total: 40,
        count: 0,
      })
    ).toBe('Expanding 2.16.840.1.113762.1.4.1 (3 of 40)');
    expect(
      describeVsacImportActivity({
        phase: 'post',
        canonicalUrl: '',
        index: 1,
        total: 2,
        count: 49,
      })
    ).toBe('Posting 49 value sets (batch 1 of 2)');
  });
});
