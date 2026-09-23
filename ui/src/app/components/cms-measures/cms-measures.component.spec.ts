// Author: Preston Lee

import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CmsMeasuresComponent } from './cms-measures.component';
import { CmsContentService } from '../../services/cms-content.service';
import { CmsMeasureSummary } from '../../services/cms-measure-catalog.lib';
import { CmsExecutionPrepService } from '../../services/cms-execution-prep.service';
import { CmsImportProgress } from '../../services/cms-import-progress';
import { CmsMeasuresImportService } from '../../services/cms-measures-import.service';
import { SettingsService } from '../../services/settings.service';

function summary(): CmsMeasureSummary {
  return {
    sourceId: 'cms-2025-au',
    sourceLabel: '2025 AU',
    path: 'input/resources/measure/Measure-1.json',
    id: 'measure-1',
    url: 'http://example.org/Measure/measure-1',
    title: 'Breast Cancer Screening',
    name: 'BreastCancerScreening',
    cmsId: 'CMS125',
    version: '1.0.0',
    description: 'Screening measure',
    status: 'active',
    publisher: 'CMS',
    libraries: [],
  };
}

describe('CmsMeasuresComponent', () => {
  let evaluationConfigured = true;
  let vsacConfigured = false;
  const listMeasures = vi.fn();
  const loadImportResources = vi.fn();
  const importGroups = vi.fn();

  beforeEach(() => {
    evaluationConfigured = true;
    vsacConfigured = false;
    listMeasures.mockReset();
    listMeasures.mockResolvedValue({ measures: [summary()], errors: [] });
    loadImportResources.mockReset();
    loadImportResources.mockResolvedValue({ resources: [], unresolved: [] });
    importGroups.mockReset();
    importGroups.mockResolvedValue([]);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: CmsContentService, useValue: { listMeasures, loadImportResources } },
        {
          provide: CmsMeasuresImportService,
          useValue: { evaluationServerConfigured: () => evaluationConfigured },
        },
        { provide: CmsExecutionPrepService, useValue: { importGroups } },
        { provide: SettingsService, useValue: { vsacHasApiCredentials: () => vsacConfigured } },
      ],
    });
  });

  function create(): CmsMeasuresComponent {
    return TestBed.runInInjectionContext(() => new CmsMeasuresComponent());
  }

  it('does not load an index while VSAC credentials are missing', () => {
    const component = create();
    expect(component['showCatalog']()).toBe(false);
    component['loadIndex']();
    expect(listMeasures).not.toHaveBeenCalled();
    expect(component['indexLoaded']()).toBe(false);
    expect(component['measures']()).toEqual([]);
  });

  it('loads only the selected source when Load Index is clicked', async () => {
    vsacConfigured = true;
    const component = create();
    expect(component['showCatalog']()).toBe(true);
    expect(component['indexLoaded']()).toBe(false);
    expect(component['sourceId']()).toBe('cms-2025-au');

    component['loadIndex']();
    await vi.waitFor(() => expect(component['indexLoaded']()).toBe(true));

    expect(listMeasures).toHaveBeenCalledTimes(1);
    expect(listMeasures.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ id: 'cms-2025-au' }));
    expect(component['visible']().map((row) => row.title)).toEqual(['Breast Cancer Screening']);
  });

  it('clears the loaded index when the source changes', async () => {
    vsacConfigured = true;
    const component = create();
    component['loadIndex']();
    await vi.waitFor(() => expect(component['indexLoaded']()).toBe(true));

    component['onSourceChange']('cms-2026-au');

    expect(component['sourceId']()).toBe('cms-2026-au');
    expect(component['indexLoaded']()).toBe(false);
    expect(component['measures']()).toEqual([]);
    expect(listMeasures).toHaveBeenCalledTimes(1);
  });

  it('reports the current measure, stage, and activity while importing', async () => {
    vsacConfigured = true;
    const component = create();
    component['loadIndex']();
    await vi.waitFor(() => expect(component['indexLoaded']()).toBe(true));
    component['toggleRow'](component['measures']()[0], true);

    let releaseImport: (value: []) => void = () => undefined;
    importGroups.mockImplementation(async (_groups: unknown, onProgress: (status: CmsImportProgress) => void) => {
      onProgress({
        measureKey: 'cms-2025-au:input/resources/measure/Measure-1.json',
        measure: 'CMS125 · Breast Cancer Screening',
        index: 1,
        total: 1,
        stage: 'Value sets',
        detail: 'Expanding 2.16.840.1.113762.1.4.1 (2 of 40)',
      });
      return new Promise((resolve) => {
        releaseImport = resolve;
      });
    });

    const pending = component['importSelected']();
    await vi.waitFor(() => expect(component['importStatus']()?.stage).toBe('Value sets'));

    expect(component['importing']()).toBe(true);
    expect(component['importStatus']()).toMatchObject({
      measure: 'CMS125 · Breast Cancer Screening',
      stage: 'Value sets',
      detail: 'Expanding 2.16.840.1.113762.1.4.1 (2 of 40)',
    });
    expect(component['isCurrentImport'](component['measures']()[0])).toBe(true);

    releaseImport([]);
    await pending;
    expect(component['importing']()).toBe(false);
    expect(component['importStatus']()).toBeNull();
  });
});
