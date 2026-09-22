// Author: Preston Lee

import assert from 'node:assert';
import { test } from 'node:test';
import express from 'express';
import type { Request } from 'express';
import type { ServerEnv } from '../src/config/env.js';
import { ParameterError, parseParameters } from '../src/crmi/parameters.js';
import { parseDefaultCrmiProfile, ProfileAccessError } from '../src/crmi/profile.js';
import { createCrmiRouter } from '../src/crmi/router.js';
import { MemoryRepository } from '../src/crmi/repository.js';
import {
  runClone,
  runDataRequirements,
  runDraft,
  runLicenseRequirements,
  runPackage,
  runRelease,
  validatePublishBundle,
} from '../src/crmi/operations.js';
import type { FhirResource } from '../src/crmi/fhir.js';

function b64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

const elm = b64(JSON.stringify({
  library: {
    valueSets: { def: [{ name: 'Danger', id: 'http://example.org/ValueSet/danger', version: '1.0.0' }] },
    includes: { def: [{ path: 'Helper', version: '1.0.0' }] },
  },
}));

const cql = b64(`library Root version '1.0.0'\ninclude Helper version '1.0.0'\nvalueset "Danger": 'http://example.org/ValueSet/danger' version '1.0.0'`);

function fixtures(): FhirResource[] {
  return [
    {
      resourceType: 'Library',
      id: 'root',
      url: 'http://example.org/Library/Root',
      version: '1.0.0',
      name: 'Root',
      status: 'active',
      publisher: 'Acme',
      copyright: 'Copyright notice',
      extension: [{ url: 'http://hl7.org/fhir/uv/crmi/StructureDefinition/crmi-license', valueCode: 'CC0-1.0' }],
      content: [{ contentType: 'application/elm+json', data: elm }],
      relatedArtifact: [{
        type: 'composed-of',
        resource: 'http://example.org/Library/Owned',
        extension: [{ url: 'http://hl7.org/fhir/uv/crmi/StructureDefinition/crmi-owned', valueBoolean: true }],
      }],
    },
    {
      resourceType: 'Library',
      id: 'cql-only',
      url: 'http://example.org/Library/CqlOnly',
      version: '1.0.0',
      name: 'CqlOnly',
      status: 'active',
      content: [{ contentType: 'text/cql', data: cql }],
    },
    {
      resourceType: 'Library',
      id: 'helper',
      url: 'http://example.org/Library/Helper',
      name: 'Helper',
      version: '1.0.0',
      status: 'active',
    },
    {
      resourceType: 'Library',
      id: 'owned',
      url: 'http://example.org/Library/Owned',
      version: '1.0.0',
      name: 'Owned',
      status: 'active',
    },
    {
      resourceType: 'ValueSet',
      id: 'danger',
      url: 'http://example.org/ValueSet/danger',
      version: '1.0.0',
      name: 'Danger',
      status: 'active',
      title: 'Danger signs',
      compose: { include: [{ system: 'http://example.org/CodeSystem/local' }] },
    },
    {
      resourceType: 'CodeSystem',
      id: 'local',
      url: 'http://example.org/CodeSystem/local',
      version: '1.0.0',
      name: 'Local',
      status: 'draft',
      content: 'complete',
    },
  ];
}

test('package includes dependencies and an outcome manifest', async () => {
  const repo = new MemoryRepository(fixtures());
  const result = await runPackage(repo, repo, 'Library', [{ name: 'id', value: 'root' }]);
  assert.strictEqual(result.status, 200);
  const bundle = result.body;
  assert.strictEqual(bundle.type, 'transaction');
  const first = bundle.entry?.[0]?.resource;
  assert.strictEqual(first?.id, 'crmi-outcome-manifest');
  const types = (bundle.entry ?? []).map((entry) => entry.resource?.resourceType);
  assert.ok(types.includes('Library'));
  assert.ok(types.includes('ValueSet'));
  const rootEntry = (bundle.entry ?? []).find((entry) => entry.resource?.id === 'root');
  assert.ok(rootEntry?.request?.ifNoneExist?.includes('url='));
});

test('cql-only library still traces include and valueset declarations', async () => {
  const repo = new MemoryRepository(fixtures());
  const result = await runPackage(repo, repo, 'Library', [
    { name: 'id', value: 'cql-only' },
    { name: 'include', value: 'knowledge' },
  ]);
  assert.strictEqual(result.status, 200);
  const names = (result.body.entry ?? []).map((entry) => entry.resource?.name);
  assert.ok(names.includes('Helper'));
  assert.ok(!names.includes('Danger'));
});

test('strict package returns OperationOutcome when a dependency is missing', async () => {
  const resources = fixtures().filter((resource) => resource.id !== 'helper');
  const repo = new MemoryRepository(resources);
  const result = await runPackage(repo, repo, 'Library', [
    { name: 'id', value: 'root' },
    { name: 'errorBehavior', value: 'strict' },
  ]);
  assert.strictEqual(result.status, 400);
  assert.strictEqual(result.body.resourceType, 'OperationOutcome');
});

test('loose package keeps the bundle and records the missing dependency', async () => {
  const resources = fixtures().filter((resource) => resource.id !== 'helper');
  const repo = new MemoryRepository(resources);
  const result = await runPackage(repo, repo, 'Library', [
    { name: 'id', value: 'root' },
    { name: 'errorBehavior', value: 'loose' },
  ]);
  assert.strictEqual(result.status, 200);
  const manifest = result.body.entry?.[0]?.resource;
  const outcome = manifest?.contained?.find((resource) => resource.resourceType === 'OperationOutcome');
  assert.ok(outcome?.issue?.some((issue) => issue.severity === 'error'));
});

test('data requirements returns a module-definition library', async () => {
  const repo = new MemoryRepository(fixtures());
  const result = await runDataRequirements(repo, repo, 'Library', [{ name: 'url', value: 'http://example.org/Library/Root' }, { name: 'version', value: '1.0.0' }]);
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.body.resourceType, 'Library');
  const coding = (result.body.type as { coding?: Array<{ code?: string }> }).coding?.[0]?.code;
  assert.strictEqual(coding, 'module-definition');
  assert.ok((result.body.relatedArtifact ?? []).some((artifact) => artifact.resource?.includes('ValueSet/danger')));
});

test('license requirements lists publisher, copyright, and license', async () => {
  const repo = new MemoryRepository(fixtures());
  const result = await runLicenseRequirements(repo, repo, 'Library', [{ name: 'id', value: 'root' }]);
  assert.strictEqual(result.status, 200);
  const groups = result.body.parameter as Array<{ name?: string; part?: Array<{ name?: string; valueCode?: string }> }>;
  const root = groups.find((group) => group.name?.includes('Library/Root'));
  assert.ok(root);
  assert.ok(root?.part?.some((part) => part.name === 'license' && part.valueCode === 'CC0-1.0'));
});

test('publish rejects a bundle whose first entry is not an ImplementationGuide', () => {
  const result = validatePublishBundle({
    resourceType: 'Bundle',
    type: 'transaction',
    entry: [{
      resource: { resourceType: 'Library', url: 'http://example.org/Library/Root', version: '1.0.0' },
      request: { method: 'POST', url: 'Library', ifNoneExist: 'url=http://example.org/Library/Root&version=1.0.0' },
    }],
  });
  assert.strictEqual(result.ok, false);
  if (!result.ok) {
    assert.strictEqual(result.result.status, 400);
  }
});

test('draft rewrites owned relatedArtifact versions', async () => {
  const resources: FhirResource[] = [
    {
      resourceType: 'Library',
      id: 'parent',
      url: 'http://example.org/Library/Parent',
      version: '1.0.0',
      name: 'Parent',
      status: 'active',
      relatedArtifact: [{
        type: 'composed-of',
        resource: 'http://example.org/Library/Child|1.0.0',
        extension: [{ url: 'http://hl7.org/fhir/StructureDefinition/artifact-isOwned', valueBoolean: true }],
      }],
    },
    {
      resourceType: 'Library',
      id: 'child',
      url: 'http://example.org/Library/Child',
      version: '1.0.0',
      name: 'Child',
      status: 'active',
    },
  ];
  const repo = new MemoryRepository(resources);
  const result = await runDraft(repo, 'Library', [{ name: 'id', value: 'parent' }, { name: 'version', value: '2.0.0' }]);
  assert.strictEqual(result.status, 200);
  const parent = (result.body.entry ?? []).map((entry) => entry.resource).find((resource) => resource?.name === 'Parent');
  assert.strictEqual(parent?.relatedArtifact?.[0]?.resource, 'http://example.org/Library/Child|2.0.0');
});

test('clone assigns unique owned child urls and rewrites ownership links', async () => {
  const resources: FhirResource[] = [
    {
      resourceType: 'Library',
      id: 'parent',
      url: 'http://example.org/Library/Parent',
      version: '1.0.0',
      name: 'Parent',
      status: 'active',
      relatedArtifact: [{
        type: 'composed-of',
        resource: 'http://example.org/Library/Child|1.0.0',
        extension: [{ url: 'http://hl7.org/fhir/StructureDefinition/artifact-isOwned', valueBoolean: true }],
      }],
    },
    {
      resourceType: 'Library',
      id: 'child',
      url: 'http://example.org/Library/Child',
      version: '1.0.0',
      name: 'Child',
      status: 'active',
    },
  ];
  const repo = new MemoryRepository(resources);
  const result = await runClone(repo, 'Library', [
    { name: 'id', value: 'parent' },
    { name: 'url', value: 'http://example.org/Library/ClonedParent' },
    { name: 'version', value: '1.0.0' },
  ]);
  assert.strictEqual(result.status, 200);
  const parent = (result.body.entry ?? []).map((entry) => entry.resource).find((resource) => resource?.url === 'http://example.org/Library/ClonedParent');
  const child = (result.body.entry ?? []).map((entry) => entry.resource).find((resource) => resource?.name === 'Child');
  assert.ok(child?.url);
  assert.notStrictEqual(child?.url, 'http://example.org/Library/Child');
  assert.strictEqual(parent?.relatedArtifact?.[0]?.resource, `${child?.url}|1.0.0`);
});

test('include=artifact keeps knowledge dependencies', async () => {
  const repo = new MemoryRepository(fixtures());
  const result = await runPackage(repo, repo, 'Library', [
    { name: 'id', value: 'root' },
    { name: 'include', value: 'artifact' },
  ]);
  assert.strictEqual(result.status, 200);
  const names = (result.body.entry ?? []).map((entry) => entry.resource?.name);
  assert.ok(names.includes('Helper'));
  assert.ok(names.includes('Owned'));
});

test('publish rejects canonical ifNoneExist without version=', () => {
  const result = validatePublishBundle({
    resourceType: 'Bundle',
    type: 'transaction',
    entry: [
      {
        resource: {
          resourceType: 'ImplementationGuide',
          url: 'http://example.org/ig',
          version: '1.0.0',
          name: 'Ig',
          status: 'active',
          packageId: 'ex.ig',
          fhirVersion: ['4.0.1'],
        },
        request: { method: 'POST', url: 'ImplementationGuide', ifNoneExist: 'url=http%3A%2F%2Fexample.org%2Fig' },
      },
    ],
  });
  assert.strictEqual(result.ok, false);
});

test('release sets status to active', async () => {
  const repo = new MemoryRepository([
    {
      resourceType: 'Library',
      id: 'root',
      url: 'http://example.org/Library/Root',
      version: '1.0.0',
      name: 'Root',
      status: 'draft',
    },
  ]);
  const result = await runRelease(repo, repo, 'Library', [
    { name: 'id', value: 'root' },
    { name: 'version', value: '1.0.0' },
    { name: 'versionBehavior', value: 'default' },
  ]);
  assert.strictEqual(result.status, 200);
  const root = (result.body.entry ?? []).map((entry) => entry.resource).find((resource) => resource?.name === 'Root');
  assert.strictEqual(root?.status, 'active');
});

test('draft recurses children marked with artifact-isOwned', async () => {
  const resources: FhirResource[] = [
    {
      resourceType: 'Library',
      id: 'parent',
      url: 'http://example.org/Library/Parent',
      version: '1.0.0',
      name: 'Parent',
      status: 'active',
      relatedArtifact: [{
        type: 'composed-of',
        resource: 'http://example.org/Library/Child|1.0.0',
        extension: [{ url: 'http://hl7.org/fhir/StructureDefinition/artifact-isOwned', valueBoolean: true }],
      }],
    },
    {
      resourceType: 'Library',
      id: 'child',
      url: 'http://example.org/Library/Child',
      version: '1.0.0',
      name: 'Child',
      status: 'active',
    },
  ];
  const repo = new MemoryRepository(resources);
  const result = await runDraft(repo, 'Library', [{ name: 'id', value: 'parent' }, { name: 'version', value: '2.0.0' }]);
  assert.strictEqual(result.status, 200);
  const drafted = (result.body.entry ?? []).map((entry) => entry.resource);
  assert.ok(drafted.some((resource) => resource?.url === 'http://example.org/Library/Parent' && resource.status === 'draft'));
  assert.ok(drafted.some((resource) => resource?.url === 'http://example.org/Library/Child' && resource.version === '2.0.0' && resource.status === 'draft'));
});

test('draft creates a new version and leaves the active artifact unchanged', async () => {
  const resources = fixtures();
  const repo = new MemoryRepository(resources);
  const result = await runDraft(repo, 'Library', [{ name: 'id', value: 'root' }, { name: 'version', value: '2.0.0' }]);
  assert.strictEqual(result.status, 200);
  const original = resources.find((resource) => resource.id === 'root');
  assert.strictEqual(original?.version, '1.0.0');
  assert.strictEqual(original?.status, 'active');
  const drafted = (result.body.entry ?? []).map((entry) => entry.resource);
  assert.ok(drafted.some((resource) => resource?.url === 'http://example.org/Library/Root' && resource.version === '2.0.0' && resource.status === 'draft'));
  assert.ok(drafted.some((resource) => resource?.url === 'http://example.org/Library/Owned' && resource.status === 'draft'));
  assert.strictEqual(drafted.find((resource) => resource?.url === 'http://example.org/Library/Root')?.approvalDate, undefined);
});

test('release pins dependency versions into a manifest library', async () => {
  const repo = new MemoryRepository(fixtures());
  const result = await runRelease(repo, repo, 'Library', [
    { name: 'id', value: 'root' },
    { name: 'version', value: '1.1.0' },
    { name: 'versionBehavior', value: 'force' },
    { name: 'requireActiveReferences', value: false },
  ]);
  assert.strictEqual(result.status, 200);
  const manifest = (result.body.entry ?? []).map((entry) => entry.resource).find((resource) => resource?.url?.endsWith('-manifest'));
  assert.ok(manifest);
  assert.ok((manifest?.relatedArtifact ?? []).some((artifact) => artifact.resource === 'http://example.org/ValueSet/danger|1.0.0'));
  const root = (result.body.entry ?? []).find((entry) => entry.resource?.id === 'root')?.resource;
  assert.strictEqual(root?.version, '1.1.0');
  assert.ok(root?.relatedArtifact?.some((artifact) => artifact.display === 'version-manifest'));
});

test('value set resolution prefers an exact version but accepts url-only matches', async () => {
  const repo = new MemoryRepository([
    {
      resourceType: 'Library',
      id: 'root',
      url: 'http://example.org/Library/Root',
      version: '1.0.0',
      name: 'Root',
      status: 'active',
      content: [{
        contentType: 'text/cql',
        data: Buffer.from(
          "library Root version '1.0.0'\nvalueset \"Danger\": 'http://example.org/ValueSet/danger' version '9.9.9'",
          'utf8'
        ).toString('base64'),
      }],
    },
    {
      resourceType: 'ValueSet',
      id: 'danger',
      url: 'http://example.org/ValueSet/danger',
      version: '1.0.0',
      name: 'Danger',
      status: 'active',
      compose: { include: [{ system: 'http://example.org/cs' }] },
    },
  ]);
  const result = await runPackage(repo, repo, 'Library', [{ name: 'id', value: 'root' }]);
  assert.strictEqual(result.status, 200);
  const names = (result.body.entry ?? []).map((entry) => entry.resource?.name);
  assert.ok(names.includes('Danger'));
});

test('unknown parameter names are rejected', () => {
  assert.throws(
    () => parseParameters({
      resourceType: 'Parameters',
      parameter: [{ name: 'studioExtension', valueString: 'nope' }],
    }, '$package'),
    (err: unknown) => err instanceof ParameterError && /Unknown parameter/.test(err.message)
  );
});

test('an environment prefix the session cannot access is rejected', async () => {
  const app = express();
  app.use('/api/fhir', createCrmiRouter({} as ServerEnv, {
    authenticate: (req, _res, next) => {
      req.user = { id: 'user-1' } as Express.Request['user'];
      next();
    },
    loadProfile: async () => {
      throw new ProfileAccessError(404, 'Environment not found.');
    },
  }));
  await new Promise<void>((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        const res = await fetch(`http://127.0.0.1:${port}/api/fhir/personal/missing/Library/root/$package`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/fhir+json' },
          body: JSON.stringify({ resourceType: 'Parameters', parameter: [] }),
        });
        assert.strictEqual(res.status, 404);
        const body = await res.json() as FhirResource;
        assert.strictEqual(body.resourceType, 'OperationOutcome');
        server.close();
        resolve();
      } catch (err) {
        server.close();
        reject(err);
      }
    });
  });
});

test('default profile is built from content and terminology headers', () => {
  const profile = parseDefaultCrmiProfile({
    headers: {
      'x-cql-studio-content-base-url': 'http://content.example/fhir/',
      'x-cql-studio-content-authorization': 'Basic content',
      'x-cql-studio-terminology-base-url': 'http://term.example/fhir',
      'x-cql-studio-terminology-authorization': 'Basic term',
    },
  } as Request);
  assert.strictEqual(profile.content.base, 'http://content.example/fhir');
  assert.deepStrictEqual(profile.content.headers, { Authorization: 'Basic content' });
  assert.strictEqual(profile.terminology.base, 'http://term.example/fhir');
  assert.deepStrictEqual(profile.terminology.headers, { Authorization: 'Basic term' });
});

test('default profile requires a content base header', () => {
  assert.throws(
    () => parseDefaultCrmiProfile({ headers: {} } as Request),
    (err: unknown) =>
      err instanceof ProfileAccessError &&
      err.status === 400 &&
      err.message === 'Default environment has no content endpoint configured.'
  );
});

test('the default CRMI route serves metadata from request headers', async () => {
  const { port, close } = await listen(defaultCrmiApp());
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/fhir/default/metadata`, {
      headers: { 'x-cql-studio-content-base-url': 'http://content.example/fhir' },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json() as FhirResource;
    assert.strictEqual(body.resourceType, 'CapabilityStatement');
  } finally {
    close();
  }
});

test('the default CRMI route rejects a missing content base', async () => {
  const { port, close } = await listen(defaultCrmiApp());
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/fhir/default/metadata`);
    assert.strictEqual(res.status, 400);
    const body = await res.json() as FhirResource;
    assert.strictEqual(body.resourceType, 'OperationOutcome');
    assert.match(String(body.issue?.[0]?.details?.text), /no content endpoint/);
  } finally {
    close();
  }
});

test('the default CRMI route rejects a terminology endpoint that does not match the header', async () => {
  const { port, close } = await listen(defaultCrmiApp());
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/fhir/default/Library/root/$package`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/fhir+json',
        'x-cql-studio-content-base-url': 'http://content.example/fhir',
        'x-cql-studio-terminology-base-url': 'http://term.example/fhir',
      },
      body: JSON.stringify({
        resourceType: 'Parameters',
        parameter: [{
          name: 'terminologyEndpoint',
          resource: { resourceType: 'Endpoint', address: 'http://other.example/fhir' },
        }],
      }),
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json() as FhirResource;
    assert.match(String(body.issue?.[0]?.details?.text), /terminologyEndpoint must match/);
  } finally {
    close();
  }
});

function defaultCrmiApp(): express.Express {
  const app = express();
  app.use('/api/fhir', createCrmiRouter({} as ServerEnv, {
    authenticate: (req, _res, next) => {
      req.user = { id: 'user-1' } as Express.Request['user'];
      next();
    },
  }));
  return app;
}

function listen(app: express.Express): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ port, close: () => server.close() });
    });
  });
}
