// Author: Preston Lee

import { describe, expect, it } from 'vitest';
import { Parameters, Endpoint } from 'fhir/r4';
import { appendEvaluateEndpointParameters } from './cql-evaluate-parameters.lib';
import { BUILT_IN_ENVIRONMENT_ID } from '../models/environment.model';

describe('cql-evaluate-parameters.lib', () => {
  it('appends data, terminology, and content endpoint parameters', () => {
    const parameters: Parameters = { resourceType: 'Parameters', parameter: [] };
    appendEvaluateEndpointParameters(parameters, {
      id: BUILT_IN_ENVIRONMENT_ID,
      name: 'Test',
      evaluationServer: { address: 'http://localhost:8080/fhir' },
      dataEndpoint: { address: 'http://localhost:8080/data' },
      terminologyEndpoint: { address: 'http://localhost:8080/term' },
      contentEndpoint: { address: 'http://localhost:8080/content' }
    });

    const names = (parameters.parameter ?? []).map(p => p.name);
    expect(names).toEqual(['dataEndpoint', 'terminologyEndpoint', 'contentEndpoint']);
    const dataParam = parameters.parameter?.find(p => p.name === 'dataEndpoint');
    expect(dataParam?.resource?.resourceType).toBe('Endpoint');
    expect((dataParam?.resource as Endpoint)?.address).toBe('http://localhost:8080/data');
  });

  it('omits endpoint parameters when role addresses are blank', () => {
    const parameters: Parameters = { resourceType: 'Parameters', parameter: [] };
    appendEvaluateEndpointParameters(parameters, {
      id: BUILT_IN_ENVIRONMENT_ID,
      name: 'Test',
      evaluationServer: { address: 'http://localhost:8080/fhir' },
      dataEndpoint: { address: '' },
      terminologyEndpoint: { address: '' },
      contentEndpoint: { address: '' }
    });

    expect(parameters.parameter).toEqual([]);
  });
});
