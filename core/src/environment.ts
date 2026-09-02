// Author: Preston Lee

/** Subset of FHIR R4 Endpoint used by CQL Studio + HAPI $evaluate */
export interface EndpointConfiguration {
  address: string;
  /** Convenience fields compiled into Endpoint.header as Authorization */
  basicAuthUsername?: string;
  basicAuthPassword?: string;
  /** Additional FHIR Endpoint.header entries ("Name: value") */
  headers?: string[];
}

export interface CqlEnvironment {
  id: string;
  name: string;
  builtIn?: boolean;
  evaluationServer: EndpointConfiguration;
  dataEndpoint: EndpointConfiguration;
  terminologyEndpoint: EndpointConfiguration;
  contentEndpoint: EndpointConfiguration;
}

export const BUILT_IN_ENVIRONMENT_ID = 'default';

export type EndpointRole = 'evaluation' | 'data' | 'terminology' | 'content';

export interface EndpointHttpContext {
  address: string;
  headers: Record<string, string>;
}

export function workspaceEnvironmentSyntheticId(workspaceId: string, environmentId: string): string {
  return `ws:${workspaceId}:${environmentId}`;
}

export interface SharedEnvironmentConfig {
  evaluationServer: EndpointConfiguration;
  dataEndpoint: EndpointConfiguration;
  terminologyEndpoint: EndpointConfiguration;
  contentEndpoint: EndpointConfiguration;
}

export interface SharedEnvironmentDto {
  id: string;
  workspaceId: string;
  name: string;
  config: SharedEnvironmentConfig;
  createdAt: string;
  updatedAt: string;
}
