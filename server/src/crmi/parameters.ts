// Author: Preston Lee

import { operationOutcome, type FhirIssue, type FhirResource } from './fhir.js';

export interface ParameterValue {
  name: string;
  value?: unknown;
  resource?: FhirResource;
  part?: ParameterValue[];
}

export class ParameterError extends Error {
  constructor(
    message: string,
    readonly issues: FhirIssue[]
  ) {
    super(message);
  }

  toOutcome(): FhirResource {
    return operationOutcome(this.issues);
  }
}

const PACKAGE_PARAMS = new Set([
  'id',
  'url',
  'version',
  'identifier',
  'capability',
  'terminologyCapabilities',
  'artifactVersion',
  'checkArtifactVersion',
  'forceArtifactVersion',
  'manifest',
  'canonicalVersion',
  'offset',
  'count',
  'include',
  'exclude',
  'includeUri',
  'excludeUri',
  'packageOnly',
  'bundleType',
  'errorBehavior',
  'artifactEndpointConfiguration',
  'terminologyEndpoint',
  'contentEndpoint',
]);

const REQUIREMENTS_PARAMS = new Set([
  'id',
  'url',
  'version',
  'identifier',
  'expression',
  'parameters',
  'artifactVersion',
  'checkArtifactVersion',
  'forceArtifactVersion',
  'manifest',
  'canonicalVersion',
  'artifactEndpointConfiguration',
  'terminologyEndpoint',
  'contentEndpoint',
]);

const LICENSE_PARAMS = new Set([
  ...REQUIREMENTS_PARAMS,
  'include',
]);

const DRAFT_PARAMS = new Set(['id', 'version']);
const CLONE_PARAMS = new Set(['id', 'url', 'version']);
const RELEASE_PARAMS = new Set([
  'id',
  'version',
  'versionBehavior',
  'requireVersionSpecificReferences',
  'requireActiveReferences',
  'latestFromTxServer',
  'experimentalBehavior',
  'releaseDate',
  'releaseLabel',
]);
const REVIEW_PARAMS = new Set(['id', 'version']);
const APPROVE_PARAMS = REVIEW_PARAMS;
const PUBLISH_PARAMS = new Set(['bundle']);

const IMPLEMENTED = new Set([
  'id',
  'url',
  'version',
  'capability',
  'manifest',
  'include',
  'exclude',
  'packageOnly',
  'bundleType',
  'errorBehavior',
  'terminologyEndpoint',
  'versionBehavior',
  'requireVersionSpecificReferences',
  'requireActiveReferences',
  'releaseDate',
  'releaseLabel',
  'bundle',
  'expression',
]);

export function allowedParameterNames(operation: string): Set<string> {
  switch (operation) {
    case '$package':
      return PACKAGE_PARAMS;
    case '$data-requirements':
      return REQUIREMENTS_PARAMS;
    case '$crmi.license-requirements':
      return LICENSE_PARAMS;
    case '$draft':
      return DRAFT_PARAMS;
    case '$clone':
      return CLONE_PARAMS;
    case '$release':
      return RELEASE_PARAMS;
    case '$review':
      return REVIEW_PARAMS;
    case '$approve':
      return APPROVE_PARAMS;
    case '$publish':
      return PUBLISH_PARAMS;
    default:
      return new Set();
  }
}

function readValue(entry: Record<string, unknown>): unknown {
  for (const key of Object.keys(entry)) {
    if (key.startsWith('value')) {
      return entry[key];
    }
  }
  return undefined;
}

export function parseParameters(body: unknown, operation: string): ParameterValue[] {
  if (operation === '$publish' && isResource(body) && body.resourceType === 'Bundle') {
    return [{ name: 'bundle', resource: body }];
  }
  if (!isResource(body) || body.resourceType !== 'Parameters') {
    throw new ParameterError('Operation input must be a Parameters resource.', [
      {
        severity: 'error',
        code: 'invalid',
        details: { text: 'Operation input must be a Parameters resource.' },
      },
    ]);
  }
  const raw = body.parameter;
  if (raw != null && !Array.isArray(raw)) {
    throw new ParameterError('Parameters.parameter must be an array.', [
      { severity: 'error', code: 'invalid', details: { text: 'Parameters.parameter must be an array.' } },
    ]);
  }
  const allowed = allowedParameterNames(operation);
  const parsed: ParameterValue[] = [];
  for (const item of raw ?? []) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const entry = item as Record<string, unknown>;
    const name = typeof entry.name === 'string' ? entry.name : '';
    if (!name) {
      throw new ParameterError('Parameter name is required.', [
        { severity: 'error', code: 'invalid', details: { text: 'Parameter name is required.' } },
      ]);
    }
    if (!allowed.has(name)) {
      throw new ParameterError(`Unknown parameter "${name}".`, [
        {
          severity: 'error',
          code: 'not-supported',
          details: { text: `Unknown parameter "${name}" for ${operation}.` },
        },
      ]);
    }
    if (!IMPLEMENTED.has(name)) {
      throw new ParameterError(`Parameter "${name}" is not supported.`, [
        {
          severity: 'error',
          code: 'not-supported',
          details: { text: `Parameter "${name}" is defined by CRMI but is not implemented by this server.` },
        },
      ]);
    }
    const resource = isResource(entry.resource) ? entry.resource : undefined;
    parsed.push({ name, value: readValue(entry), resource });
  }
  return parsed;
}

export function paramValues(params: ParameterValue[], name: string): unknown[] {
  return params.filter((p) => p.name === name).map((p) => p.value).filter((v) => v != null);
}

export function paramString(params: ParameterValue[], name: string): string | undefined {
  const value = paramValues(params, name)[0];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function paramBoolean(params: ParameterValue[], name: string): boolean | undefined {
  const value = paramValues(params, name)[0];
  return typeof value === 'boolean' ? value : undefined;
}

export function paramStrings(params: ParameterValue[], name: string): string[] {
  return paramValues(params, name).filter((v): v is string => typeof v === 'string' && v.trim() !== '');
}

export function paramResource(params: ParameterValue[], name: string): FhirResource | undefined {
  return params.find((p) => p.name === name && p.resource)?.resource;
}

function isResource(value: unknown): value is FhirResource {
  return !!value && typeof value === 'object' && typeof (value as FhirResource).resourceType === 'string';
}
