// Author: Preston Lee

import { Injector, runInInjectionContext } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { describe, expect, it, vi } from 'vitest';
import { CmsMeasuresImportService } from './cms-measures-import.service';
import { SettingsService } from './settings.service';

describe('CmsMeasuresImportService', () => {
  it('refuses to import when the evaluation FHIR server URL is missing', async () => {
    const service = runInInjectionContext(
      Injector.create({
        providers: [
          CmsMeasuresImportService,
          { provide: HttpClient, useValue: { post: vi.fn() } },
          {
            provide: SettingsService,
            useValue: {
              getEffectiveEvaluationServerUrl: () => '   ',
              getEndpointHttpContext: vi.fn(),
              getActiveEnvironment: vi.fn(),
            },
          },
        ],
      }),
      () => new CmsMeasuresImportService()
    );

    await expect(service.importResources([])).rejects.toThrow(/evaluation FHIR server URL/i);
    expect(service.evaluationServerConfigured()).toBe(false);
  });
});
