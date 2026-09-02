// Author: Preston Lee

import { Endpoint, Parameters } from 'fhir/r4';
import { CqlEnvironment } from '../models/environment.model';
import { buildFhirEndpoint, getEffectiveAddress, normalizeEndpointAddress } from './endpoint-config.lib';

export function resolveEnvironmentEndpoints(environment: CqlEnvironment): {
  evaluationAddress: string;
  dataEndpoint: Endpoint | null;
  terminologyEndpoint: Endpoint | null;
  contentEndpoint: Endpoint | null;
} {
  const evaluationAddress = getEffectiveAddress(environment.evaluationServer);
  const dataAddress = normalizeEndpointAddress(environment.dataEndpoint?.address);
  const terminologyAddress = normalizeEndpointAddress(environment.terminologyEndpoint?.address);
  const contentAddress = normalizeEndpointAddress(environment.contentEndpoint?.address);

  return {
    evaluationAddress,
    dataEndpoint: buildEndpointForRole(environment, 'data', dataAddress),
    terminologyEndpoint: buildEndpointForRole(environment, 'terminology', terminologyAddress),
    contentEndpoint: buildEndpointForRole(environment, 'content', contentAddress)
  };
}

function buildEndpointForRole(
  environment: CqlEnvironment,
  role: 'data' | 'terminology' | 'content',
  address: string
): Endpoint | null {
  if (!address) {
    return null;
  }
  const config =
    role === 'data'
      ? { ...environment.dataEndpoint, address }
      : role === 'terminology'
        ? { ...environment.terminologyEndpoint, address }
        : { ...environment.contentEndpoint, address };
  return buildFhirEndpoint(config, { name: `${environment.name} ${role}` });
}

/** Append data/terminology/content Endpoint parameters when addresses are configured. */
export function appendEvaluateEndpointParameters(
  parameters: Parameters,
  environment: CqlEnvironment
): void {
  if (!parameters.parameter) {
    parameters.parameter = [];
  }
  const resolved = resolveEnvironmentEndpoints(environment);
  if (resolved.dataEndpoint) {
    parameters.parameter.push({ name: 'dataEndpoint', resource: resolved.dataEndpoint });
  }
  if (resolved.terminologyEndpoint) {
    parameters.parameter.push({ name: 'terminologyEndpoint', resource: resolved.terminologyEndpoint });
  }
  if (resolved.contentEndpoint) {
    parameters.parameter.push({ name: 'contentEndpoint', resource: resolved.contentEndpoint });
  }
}
