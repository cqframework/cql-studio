// Author: Preston Lee

import type { EndpointRole as PrismaEndpointRole } from '@prisma/client';
import type {
  EndpointConfiguration,
  EndpointRole,
  SharedEnvironmentConfig,
  UserEnvironmentDto,
} from '@cql-studio/core';
import {
  ENDPOINT_ROLE_TO_PRISMA,
  PRISMA_ENDPOINT_ROLE_TO_API,
  endpointFromAddressAndHeaders,
  parseHeaderLines,
} from '@cql-studio/core';

export type HeaderRowInput = {
  endpointRole: PrismaEndpointRole;
  name: string;
  value: string;
};

const ENDPOINT_KEYS = [
  'evaluationServer',
  'dataEndpoint',
  'terminologyEndpoint',
  'contentEndpoint',
] as const;

type EndpointKey = (typeof ENDPOINT_KEYS)[number];

const KEY_TO_ROLE: Record<EndpointKey, EndpointRole> = {
  evaluationServer: 'evaluation',
  dataEndpoint: 'data',
  terminologyEndpoint: 'terminology',
  contentEndpoint: 'content',
};

function basicAuthHeader(username: string, password: string): string {
  const token = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
  return `Authorization: Basic ${token}`;
}

function hasAuthorizationHeader(headers: string[]): boolean {
  return headers.some((header) => {
    const idx = header.indexOf(':');
    if (idx <= 0) {
      return false;
    }
    return header.slice(0, idx).trim().toLowerCase() === 'authorization';
  });
}

/** Fold basic-auth convenience fields into Authorization header lines. */
export function normalizeEndpointConfiguration(config: EndpointConfiguration): EndpointConfiguration {
  const address = typeof config.address === 'string' ? config.address : '';
  const username = config.basicAuthUsername?.trim() ?? '';
  const password = config.basicAuthPassword ?? '';
  const headers = [...(config.headers ?? [])].filter((h) => typeof h === 'string' && h.trim());
  if (username && password && !hasAuthorizationHeader(headers)) {
    headers.push(basicAuthHeader(username, password));
  }
  return {
    address,
    basicAuthUsername: '',
    basicAuthPassword: '',
    headers,
  };
}

export function normalizeSharedEnvironmentConfig(config: unknown): SharedEnvironmentConfig {
  const c = config && typeof config === 'object' ? (config as Record<string, unknown>) : {};
  const endpoint = (key: EndpointKey): EndpointConfiguration => {
    const raw = c[key];
    if (!raw || typeof raw !== 'object') {
      return normalizeEndpointConfiguration({ address: '', headers: [] });
    }
    const e = raw as EndpointConfiguration;
    return normalizeEndpointConfiguration({
      address: typeof e.address === 'string' ? e.address : '',
      basicAuthUsername: e.basicAuthUsername,
      basicAuthPassword: e.basicAuthPassword,
      headers: Array.isArray(e.headers) ? e.headers.filter((h): h is string => typeof h === 'string') : [],
    });
  };
  return {
    evaluationServer: endpoint('evaluationServer'),
    dataEndpoint: endpoint('dataEndpoint'),
    terminologyEndpoint: endpoint('terminologyEndpoint'),
    contentEndpoint: endpoint('contentEndpoint'),
  };
}

export function addressesFromConfig(config: SharedEnvironmentConfig): {
  evaluationServerAddress: string;
  dataEndpointAddress: string;
  terminologyEndpointAddress: string;
  contentEndpointAddress: string;
} {
  return {
    evaluationServerAddress: config.evaluationServer.address ?? '',
    dataEndpointAddress: config.dataEndpoint.address ?? '',
    terminologyEndpointAddress: config.terminologyEndpoint.address ?? '',
    contentEndpointAddress: config.contentEndpoint.address ?? '',
  };
}

export function headerRowsFromConfig(config: SharedEnvironmentConfig): HeaderRowInput[] {
  const rows: HeaderRowInput[] = [];
  for (const key of ENDPOINT_KEYS) {
    const role = KEY_TO_ROLE[key];
    const prismaRole = ENDPOINT_ROLE_TO_PRISMA[role];
    for (const parsed of parseHeaderLines(config[key].headers)) {
      if (!parsed.name) {
        continue;
      }
      rows.push({
        endpointRole: prismaRole,
        name: parsed.name,
        value: parsed.value,
      });
    }
  }
  return rows;
}

type EnvWithHeaders = {
  id: string;
  name: string;
  evaluationServerAddress: string;
  dataEndpointAddress: string;
  terminologyEndpointAddress: string;
  contentEndpointAddress: string;
  headers: Array<{ endpointRole: PrismaEndpointRole; name: string; value: string }>;
};

function headersForRole(
  headers: EnvWithHeaders['headers'],
  role: PrismaEndpointRole
): Array<{ name: string; value: string }> {
  return headers
    .filter((h) => h.endpointRole === role)
    .map((h) => ({ name: h.name, value: h.value }));
}

export function configFromStoredEnvironment(env: EnvWithHeaders): SharedEnvironmentConfig {
  return {
    evaluationServer: endpointFromAddressAndHeaders(
      env.evaluationServerAddress,
      headersForRole(env.headers, 'EVALUATION')
    ),
    dataEndpoint: endpointFromAddressAndHeaders(
      env.dataEndpointAddress,
      headersForRole(env.headers, 'DATA')
    ),
    terminologyEndpoint: endpointFromAddressAndHeaders(
      env.terminologyEndpointAddress,
      headersForRole(env.headers, 'TERMINOLOGY')
    ),
    contentEndpoint: endpointFromAddressAndHeaders(
      env.contentEndpointAddress,
      headersForRole(env.headers, 'CONTENT')
    ),
  };
}

export function userEnvironmentDtoFromRow(env: EnvWithHeaders): UserEnvironmentDto {
  const config = configFromStoredEnvironment(env);
  return {
    id: env.id,
    name: env.name,
    evaluationServer: config.evaluationServer,
    dataEndpoint: config.dataEndpoint,
    terminologyEndpoint: config.terminologyEndpoint,
    contentEndpoint: config.contentEndpoint,
  };
}

export function parseUserEnvironmentInput(body: unknown): {
  name: string;
  config: SharedEnvironmentConfig;
} | null {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const b = body as Record<string, unknown>;
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name) {
    return null;
  }
  // Accept either flat CqlEnvironment shape or { name, config }
  if (b.config && typeof b.config === 'object') {
    return { name, config: normalizeSharedEnvironmentConfig(b.config) };
  }
  return {
    name,
    config: normalizeSharedEnvironmentConfig({
      evaluationServer: b.evaluationServer,
      dataEndpoint: b.dataEndpoint,
      terminologyEndpoint: b.terminologyEndpoint,
      contentEndpoint: b.contentEndpoint,
    }),
  };
}

export function prismaRoleToApi(role: PrismaEndpointRole): EndpointRole {
  return PRISMA_ENDPOINT_ROLE_TO_API[role];
}
