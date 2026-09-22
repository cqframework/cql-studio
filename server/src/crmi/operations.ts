// Author: Preston Lee

import { ownedChildren, referencesOf } from './dependencies.js';
import {
  canonicalOf,
  CONFORMANCE_TYPES,
  extensionValue,
  KNOWLEDGE_TYPES,
  LICENSE_DETAIL_EXTENSION,
  LICENSE_EXTENSION,
  LIBRARY_TYPE_SYSTEM,
  operationOutcome,
  resourceKey,
  splitCanonical,
  TERMINOLOGY_TYPES,
  type FhirBundle,
  type FhirIssue,
  type FhirRelatedArtifact,
  type FhirResource,
} from './fhir.js';
import {
  paramBoolean,
  paramResource,
  paramString,
  paramStrings,
  type ParameterValue,
} from './parameters.js';
import type { FhirRepository } from './repository.js';
import { loadRoot, traceArtifact, type TracedResource } from './trace.js';

export interface OperationSuccess {
  status: number;
  body: FhirResource;
}

const RELEASE_BEHAVIORS = new Set(['default', 'check', 'force']);

export async function runPackage(
  content: FhirRepository,
  terminology: FhirRepository,
  resourceType: string,
  params: ParameterValue[]
): Promise<OperationSuccess> {
  const loaded = await resolveTarget(content, resourceType, params);
  if (!loaded.ok) {
    return loaded.result;
  }
  const capability = paramString(params, 'capability');
  const bundleType = paramString(params, 'bundleType') ?? 'transaction';
  const errorBehavior = paramString(params, 'errorBehavior') === 'strict' ? 'strict' : 'loose';
  const packageOnly = paramBoolean(params, 'packageOnly') === true;
  const include = paramStrings(params, 'include');
  const exclude = paramStrings(params, 'exclude');
  if (bundleType !== 'transaction' && bundleType !== 'collection') {
    return fail(`bundleType must be transaction or collection.`);
  }
  if (capability && !['computable', 'executable', 'publishable'].includes(capability)) {
    return fail(`capability must be computable, executable, or publishable.`);
  }

  const pins = await manifestPins(content, paramString(params, 'manifest'));
  const traced = await traceArtifact(loaded.resource, content, terminology, { pins });
  const issues = [...traced.issues];
  const selected: FhirResource[] = [];
  for (const item of traced.items) {
    if (item.role !== 'root' && !keepDependency(item, include, exclude, packageOnly, loaded.resource.url)) {
      continue;
    }
    const prepared = applyCapability(item.resource, capability, issues);
    selected.push(prepared);
  }
  if (errorBehavior === 'strict' && issues.some((issue) => issue.severity === 'error' || issue.severity === 'fatal')) {
    return { status: 400, body: operationOutcome(issues) };
  }
  const manifest = outcomeManifest(selected, issues);
  const bundle = toBundle(bundleType, [manifest, ...selected]);
  return { status: 200, body: bundle };
}

export async function runDataRequirements(
  content: FhirRepository,
  terminology: FhirRepository,
  resourceType: string,
  params: ParameterValue[]
): Promise<OperationSuccess> {
  const loaded = await resolveTarget(content, resourceType, params);
  if (!loaded.ok) {
    return loaded.result;
  }
  const traced = await traceArtifact(loaded.resource, content, terminology, {
    pins: await manifestPins(content, paramString(params, 'manifest')),
  });
  const related: FhirRelatedArtifact[] = traced.items
    .filter((item) => item.role !== 'root')
    .map((item) => ({
      type: 'depends-on',
      display: item.resource.title || item.resource.name || item.resource.id,
      resource: canonicalOf(item.resource),
    }))
    .filter((artifact) => !!artifact.resource);
  const dataRequirement = traced.items.flatMap((item) =>
    Array.isArray(item.resource.dataRequirement) ? item.resource.dataRequirement : []
  );
  const library: FhirResource = {
    resourceType: 'Library',
    status: 'active',
    type: libraryType('module-definition', 'Module Definition'),
    relatedArtifact: related,
    ...(dataRequirement.length ? { dataRequirement } : {}),
  };
  return { status: 200, body: library };
}

export async function runLicenseRequirements(
  content: FhirRepository,
  terminology: FhirRepository,
  resourceType: string,
  params: ParameterValue[]
): Promise<OperationSuccess> {
  const loaded = await resolveTarget(content, resourceType, params);
  if (!loaded.ok) {
    return loaded.result;
  }
  const traced = await traceArtifact(loaded.resource, content, terminology, {});
  const parameter = traced.items.map((item) => licenseGroup(item.resource));
  return { status: 200, body: { resourceType: 'Parameters', parameter } };
}

export function validatePublishBundle(
  bundle: FhirResource | undefined
): { ok: true; bundle: FhirBundle } | { ok: false; result: OperationSuccess } {
  if (!bundle || bundle.resourceType !== 'Bundle') {
    return { ok: false, result: fail('The publishable bundle is required.') };
  }
  const issues: FhirIssue[] = [];
  if (bundle.type !== 'transaction') {
    issues.push(issue('Bundle.type must be transaction.'));
  }
  const entries = bundle.entry ?? [];
  const first = entries[0]?.resource;
  if (first?.resourceType !== 'ImplementationGuide') {
    issues.push(issue('The first bundle entry must be an ImplementationGuide.'));
  }
  entries.forEach((entry, index) => {
    if (!entry.resource) {
      issues.push(issue(`Bundle.entry[${index}] is missing a resource.`));
      return;
    }
    if (entry.request?.method !== 'POST' || !entry.request.ifNoneExist) {
      issues.push(issue(`Bundle.entry[${index}] must be a conditional create (POST with ifNoneExist).`));
      return;
    }
    if (isCanonicalPublishResource(entry.resource)) {
      const ifNoneExist = entry.request.ifNoneExist;
      if (!ifNoneExist.includes('url=') || !ifNoneExist.includes('version=')) {
        issues.push(
          issue(`Bundle.entry[${index}] ifNoneExist must include url= and version= for canonical resources.`)
        );
      }
      if (!entry.resource.url?.trim() || !entry.resource.version?.trim()) {
        issues.push(issue(`Bundle.entry[${index}] canonical resources must have url and version.`));
      }
    }
  });
  if (issues.length) {
    return { ok: false, result: { status: 400, body: operationOutcome(issues) } };
  }
  return { ok: true, bundle: bundle as FhirBundle };
}

function isCanonicalPublishResource(resource: FhirResource): boolean {
  return (
    KNOWLEDGE_TYPES.has(resource.resourceType) ||
    TERMINOLOGY_TYPES.has(resource.resourceType) ||
    CONFORMANCE_TYPES.has(resource.resourceType)
  );
}

export async function runDraft(
  content: FhirRepository,
  resourceType: string,
  params: ParameterValue[]
): Promise<OperationSuccess> {
  const version = paramString(params, 'version');
  if (!version) {
    return fail('version is required.');
  }
  const loaded = await resolveTarget(content, resourceType, params, false);
  if (!loaded.ok) {
    return loaded.result;
  }
  const family = await ownedFamily(content, loaded.resource);
  const drafted = rewriteFamilyCopies(
    family.map((resource) => draftCopy(resource, version)),
    family,
    version
  );
  const saved: FhirResource[] = [];
  for (const resource of drafted) {
    saved.push(await content.write(resource, 'POST'));
  }
  return { status: 200, body: collectionBundle(saved) };
}

export async function runClone(
  content: FhirRepository,
  resourceType: string,
  params: ParameterValue[]
): Promise<OperationSuccess> {
  const url = paramString(params, 'url');
  const version = paramString(params, 'version');
  if (!url || !version) {
    return fail('url and version are required.');
  }
  const loaded = await resolveTarget(content, resourceType, params, false);
  if (!loaded.ok) {
    return loaded.result;
  }
  const oldUrl = loaded.resource.url ?? '';
  const family = await ownedFamily(content, loaded.resource);
  const usedUrls = new Set<string>([url]);
  const cloned = family.map((resource, index) => {
    const copy = draftCopy(resource, version);
    copy.url = index === 0 ? url : uniqueCloneUrl(resource.url ?? '', oldUrl, url, usedUrls);
    return copy;
  });
  const rewritten = rewriteFamilyCopies(cloned, family, version);
  const saved: FhirResource[] = [];
  for (const resource of rewritten) {
    saved.push(await content.write(resource, 'POST'));
  }
  return { status: 200, body: collectionBundle(saved) };
}

export async function runRelease(
  content: FhirRepository,
  terminology: FhirRepository,
  resourceType: string,
  params: ParameterValue[]
): Promise<OperationSuccess> {
  const version = paramString(params, 'version');
  const versionBehavior = paramString(params, 'versionBehavior');
  if (!version || !versionBehavior) {
    return fail('version and versionBehavior are required.');
  }
  if (!RELEASE_BEHAVIORS.has(versionBehavior)) {
    return fail('versionBehavior must be default, check, or force.');
  }
  const requireVersionSpecific = paramBoolean(params, 'requireVersionSpecificReferences') === true;
  const requireActive = paramBoolean(params, 'requireActiveReferences') === true;
  const releaseDate = paramString(params, 'releaseDate') ?? new Date().toISOString();
  const loaded = await resolveTarget(content, resourceType, params, false);
  if (!loaded.ok) {
    return loaded.result;
  }
  const family = await ownedFamily(content, loaded.resource);
  const issues: FhirIssue[] = [];
  const updated = family.map((resource, index) => {
    const copy = structuredClone(resource);
    copy.date = releaseDate;
    copy.status = 'active';
    const current = copy.version?.trim();
    if (versionBehavior === 'force' || !current || index === 0) {
      if (versionBehavior === 'check' && current && current !== version) {
        issues.push(issue(`${copy.url ?? copy.id} version ${current} does not match ${version}.`));
      } else if (versionBehavior !== 'check' || !current) {
        copy.version = version;
      }
    } else if (versionBehavior === 'check' && current !== version) {
      issues.push(issue(`${copy.url ?? copy.id} version ${current} does not match ${version}.`));
    }
    return copy;
  });
  if (issues.length) {
    return { status: 400, body: operationOutcome(issues) };
  }

  const traced = await traceArtifact(updated[0], content, terminology, {});
  const pins: FhirRelatedArtifact[] = [];
  for (const item of traced.items) {
    if (item.role === 'root') {
      continue;
    }
    const refVersion = item.resource.version;
    const direct = referencesOf(loaded.resource).find((ref) => ref.url === item.resource.url);
    if (requireVersionSpecific && direct && !direct.version && !refVersion) {
      issues.push(issue(`Unversioned reference ${item.resource.url} has no manifest version.`));
    }
    if (requireActive && (item.resource.status === 'draft' || item.resource.status === 'retired')) {
      issues.push(issue(`Dependency ${canonicalOf(item.resource) ?? item.resource.id} is ${item.resource.status}.`));
    }
    const canon = canonicalOf(item.resource);
    if (canon) {
      pins.push({ type: 'depends-on', resource: canon, display: item.resource.name || item.resource.title });
    }
  }
  if (issues.length) {
    return { status: 400, body: operationOutcome(issues) };
  }

  const rootUrl = updated[0].url ?? `urn:uuid:${updated[0].id ?? 'root'}`;
  const manifest: FhirResource = {
    resourceType: 'Library',
    url: `${rootUrl}-manifest`,
    version,
    status: 'active',
    date: releaseDate,
    name: `${updated[0].name ?? 'Artifact'}Manifest`,
    type: libraryType('asset-collection', 'Asset Collection'),
    relatedArtifact: pins,
  };
  if (paramString(params, 'releaseLabel')) {
    manifest.title = paramString(params, 'releaseLabel');
  }
  const rootRelated = [...(updated[0].relatedArtifact ?? [])];
  const manifestCanon = canonicalOf(manifest)!;
  if (!rootRelated.some((artifact) => artifact.resource === manifestCanon)) {
    rootRelated.push({ type: 'depends-on', display: 'version-manifest', resource: manifestCanon });
  }
  updated[0].relatedArtifact = rootRelated;

  const saved: FhirResource[] = [];
  for (const resource of updated) {
    saved.push(await content.write(resource, resource.id ? 'PUT' : 'POST'));
  }
  saved.push(await content.write(manifest, 'POST'));
  return { status: 200, body: collectionBundle(saved) };
}

export async function runReviewOrApprove(
  content: FhirRepository,
  resourceType: string,
  params: ParameterValue[],
  action: 'reviewed' | 'approved'
): Promise<OperationSuccess> {
  const loaded = await resolveTarget(content, resourceType, params, false);
  if (!loaded.ok) {
    return loaded.result;
  }
  const family = await ownedFamily(content, loaded.resource);
  const now = new Date().toISOString();
  const updated = family.map((resource) => {
    const copy = structuredClone(resource);
    copy.date = now;
    if (action === 'approved') {
      copy.approvalDate = now;
    } else {
      copy.lastReviewDate = now;
    }
    return copy;
  });
  const saved: FhirResource[] = [];
  for (const resource of updated) {
    saved.push(await content.write(resource, resource.id ? 'PUT' : 'POST'));
  }
  const assessment: FhirResource = {
    resourceType: 'Basic',
    code: { text: 'ArtifactAssessment' },
    date: now,
    extension: updated.map((resource) => ({
      url: 'http://hl7.org/fhir/StructureDefinition/cqf-artifactAssessment',
      extension: [
        { url: 'artifact', valueCanonical: canonicalOf(resource) ?? resource.id },
        { url: 'date', valueString: now },
        { url: 'action', valueCode: action },
      ],
    })),
  };
  saved.push(await content.write(assessment, 'POST'));
  return { status: 200, body: collectionBundle(saved) };
}

async function ownedFamily(content: FhirRepository, root: FhirResource): Promise<FhirResource[]> {
  const family = [root];
  const seen = new Set<string>([resourceKey(root)]);
  const queue = ownedChildren(root);
  while (queue.length) {
    const ref = queue.shift()!;
    const child = await content.searchCanonical(ref.type, ref.url, ref.version);
    if (!child) {
      continue;
    }
    const key = resourceKey(child);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    family.push(child);
    queue.push(...ownedChildren(child));
  }
  return family;
}

function draftCopy(resource: FhirResource, version: string): FhirResource {
  const copy = structuredClone(resource);
  delete copy.id;
  delete copy.approvalDate;
  delete copy.effectivePeriod;
  if (copy.meta) {
    delete copy.meta.versionId;
    delete copy.meta.lastUpdated;
  }
  copy.version = version;
  copy.status = 'draft';
  return copy;
}

/** Remap relatedArtifact / library / IG definition refs from the pre-copy family onto the new urls|version. */
function rewriteFamilyCopies(
  copies: FhirResource[],
  originals: FhirResource[],
  version: string
): FhirResource[] {
  const urlMap = new Map<string, string>();
  originals.forEach((original, index) => {
    const nextUrl = copies[index]?.url?.trim();
    const oldUrl = original.url?.trim();
    if (!oldUrl || !nextUrl) {
      return;
    }
    const nextCanonical = `${nextUrl}|${version}`;
    urlMap.set(oldUrl, nextCanonical);
    if (original.version) {
      urlMap.set(`${oldUrl}|${original.version}`, nextCanonical);
    }
  });
  for (const copy of copies) {
    rewriteRefsInResource(copy, urlMap);
  }
  return copies;
}

function rewriteRefsInResource(resource: FhirResource, urlMap: Map<string, string>): void {
  if (resource.relatedArtifact?.length) {
    for (const artifact of resource.relatedArtifact) {
      if (!artifact.resource) {
        continue;
      }
      const next = mapCanonical(artifact.resource, urlMap);
      if (next) {
        artifact.resource = next;
      }
    }
  }
  if (resource.library?.length) {
    resource.library = resource.library.map((lib) => mapCanonical(lib, urlMap) ?? lib);
  }
  for (const item of resource.definition?.resource ?? []) {
    if (typeof item.reference === 'string') {
      const next = mapCanonical(item.reference, urlMap);
      if (next) {
        item.reference = next;
      }
      continue;
    }
    if (item.reference && typeof item.reference === 'object' && typeof item.reference.reference === 'string') {
      const next = mapCanonical(item.reference.reference, urlMap);
      if (next) {
        item.reference.reference = next;
      }
    }
  }
}

function mapCanonical(value: string, urlMap: Map<string, string>): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const direct = urlMap.get(trimmed);
  if (direct) {
    return direct;
  }
  const parsed = splitCanonical(trimmed);
  return urlMap.get(parsed.url);
}

function uniqueCloneUrl(childUrl: string, oldRoot: string, newRoot: string, used: Set<string>): string {
  let candidate = rewriteUrl(childUrl, oldRoot, newRoot);
  if (!candidate || candidate === childUrl || used.has(candidate)) {
    const leaf = (childUrl.split('/').filter(Boolean).pop() || 'child').replace(/\|.*$/, '');
    candidate = `${newRoot}-${leaf}`;
  }
  if (used.has(candidate)) {
    let suffix = 2;
    while (used.has(`${candidate}-${suffix}`)) {
      suffix += 1;
    }
    candidate = `${candidate}-${suffix}`;
  }
  used.add(candidate);
  return candidate;
}

function rewriteUrl(childUrl: string, oldRoot: string, newRoot: string): string {
  if (!childUrl) {
    return newRoot;
  }
  if (oldRoot && childUrl.startsWith(oldRoot)) {
    return newRoot + childUrl.slice(oldRoot.length);
  }
  const oldBase = oldRoot.replace(/\/[^/]+$/, '');
  const newBase = newRoot.replace(/\/[^/]+$/, '');
  if (oldBase && newBase && oldBase !== newBase && childUrl.startsWith(oldBase)) {
    return newBase + childUrl.slice(oldBase.length);
  }
  return childUrl;
}

async function resolveTarget(
  content: FhirRepository,
  resourceType: string,
  params: ParameterValue[],
  lookupVersion = true
): Promise<{ ok: true; resource: FhirResource } | { ok: false; result: OperationSuccess }> {
  const id = paramString(params, 'id');
  const url = paramString(params, 'url');
  const version = lookupVersion ? paramString(params, 'version') : undefined;
  if (!id && !url) {
    return { ok: false, result: fail('id or url is required.') };
  }
  const resource = await loadRoot(content, resourceType, id, url, version);
  if (!resource) {
    return { ok: false, result: { status: 404, body: operationOutcome([issue(`Could not find ${resourceType}.`)]) } };
  }
  return { ok: true, resource };
}

async function manifestPins(content: FhirRepository, manifestCanonical: string | undefined): Promise<Map<string, string>> {
  const pins = new Map<string, string>();
  if (!manifestCanonical) {
    return pins;
  }
  const parsed = splitCanonical(manifestCanonical);
  const manifest = await content.searchCanonical('Library', parsed.url, parsed.version);
  for (const artifact of manifest?.relatedArtifact ?? []) {
    if (!artifact.resource) {
      continue;
    }
    const pin = splitCanonical(artifact.resource);
    if (pin.version) {
      pins.set(pin.url, pin.version);
    }
  }
  return pins;
}

function keepDependency(
  item: TracedResource,
  include: string[],
  exclude: string[],
  packageOnly: boolean,
  rootUrl: string | undefined
): boolean {
  if (packageOnly && rootUrl && item.resource.url && !samePackage(rootUrl, item.resource.url)) {
    return false;
  }
  if (exclude.some((code) => matchesCode(item.resource, code))) {
    return false;
  }
  if (include.length === 0 || include.includes('all')) {
    return true;
  }
  return include.some((code) => matchesCode(item.resource, code));
}

function matchesCode(resource: FhirResource, code: string): boolean {
  if (code === 'all' || code === 'canonical') {
    return code === 'all' || typeof resource.url === 'string';
  }
  if (code === 'artifact') {
    return KNOWLEDGE_TYPES.has(resource.resourceType) || resource.resourceType === 'ImplementationGuide';
  }
  if (code === 'knowledge') {
    return KNOWLEDGE_TYPES.has(resource.resourceType);
  }
  if (code === 'terminology') {
    return TERMINOLOGY_TYPES.has(resource.resourceType);
  }
  if (code === 'conformance') {
    return CONFORMANCE_TYPES.has(resource.resourceType);
  }
  return resource.resourceType === code;
}

function samePackage(rootUrl: string, otherUrl: string): boolean {
  try {
    const root = new URL(rootUrl);
    const other = new URL(otherUrl);
    return root.origin === other.origin && packagePrefix(root.pathname) === packagePrefix(other.pathname);
  } catch {
    return otherUrl.startsWith(rootUrl);
  }
}

function packagePrefix(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean);
  const typeIndex = parts.findIndex((part) => KNOWLEDGE_TYPES.has(part) || TERMINOLOGY_TYPES.has(part) || CONFORMANCE_TYPES.has(part));
  if (typeIndex <= 0) {
    return '';
  }
  return parts.slice(0, typeIndex).join('/');
}

function applyCapability(resource: FhirResource, capability: string | undefined, issues: FhirIssue[]): FhirResource {
  if (resource.resourceType !== 'ValueSet' || !capability || capability === 'publishable') {
    return resource;
  }
  const copy = structuredClone(resource);
  if (capability === 'computable') {
    if (copy.compose) {
      delete copy.expansion;
    }
    return copy;
  }
  if (copy.expansion) {
    delete copy.compose;
    return copy;
  }
  issues.push({
    severity: 'warning',
    code: 'processing',
    details: {
      text: `Could not expand the value set ${copy.title || copy.name || copy.id}, but the definition of the value set is still included in the resulting package.`,
    },
  });
  return copy;
}

function outcomeManifest(resources: FhirResource[], issues: FhirIssue[]): FhirResource {
  const manifest: FhirResource = {
    resourceType: 'Library',
    id: 'crmi-outcome-manifest',
    status: 'active',
    type: libraryType('asset-collection', 'Asset Collection'),
    relatedArtifact: resources
      .map((resource) => ({
        type: 'composed-of' as const,
        display: resource.title || resource.name || resource.id,
        resource: canonicalOf(resource),
      }))
      .filter((artifact) => !!artifact.resource),
  };
  if (issues.length) {
    manifest.contained = [{ resourceType: 'OperationOutcome', id: 'issues', issue: issues }];
  }
  return manifest;
}

function toBundle(bundleType: string, resources: FhirResource[]): FhirBundle {
  return {
    resourceType: 'Bundle',
    type: bundleType,
    timestamp: new Date().toISOString(),
    entry: resources.map((resource) => {
      const entry: { resource: FhirResource; request?: { method: string; url: string; ifNoneExist?: string } } = { resource };
      if (bundleType === 'transaction' && resource.id !== 'crmi-outcome-manifest') {
        const type = resource.resourceType;
        const url = typeof resource.url === 'string' ? resource.url : '';
        const version = typeof resource.version === 'string' ? resource.version : '';
        if (url) {
          let ifNoneExist = `url=${encodeURIComponent(url)}`;
          if (version) {
            ifNoneExist += `&version=${encodeURIComponent(version)}`;
          }
          entry.request = { method: 'POST', url: type, ifNoneExist };
        } else if (resource.id) {
          entry.request = { method: 'PUT', url: `${type}/${encodeURIComponent(resource.id)}` };
        }
      }
      return entry;
    }),
  };
}

function collectionBundle(resources: FhirResource[]): FhirBundle {
  return {
    resourceType: 'Bundle',
    type: 'collection',
    entry: resources.map((resource) => ({ resource })),
  };
}

function licenseGroup(resource: FhirResource): Record<string, unknown> {
  const canon = canonicalOf(resource) ?? resource.id ?? resource.resourceType;
  const parameter: Array<Record<string, unknown>> = [
    { name: 'canonical', valueCanonical: canon },
  ];
  if (resource.publisher) {
    parameter.push({ name: 'publisher', valueString: resource.publisher });
  }
  if (typeof resource.copyright === 'string') {
    parameter.push({ name: 'copyright', valueMarkdown: resource.copyright });
  }
  const license = extensionValue(resource, LICENSE_EXTENSION);
  if (license) {
    parameter.push({ name: 'license', valueCode: license });
  }
  const detail = extensionValue(resource, LICENSE_DETAIL_EXTENSION);
  if (detail) {
    parameter.push({ name: 'license-details', valueMarkdown: detail });
  }
  return { name: canon, part: parameter };
}

function libraryType(code: string, display: string): FhirResource['type'] {
  return { coding: [{ system: LIBRARY_TYPE_SYSTEM, code, display }] };
}

function issue(text: string): FhirIssue {
  return { severity: 'error', code: 'invalid', details: { text } };
}

function fail(text: string): OperationSuccess {
  return { status: 400, body: operationOutcome([issue(text)]) };
}

export function publishBundleParameter(params: ParameterValue[]): FhirResource | undefined {
  return paramResource(params, 'bundle');
}
