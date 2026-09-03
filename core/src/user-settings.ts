// Author: Preston Lee

import type { CqlEnvironment, EndpointConfiguration, EndpointRole } from './environment.js';

export interface UserSettingsDto {
  experimental: boolean;
  developer: boolean;
  themePreferred: string;
  validateSchema: boolean;
  runnerApiBaseUrl: string;
  runnerFhirBaseUrl: string;
  defaultTestResultsIndexUrl: string;
  fhirPackageRegistryBaseUrl: string;
  vsacFhirBaseUrl: string;
  vsacApiUsername: string;
  vsacApiPassword: string;
  aiProvider: 'ollama' | 'openai' | 'openai-compatible';
  ollamaBaseUrl: string;
  ollamaModel: string;
  openaiModel: string;
  compatibleProviderName: string;
  compatibleProviderBaseUrl: string;
  compatibleProviderModel: string;
  searxngBaseUrl: string;
  enableAiAssistant: boolean;
  autoApplyCodeEdits: boolean;
  enableAiCodePrediction: boolean;
}

export type UserSettingsPatch = Partial<UserSettingsDto>;

/** Personal environment as returned by /api/users/me/environments (never built-in). */
export type UserEnvironmentDto = Omit<CqlEnvironment, 'builtIn'> & {
  builtIn?: false;
};

export interface EnvironmentEndpointAddresses {
  evaluationServerAddress: string;
  dataEndpointAddress: string;
  terminologyEndpointAddress: string;
  contentEndpointAddress: string;
}

export interface EnvironmentHttpHeaderDto {
  endpointRole: EndpointRole;
  name: string;
  value: string;
}

export const ENDPOINT_ROLE_TO_PRISMA: Record<EndpointRole, 'EVALUATION' | 'DATA' | 'TERMINOLOGY' | 'CONTENT'> = {
  evaluation: 'EVALUATION',
  data: 'DATA',
  terminology: 'TERMINOLOGY',
  content: 'CONTENT',
};

export const PRISMA_ENDPOINT_ROLE_TO_API: Record<'EVALUATION' | 'DATA' | 'TERMINOLOGY' | 'CONTENT', EndpointRole> = {
  EVALUATION: 'evaluation',
  DATA: 'data',
  TERMINOLOGY: 'terminology',
  CONTENT: 'content',
};

export function emptyEndpointConfiguration(): EndpointConfiguration {
  return { address: '', headers: [] };
}

export function endpointFromAddressAndHeaders(
  address: string,
  headers: Array<{ name: string; value: string }>
): EndpointConfiguration {
  const sorted = [...headers].sort((a, b) => a.name.localeCompare(b.name));
  return {
    address: address ?? '',
    headers: sorted.map((h) => `${h.name}: ${h.value}`),
  };
}

export function parseHeaderLines(
  lines: string[] | undefined
): Array<{ name: string; value: string }> {
  if (!lines?.length) {
    return [];
  }
  const out: Array<{ name: string; value: string }> = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const colon = trimmed.indexOf(':');
    if (colon < 0) {
      out.push({ name: trimmed, value: '' });
      continue;
    }
    out.push({
      name: trimmed.slice(0, colon).trim(),
      value: trimmed.slice(colon + 1).trim(),
    });
  }
  return out;
}
