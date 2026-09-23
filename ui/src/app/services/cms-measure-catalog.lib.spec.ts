// Author: Preston Lee

import { Library, Measure } from 'fhir/r4';
import { describe, expect, it } from 'vitest';
import { encodeUtf8Base64 } from './utf8-encoding.lib';
import { CMS_CONTENT_SOURCES } from './cms-content-sources';
import {
  filterCmsMeasures,
  libraryDependencyRefs,
  matchLibraryPath,
  parseCmsMeasureSummary,
  resourceDedupeKey,
} from './cms-measure-catalog.lib';

const source = CMS_CONTENT_SOURCES[0];

const libraryFiles = [
  { name: 'USQualityCoreCommon.json', path: 'input/resources/library/USQualityCoreCommon.json', type: 'file' },
  { name: 'Hospice.json', path: 'input/resources/library/Hospice.json', type: 'file' },
  { name: '.gitkeep', path: 'input/resources/library/.gitkeep', type: 'file' },
];

describe('parseCmsMeasureSummary', () => {
  it('indexes CMS identifier, title, and library canonicals', () => {
    const measure: Measure = {
      resourceType: 'Measure',
      id: 'CMS125FHIRBreastCancerScreen',
      url: 'https://madie.cms.gov/Measure/CMS125FHIRBreastCancerScreen',
      name: 'CMS125FHIRBreastCancerScreen',
      title: 'Breast Cancer Screening',
      version: '1.1.000',
      status: 'active',
      publisher: 'CMS',
      description: 'Percentage of women screened.',
      identifier: [
        {
          system: 'https://madie.cms.gov/measure/shortName',
          value: 'CMS125FHIR',
        },
        {
          system: 'https://madie.cms.gov/measure/cmsId',
          value: '125FHIR',
        },
      ],
      library: ['https://madie.cms.gov/Library/CMS125FHIRBreastCancerScreen'],
    };
    const summary = parseCmsMeasureSummary(
      measure,
      source,
      'input/resources/measure/CMS125FHIRBreastCancerScreen.json'
    );
    expect(summary?.cmsId).toBe('125FHIR');
    expect(summary?.title).toBe('Breast Cancer Screening');
    expect(summary?.libraries).toEqual([
      'https://madie.cms.gov/Library/CMS125FHIRBreastCancerScreen',
    ]);
    expect(summary?.sourceId).toBe('cms-2025-au');
  });

  it('returns null for non-measure resources', () => {
    expect(
      parseCmsMeasureSummary(
        { resourceType: 'Library', id: 'x' } as unknown as Measure,
        source,
        'input/resources/measure/x.json'
      )
    ).toBeNull();
  });
});

describe('filterCmsMeasures', () => {
  const rows = [
    {
      sourceId: 'cms-2025-au',
      sourceLabel: '2025 AU',
      path: 'a.json',
      id: 'a',
      url: '',
      title: 'Breast Cancer Screening',
      name: 'CMS125',
      cmsId: '125FHIR',
      version: '1',
      description: 'mammography',
      status: 'active',
      publisher: 'CMS',
      libraries: [],
    },
    {
      sourceId: 'cms-2026-au',
      sourceLabel: '2026 AU',
      path: 'b.json',
      id: 'b',
      url: '',
      title: 'CAUTI Rate Example',
      name: 'CAUTI',
      cmsId: '',
      version: '0',
      description: 'draft example',
      status: 'draft',
      publisher: 'CMS',
      libraries: [],
    },
  ];

  it('filters by text, source, and status', () => {
    expect(filterCmsMeasures(rows, { text: '125', sourceId: '', status: '' })).toHaveLength(1);
    expect(filterCmsMeasures(rows, { text: '', sourceId: 'cms-2026-au', status: '' })[0]?.title).toBe(
      'CAUTI Rate Example'
    );
    expect(filterCmsMeasures(rows, { text: 'cauti', sourceId: '', status: 'active' })).toHaveLength(0);
  });
});

describe('library closure matching', () => {
  it('matches a canonical tail and Library- prefixed file', () => {
    expect(
      matchLibraryPath('https://madie.cms.gov/Library/Hospice|0.1.0', libraryFiles)
    ).toBe('input/resources/library/Hospice.json');
    expect(
      matchLibraryPath('Shared', [
        { name: 'Library-Shared.json', path: 'input/resources/library/Library-Shared.json', type: 'file' },
      ])
    ).toBe('input/resources/library/Library-Shared.json');
    expect(matchLibraryPath('https://example.org/Library/Missing', libraryFiles)).toBeNull();
  });

  it('walks relatedArtifact and CQL includes that resolve in the repo', () => {
    const library: Library = {
      resourceType: 'Library',
      id: 'CMS125FHIRBreastCancerScreen',
      relatedArtifact: [
        {
          type: 'depends-on',
          resource: 'https://madie.cms.gov/Library/USQualityCoreCommon|0.1.0-cibuild',
        },
        {
          type: 'depends-on',
          resource: 'https://example.org/Library/FHIRHelpers|4.0.1',
        },
      ],
      content: [
        {
          contentType: 'text/cql',
          data: encodeUtf8Base64(
            "include Hospice version '0.1.0-cibuild'\ninclude FHIRHelpers version '4.0.1'\n"
          ),
        },
      ],
    };
    expect(libraryDependencyRefs(library, libraryFiles)).toEqual([
      'https://madie.cms.gov/Library/USQualityCoreCommon|0.1.0-cibuild',
      'Hospice',
    ]);
  });

  it('dedupes by resource type and id', () => {
    expect(resourceDedupeKey({ resourceType: 'Library', id: 'Hospice', url: 'http://x' })).toBe(
      'Library/Hospice'
    );
    expect(resourceDedupeKey({ resourceType: 'Library', url: 'http://x/Library/Hospice' })).toBe(
      'http://x/Library/Hospice'
    );
  });
});
