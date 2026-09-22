// Author: Preston Lee

import { Bundle, ImplementationGuide, ImplementationGuideDefinition, ImplementationGuideDefinitionResource, ImplementationGuideDependsOn, Resource } from 'fhir/r4';
import { endpointOrderForResourceType, FhirEndpointRole } from './fhir-resource-endpoint.lib';

export const FHIR_VERSION_CHOICES = ['4.0.1', '4.0.0', '4.3.0', '5.0.0'] as const;

export const GUIDE_RESOURCE_TYPES = [
  'Library',
  'Measure',
  'PlanDefinition',
  'ActivityDefinition',
  'Questionnaire',
  'ValueSet',
  'CodeSystem',
  'ConceptMap',
  'NamingSystem'
] as const;

export const GUIDE_STATUSES = ['draft', 'active', 'retired', 'unknown'] as const;

export type GuideStatus = (typeof GUIDE_STATUSES)[number];
export type GuideResourceType = (typeof GUIDE_RESOURCE_TYPES)[number];

export interface GuideMemberDraft {
  key: string;
  reference: string;
  name: string;
  example: boolean;
  exampleCanonical: string;
  source?: ImplementationGuideDefinitionResource;
}

export interface GuideDependencyDraft {
  key: string;
  uri: string;
  packageId: string;
  version: string;
  source?: ImplementationGuideDependsOn;
}

export interface GuideDraft {
  url: string;
  version: string;
  name: string;
  title: string;
  status: GuideStatus;
  experimental: boolean;
  date: string;
  publisher: string;
  description: string;
  packageId: string;
  fhirVersion: string[];
  dependencies: GuideDependencyDraft[];
  members: GuideMemberDraft[];
}

const NAME_PATTERN = /^[A-Z][A-Za-z0-9_]{0,254}$/;
const ID_PATTERN = /^[A-Za-z0-9\-.]{1,64}$/;

export function isGuideStatus(value: string | undefined): value is GuideStatus {
  return !!value && (GUIDE_STATUSES as readonly string[]).includes(value);
}

export function fhirVersionOptions(selected: readonly string[]): string[] {
  const extras = selected.filter((version) => !(FHIR_VERSION_CHOICES as readonly string[]).includes(version));
  return [...FHIR_VERSION_CHOICES, ...extras];
}

export function membersFromGuide(guide: ImplementationGuide): GuideMemberDraft[] {
  return (guide.definition?.resource ?? []).map((entry, index) => ({
    key: entry.id ? `member-${entry.id}` : `member-${index}`,
    reference: entry.reference?.reference ?? '',
    name: entry.name ?? entry.reference?.display ?? '',
    example: entry.exampleBoolean === true || !!entry.exampleCanonical?.trim(),
    exampleCanonical: entry.exampleCanonical ?? '',
    source: entry
  }));
}

export function dependenciesFromGuide(guide: ImplementationGuide): GuideDependencyDraft[] {
  return (guide.dependsOn ?? []).map((entry, index) => ({
    key: entry.id ? `dependency-${entry.id}` : `dependency-${index}`,
    uri: entry.uri ?? '',
    packageId: entry.packageId ?? '',
    version: entry.version ?? '',
    source: entry
  }));
}

export function validateGuideDraft(fields: GuideDraft, source: ImplementationGuide | null): string | null {
  const url = fields.url.trim();
  const version = fields.version.trim();
  const name = fields.name.trim();
  const packageId = fields.packageId.trim();
  if (!url || !version || !name || !packageId) {
    return 'URL, version, name, and package id are required.';
  }
  if (!isAbsoluteUri(url)) {
    return 'Canonical URL must be an absolute URI.';
  }
  if (!NAME_PATTERN.test(name)) {
    return 'Name must start with an uppercase letter and contain only letters, digits, and underscores.';
  }
  if (!ID_PATTERN.test(packageId)) {
    return 'Package id must be 1–64 characters and contain only letters, digits, hyphens, and dots.';
  }
  if (!fields.fhirVersion.length) {
    return 'Select at least one FHIR version.';
  }
  const date = fields.date.trim();
  if (date && !isFhirDateTime(date)) {
    return 'Date must be a FHIR date or dateTime, such as 2026-09-21 or 2026-09-21T12:00:00Z.';
  }

  const dependencyUris = new Set<string>();
  for (const dependency of filledDependencies(fields.dependencies)) {
    const uri = dependency.uri.trim();
    if (!uri) {
      return 'Each dependency needs a canonical URL.';
    }
    if (!isAbsoluteUri(uri)) {
      return `Dependency URL must be absolute: ${uri}`;
    }
    if (dependencyUris.has(uri)) {
      return `Duplicate dependency: ${uri}`;
    }
    dependencyUris.add(uri);
  }

  const references = new Set<string>();
  for (const member of fields.members) {
    const reference = member.reference.trim();
    if (!reference) {
      return 'Each listed resource needs a reference.';
    }
    if (references.has(reference)) {
      return `Duplicate reference: ${reference}`;
    }
    references.add(reference);
  }

  if (!fields.members.length && definitionHasSidecars(source?.definition)) {
    return 'This guide still has groupings, pages, or build parameters, so it needs at least one listed resource.';
  }
  return null;
}

export function applyGuideEdits(source: ImplementationGuide | null, fields: GuideDraft): ImplementationGuide {
  const problem = validateGuideDraft(fields, source);
  if (problem) {
    throw new Error(problem);
  }
  const base: ImplementationGuide = source
    ? structuredClone(source)
    : {
        resourceType: 'ImplementationGuide',
        url: '',
        name: '',
        status: 'draft',
        packageId: '',
        fhirVersion: ['4.0.1']
      };

  base.url = fields.url.trim();
  base.version = fields.version.trim();
  base.name = fields.name.trim();
  base.title = blankToUndefined(fields.title);
  base.status = fields.status;
  base.experimental = fields.experimental;
  base.date = blankToUndefined(fields.date);
  base.publisher = blankToUndefined(fields.publisher);
  base.description = blankToUndefined(fields.description);
  base.packageId = fields.packageId.trim();
  base.fhirVersion = [...fields.fhirVersion] as ImplementationGuide['fhirVersion'];

  const dependencies = filledDependencies(fields.dependencies).map((dependency) => {
    const entry = dependency.source ? structuredClone(dependency.source) : { uri: '' };
    entry.uri = dependency.uri.trim();
    entry.packageId = blankToUndefined(dependency.packageId);
    entry.version = blankToUndefined(dependency.version);
    return entry;
  });
  base.dependsOn = dependencies.length ? dependencies : undefined;

  const resources = fields.members.map((member) => memberEntry(member));
  const definition = base.definition ? structuredClone(base.definition) : undefined;
  if (resources.length) {
    base.definition = {
      ...(definition ?? { resource: [] }),
      resource: resources
    };
  } else if (definitionHasSidecars(definition)) {
    throw new Error('This guide still has groupings, pages, or build parameters, so it needs at least one listed resource.');
  } else {
    base.definition = undefined;
  }
  return base;
}

export function memberEndpointRoles(resourceType: string): FhirEndpointRole[] {
  const roles: FhirEndpointRole[] = ['content'];
  for (const role of endpointOrderForResourceType(resourceType)) {
    if (!roles.includes(role)) {
      roles.push(role);
    }
  }
  return roles;
}

export function guideSearchAttempts(term: string): Array<Record<string, string>> {
  return searchAttempts('ImplementationGuide', term, '50');
}

export function memberSearchAttempts(resourceType: string, term: string): Array<Record<string, string>> {
  return searchAttempts(resourceType, term, '25');
}

export function memberReferenceFor(resource: Resource, onContentEndpoint: boolean): string | null {
  const canonical = canonicalUrl(resource);
  if (!onContentEndpoint && canonical) {
    return canonical;
  }
  if (resource.id) {
    return `${resource.resourceType}/${resource.id}`;
  }
  return canonical;
}

export function nextBundleUrl(bundle: Bundle): string | null {
  return bundle.link?.find((link) => link.relation === 'next')?.url ?? null;
}

export function guideDomId(id: string | undefined, index: number): string {
  if (id && ID_PATTERN.test(id)) {
    return id;
  }
  return String(index);
}

function memberEntry(member: GuideMemberDraft): ImplementationGuideDefinitionResource {
  const reference = member.reference.trim();
  const entry = member.source ? structuredClone(member.source) : { reference: { reference } };
  entry.reference = {
    ...(entry.reference ?? {}),
    reference
  };
  const name = member.name.trim();
  if (name) {
    entry.name = name;
  } else {
    entry.name = undefined;
  }
  if (member.example) {
    const exampleCanonical = member.exampleCanonical.trim();
    if (exampleCanonical) {
      entry.exampleCanonical = exampleCanonical;
      entry.exampleBoolean = undefined;
    } else {
      entry.exampleBoolean = true;
      entry.exampleCanonical = undefined;
    }
  } else {
    entry.exampleBoolean = undefined;
    entry.exampleCanonical = undefined;
  }
  return entry;
}

function filledDependencies(rows: readonly GuideDependencyDraft[]): GuideDependencyDraft[] {
  return rows.filter((row) => row.uri.trim() || row.packageId.trim() || row.version.trim());
}

function definitionHasSidecars(definition: ImplementationGuideDefinition | undefined): boolean {
  if (!definition) {
    return false;
  }
  return !!(
    definition.id ||
    definition.grouping?.length ||
    definition.page ||
    definition.parameter?.length ||
    definition.template?.length ||
    definition.extension?.length ||
    definition.modifierExtension?.length
  );
}

function searchAttempts(resourceType: string, term: string, count: string): Array<Record<string, string>> {
  const base = { _count: count, _total: 'accurate' };
  const query = term.trim();
  if (!query) {
    return [base];
  }
  const relative = /^([A-Z][A-Za-z0-9]+)\/([A-Za-z0-9\-.]{1,64})$/.exec(query);
  if (relative?.[1] === resourceType && relative[2]) {
    return [{ ...base, _id: relative[2] }];
  }
  if (query.includes('://') || query.startsWith('urn:')) {
    const url = query.split('|')[0] ?? query;
    return [{ ...base, url }];
  }
  const attempts: Array<Record<string, string>> = [];
  if (isLikelyId(query)) {
    attempts.push({ ...base, _id: query });
  }
  if (resourceType === 'NamingSystem') {
    attempts.push({ ...base, 'name:contains': query });
  } else {
    attempts.push({ ...base, 'title:contains': query });
    attempts.push({ ...base, 'name:contains': query });
  }
  return attempts;
}

function isLikelyId(query: string): boolean {
  return ID_PATTERN.test(query) && /[\d\-.]/.test(query);
}

function isAbsoluteUri(value: string): boolean {
  if (value.startsWith('urn:')) {
    return value.length > 4;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isFhirDateTime(value: string): boolean {
  return /^\d{4}(-\d{2}(-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?)?)?$/.test(value);
}

function blankToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function canonicalUrl(resource: Resource): string | null {
  const url = (resource as { url?: string }).url?.trim();
  return url || null;
}
