// Author: Preston Lee

import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { BUILT_IN_ENVIRONMENT_ID } from '../models/environment.model';
import { EnvironmentService } from './environment.service';
import { EvaluateEndpointSendService } from './evaluate-endpoint-send.service';

describe('EvaluateEndpointSendService', () => {
  let environments: EnvironmentService;
  let service: EvaluateEndpointSendService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    environments = TestBed.inject(EnvironmentService);
    service = TestBed.inject(EvaluateEndpointSendService);
    environments.syncFromSettings([], BUILT_IN_ENVIRONMENT_ID);
    TestBed.flushEffects();
  });

  it('keeps a blank address off and ignores attempts to enable it', () => {
    expect(service.terminologyConfigured()).toBe(false);
    expect(service.sendTerminology()).toBe(false);
    expect(service.contentConfigured()).toBe(false);
    expect(service.dataConfigured()).toBe(false);

    service.setSend('terminology', true);
    TestBed.flushEffects();

    expect(service.sendTerminology()).toBe(false);
    expect(service.inclusion().terminology).toBe(false);
  });

  it('defaults a configured address to on and keeps an off toggle until that address changes', () => {
    const env = environments.activeEnvironment();
    environments.updateEnvironment({
      ...env,
      terminologyEndpoint: { address: 'http://term/fhir' },
    });
    TestBed.flushEffects();

    expect(service.terminologyConfigured()).toBe(true);
    expect(service.sendTerminology()).toBe(true);
    expect(service.sendContent()).toBe(false);

    service.setSend('terminology', false);
    TestBed.flushEffects();
    expect(service.sendTerminology()).toBe(false);
    expect(service.inclusion().terminology).toBe(false);

    environments.updateEnvironment({
      ...environments.activeEnvironment(),
      terminologyEndpoint: { address: 'http://term/fhir/v2' },
    });
    TestBed.flushEffects();
    expect(service.sendTerminology()).toBe(true);
  });

  it('clears toggles when the active environment changes', () => {
    const first = environments.activeEnvironment();
    environments.updateEnvironment({
      ...first,
      terminologyEndpoint: { address: 'http://term/fhir' },
    });
    TestBed.flushEffects();
    service.setSend('terminology', false);
    TestBed.flushEffects();
    expect(service.sendTerminology()).toBe(false);

    const second = environments.createFromVendorPreset({
      id: 'other',
      name: 'Other',
      evaluationServerUrl: 'https://example.org/fhir',
      terminologyEndpointUrl: 'https://example.org/term',
      notes: 'Other environment.',
    });
    environments.setActiveEnvironment(second.id);
    TestBed.flushEffects();
    expect(service.sendTerminology()).toBe(true);

    environments.setActiveEnvironment(first.id);
    TestBed.flushEffects();
    expect(service.sendTerminology()).toBe(true);
  });
});
