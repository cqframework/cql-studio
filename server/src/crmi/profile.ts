// Author: Preston Lee

import type { User } from '@prisma/client';
import { WorkspaceRole } from '@prisma/client';
import type { EndpointConfiguration } from '@cql-studio/core';
import type { Request } from 'express';
import { getPrisma } from '../db/prisma.js';
import { configFromStoredEnvironment } from '../user/environment-persist.js';
import { resolveEffectiveWorkspaceRole, roleAtLeast } from '../workspace/access.js';
import { normalizeBase } from './fhir.js';
import type { HttpEndpoint } from './repository.js';

export const DEFAULT_CONTENT_BASE_HEADER = 'x-cql-studio-content-base-url';
export const DEFAULT_CONTENT_AUTHORIZATION_HEADER = 'x-cql-studio-content-authorization';
export const DEFAULT_TERMINOLOGY_BASE_HEADER = 'x-cql-studio-terminology-base-url';
export const DEFAULT_TERMINOLOGY_AUTHORIZATION_HEADER = 'x-cql-studio-terminology-authorization';

export interface CrmiProfile {
  content: HttpEndpoint;
  terminology: HttpEndpoint;
}

export class ProfileAccessError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

const headerInclude = { headers: { orderBy: [{ name: 'asc' as const }] } };

export async function loadCrmiProfile(
  user: User,
  scope: { kind: 'personal'; environmentId: string } | { kind: 'workspace'; workspaceId: string; environmentId: string },
  write: boolean
): Promise<CrmiProfile> {
  if (scope.kind === 'personal') {
    const row = await getPrisma().userEnvironment.findFirst({
      where: { id: scope.environmentId, userId: user.id },
      include: headerInclude,
    });
    if (!row) {
      throw new ProfileAccessError(404, 'Environment not found.');
    }
    return profileFromConfig(configFromStoredEnvironment(row));
  }

  const role = await resolveEffectiveWorkspaceRole(user, scope.workspaceId);
  const required = write ? WorkspaceRole.EDITOR : WorkspaceRole.VIEWER;
  if (!roleAtLeast(role, required)) {
    throw new ProfileAccessError(role ? 403 : 404, role ? 'Editor role required.' : 'Environment not found.');
  }
  const row = await getPrisma().sharedEnvironment.findFirst({
    where: { id: scope.environmentId, workspaceId: scope.workspaceId },
    include: headerInclude,
  });
  if (!row) {
    throw new ProfileAccessError(404, 'Environment not found.');
  }
  return profileFromConfig(configFromStoredEnvironment(row));
}

function profileFromConfig(config: {
  contentEndpoint: EndpointConfiguration;
  terminologyEndpoint: EndpointConfiguration;
}): CrmiProfile {
  return {
    content: endpoint(config.contentEndpoint),
    terminology: endpoint(config.terminologyEndpoint),
  };
}

function endpoint(config: EndpointConfiguration): HttpEndpoint {
  return {
    base: normalizeBase(config.address ?? ''),
    headers: headersFromLines(config.headers ?? []),
  };
}

function headersFromLines(lines: string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx <= 0) {
      continue;
    }
    const name = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (name) {
      headers[name] = value;
    }
  }
  return headers;
}

export function terminologyMatches(profile: CrmiProfile, address: string | undefined): boolean {
  if (!address) {
    return false;
  }
  return normalizeBase(address) === normalizeBase(profile.terminology.base);
}

/** Build a CRMI profile from the UI Default Environment headers. Terminology falls back to content when its base is omitted. */
export function parseDefaultCrmiProfile(req: Request): CrmiProfile {
  const contentBase = normalizeBase(headerValue(req, DEFAULT_CONTENT_BASE_HEADER));
  if (!contentBase) {
    throw new ProfileAccessError(400, 'Default environment has no content endpoint configured.');
  }
  const terminologyBase = normalizeBase(headerValue(req, DEFAULT_TERMINOLOGY_BASE_HEADER));
  return {
    content: httpEndpoint(contentBase, headerValue(req, DEFAULT_CONTENT_AUTHORIZATION_HEADER)),
    terminology: httpEndpoint(terminologyBase, headerValue(req, DEFAULT_TERMINOLOGY_AUTHORIZATION_HEADER)),
  };
}

function httpEndpoint(base: string, authorization: string): HttpEndpoint {
  return {
    base,
    headers: authorization ? { Authorization: authorization } : {},
  };
}

function headerValue(req: Request, name: string): string {
  const raw = req.headers[name];
  if (Array.isArray(raw)) {
    return raw[0]?.trim() ?? '';
  }
  return typeof raw === 'string' ? raw.trim() : '';
}
