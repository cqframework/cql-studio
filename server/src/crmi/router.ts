// Author: Preston Lee

import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import type { ServerEnv } from '../config/env.js';
import { requireAuth } from '../auth/session.js';
import { isSupportedType, operationOutcome, SUPPORTED_RESOURCE_TYPES, type FhirResource } from './fhir.js';
import {
  publishBundleParameter,
  runClone,
  runDataRequirements,
  runDraft,
  runLicenseRequirements,
  runPackage,
  runRelease,
  runReviewOrApprove,
  validatePublishBundle,
} from './operations.js';
import { ParameterError, parseParameters } from './parameters.js';
import {
  loadCrmiProfile,
  parseDefaultCrmiProfile,
  ProfileAccessError,
  terminologyMatches,
  type CrmiProfile,
} from './profile.js';
import { HttpRepository, type FhirRepository } from './repository.js';

const READ_OPS = new Set(['$package', '$data-requirements', '$crmi.license-requirements']);
const WRITE_OPS = new Set(['$draft', '$clone', '$release', '$review', '$approve', '$publish']);

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export interface CrmiRouterDeps {
  authenticate?: (req: Request, res: Response, next: NextFunction) => void;
  loadProfile?: typeof loadCrmiProfile;
  loadDefaultProfile?: (req: Request) => CrmiProfile | Promise<CrmiProfile>;
}

export function createCrmiRouter(env: ServerEnv, deps: CrmiRouterDeps = {}): Router {
  const router = Router();
  const loadProfile = deps.loadProfile ?? loadCrmiProfile;
  const loadDefaultProfile = deps.loadDefaultProfile ?? parseDefaultCrmiProfile;
  router.use(express.json({ limit: '20mb', type: ['application/json', 'application/fhir+json'] }));
  router.use(deps.authenticate ?? requireAuth(env));

  router.get('/default/metadata', asyncHandler((req, res) => metadata(req, res, false, loadProfile, loadDefaultProfile)));
  router.get('/personal/:environmentId/metadata', asyncHandler((req, res) => metadata(req, res, false, loadProfile, loadDefaultProfile)));
  router.get(
    '/workspace/:workspaceId/:environmentId/metadata',
    asyncHandler((req, res) => metadata(req, res, false, loadProfile, loadDefaultProfile))
  );

  router.all('/default/$publish', asyncHandler((req, res) => dispatch(req, res, '$publish', loadProfile, loadDefaultProfile)));
  router.all('/personal/:environmentId/$publish', asyncHandler((req, res) => dispatch(req, res, '$publish', loadProfile, loadDefaultProfile)));
  router.all(
    '/workspace/:workspaceId/:environmentId/$publish',
    asyncHandler((req, res) => dispatch(req, res, '$publish', loadProfile, loadDefaultProfile))
  );

  router.all(
    '/default/:resourceType/:id/:operation',
    asyncHandler((req, res) => dispatch(req, res, String(req.params.operation), loadProfile, loadDefaultProfile))
  );
  router.all(
    '/default/:resourceType/:operation',
    asyncHandler((req, res) => dispatch(req, res, String(req.params.operation), loadProfile, loadDefaultProfile))
  );
  router.all(
    '/personal/:environmentId/:resourceType/:id/:operation',
    asyncHandler((req, res) => dispatch(req, res, String(req.params.operation), loadProfile, loadDefaultProfile))
  );
  router.all(
    '/personal/:environmentId/:resourceType/:operation',
    asyncHandler((req, res) => dispatch(req, res, String(req.params.operation), loadProfile, loadDefaultProfile))
  );
  router.all(
    '/workspace/:workspaceId/:environmentId/:resourceType/:id/:operation',
    asyncHandler((req, res) => dispatch(req, res, String(req.params.operation), loadProfile, loadDefaultProfile))
  );
  router.all(
    '/workspace/:workspaceId/:environmentId/:resourceType/:operation',
    asyncHandler((req, res) => dispatch(req, res, String(req.params.operation), loadProfile, loadDefaultProfile))
  );

  return router;
}

type LoadDefaultProfile = (req: Request) => CrmiProfile | Promise<CrmiProfile>;

async function metadata(
  req: Request,
  res: Response,
  write: boolean,
  loadProfile: typeof loadCrmiProfile,
  loadDefaultProfile: LoadDefaultProfile
): Promise<void> {
  try {
    await profileFor(req, write, loadProfile, loadDefaultProfile);
  } catch (err) {
    sendAccessError(res, err);
    return;
  }
  const base = `${req.baseUrl}${req.path.replace(/\/metadata$/, '')}`;
  res.status(200).type('application/fhir+json').json(capabilityStatement(base));
}

async function dispatch(
  req: Request,
  res: Response,
  operation: string,
  loadProfile: typeof loadCrmiProfile,
  loadDefaultProfile: LoadDefaultProfile
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).type('application/fhir+json').json(operationOutcome([{
      severity: 'error',
      code: 'not-supported',
      details: { text: 'Only GET and POST are supported.' },
    }]));
    return;
  }
  const known = READ_OPS.has(operation) || WRITE_OPS.has(operation);
  if (!known) {
    res.status(404).type('application/fhir+json').json(operationOutcome([{
      severity: 'error',
      code: 'not-supported',
      details: { text: `Operation ${operation} is not implemented.` },
    }]));
    return;
  }
  const resourceType = typeof req.params.resourceType === 'string' ? req.params.resourceType : '';
  if (operation !== '$publish' && !isSupportedType(resourceType)) {
    res.status(404).type('application/fhir+json').json(operationOutcome([{
      severity: 'error',
      code: 'not-supported',
      details: { text: `${resourceType || 'Resource'} is not supported by this CRMI server.` },
    }]));
    return;
  }

  let profile: CrmiProfile;
  try {
    profile = await profileFor(req, WRITE_OPS.has(operation), loadProfile, loadDefaultProfile);
  } catch (err) {
    sendAccessError(res, err);
    return;
  }
  if (!profile.content.base) {
    res.status(422).type('application/fhir+json').json(operationOutcome([{
      severity: 'error',
      code: 'invalid',
      details: { text: 'The environment has no content endpoint.' },
    }]));
    return;
  }

  let params;
  try {
    params = parseParameters(operation === '$publish' || req.method === 'POST' ? req.body : queryParameters(req), operation);
  } catch (err) {
    if (err instanceof ParameterError) {
      res.status(400).type('application/fhir+json').json(err.toOutcome());
      return;
    }
    throw err;
  }

  const id = typeof req.params.id === 'string' ? req.params.id : undefined;
  if (id && !params.some((p) => p.name === 'id')) {
    params = [{ name: 'id', value: id }, ...params];
  }

  const content = new HttpRepository(profile.content);
  // ValueSets and CodeSystems resolve against the environment terminology endpoint when configured.
  // Spec terminologyEndpoint may still be supplied and must match this profile (SSRF guard).
  let terminology: FhirRepository = profile.terminology.base
    ? new HttpRepository(profile.terminology)
    : content;
  const terminologyEndpoint = params.find((p) => p.name === 'terminologyEndpoint')?.resource;
  const terminologyAddress = typeof terminologyEndpoint?.address === 'string' ? terminologyEndpoint.address : undefined;
  if (terminologyAddress) {
    if (!terminologyMatches(profile, terminologyAddress)) {
      res.status(400).type('application/fhir+json').json(operationOutcome([{
        severity: 'error',
        code: 'security',
        details: { text: 'terminologyEndpoint must match the environment terminology endpoint.' },
      }]));
      return;
    }
    terminology = new HttpRepository(profile.terminology);
  }

  try {
    const result = await execute(operation, resourceType, params, content, terminology);
    res.status(result.status).type('application/fhir+json').json(result.body);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'CRMI operation failed.';
    res.status(502).type('application/fhir+json').json(operationOutcome([{
      severity: 'error',
      code: 'exception',
      details: { text: message },
    }]));
  }
}

async function execute(
  operation: string,
  resourceType: string,
  params: ReturnType<typeof parseParameters>,
  content: FhirRepository,
  terminology: FhirRepository
): Promise<{ status: number; body: FhirResource }> {
  switch (operation) {
    case '$package':
      return runPackage(content, terminology, resourceType, params);
    case '$data-requirements':
      return runDataRequirements(content, terminology, resourceType, params);
    case '$crmi.license-requirements':
      return runLicenseRequirements(content, terminology, resourceType, params);
    case '$draft':
      return runDraft(content, resourceType, params);
    case '$clone':
      return runClone(content, resourceType, params);
    case '$release':
      return runRelease(content, terminology, resourceType, params);
    case '$review':
      return runReviewOrApprove(content, resourceType, params, 'reviewed');
    case '$approve':
      return runReviewOrApprove(content, resourceType, params, 'approved');
    case '$publish': {
      const validated = validatePublishBundle(publishBundleParameter(params));
      if (!validated.ok) {
        return validated.result;
      }
      const response = await content.transact(validated.bundle);
      return { status: 200, body: response };
    }
    default:
      return {
        status: 404,
        body: operationOutcome([{ severity: 'error', code: 'not-supported', details: { text: operation } }]),
      };
  }
}

function queryParameters(req: Request): FhirResource {
  const parameter = Object.entries(req.query).flatMap(([name, value]) => {
    const values = Array.isArray(value) ? value : [value];
    return values
      .filter((item): item is string => typeof item === 'string')
      .map((item) => ({ name, valueString: item }));
  });
  return { resourceType: 'Parameters', parameter };
}

async function profileFor(
  req: Request,
  write: boolean,
  loadProfile: typeof loadCrmiProfile,
  loadDefaultProfile: LoadDefaultProfile
): Promise<CrmiProfile> {
  const user = req.user;
  if (!user) {
    throw new ProfileAccessError(401, 'Authentication required');
  }
  if (req.path === '/default' || req.path.startsWith('/default/')) {
    return loadDefaultProfile(req);
  }
  if (typeof req.params.workspaceId === 'string') {
    return loadProfile(
      user,
      { kind: 'workspace', workspaceId: req.params.workspaceId, environmentId: String(req.params.environmentId) },
      write
    );
  }
  return loadProfile(user, { kind: 'personal', environmentId: String(req.params.environmentId) }, write);
}

function sendAccessError(res: Response, err: unknown): void {
  if (err instanceof ProfileAccessError) {
    res.status(err.status).type('application/fhir+json').json(operationOutcome([{
      severity: 'error',
      code: err.status === 403 ? 'forbidden' : err.status === 400 ? 'invalid' : 'not-found',
      details: { text: err.message },
    }]));
    return;
  }
  throw err;
}

function capabilityStatement(base: string): FhirResource {
  // This facade exposes CRMI operations only; content read/search happens against the environment FHIR server.
  const rest = SUPPORTED_RESOURCE_TYPES.map((type) => ({
    type,
    operation: [
      { name: 'package', definition: 'http://hl7.org/fhir/uv/crmi/OperationDefinition/crmi-package' },
      { name: 'data-requirements', definition: 'http://hl7.org/fhir/uv/crmi/OperationDefinition/crmi-data-requirements' },
      { name: 'crmi.license-requirements', definition: 'http://hl7.org/fhir/uv/crmi/OperationDefinition/crmi-license-requirements' },
      { name: 'draft', definition: 'http://hl7.org/fhir/uv/crmi/OperationDefinition/crmi-draft' },
      { name: 'clone', definition: 'http://hl7.org/fhir/uv/crmi/OperationDefinition/crmi-clone' },
      { name: 'release', definition: 'http://hl7.org/fhir/uv/crmi/OperationDefinition/crmi-release' },
      { name: 'review', definition: 'http://hl7.org/fhir/uv/crmi/OperationDefinition/crmi-review' },
      { name: 'approve', definition: 'http://hl7.org/fhir/uv/crmi/OperationDefinition/crmi-approve' },
    ],
  }));
  return {
    resourceType: 'CapabilityStatement',
    status: 'active',
    date: new Date().toISOString(),
    kind: 'instance',
    fhirVersion: '4.0.1',
    format: ['json'],
    rest: [
      {
        mode: 'server',
        operation: [
          { name: 'publish', definition: 'http://hl7.org/fhir/uv/crmi/OperationDefinition/crmi-publish' },
        ],
        resource: rest,
      },
    ],
    implementation: { description: 'CQL Studio CRMI facade', url: base },
  };
}
