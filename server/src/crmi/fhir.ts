// Author: Preston Lee

export const SUPPORTED_RESOURCE_TYPES = [
  'Library',
  'Measure',
  'PlanDefinition',
  'ActivityDefinition',
  'Questionnaire',
  'ValueSet',
  'CodeSystem',
  'ConceptMap',
  'NamingSystem',
  'ImplementationGuide',
] as const;

export type SupportedResourceType = (typeof SUPPORTED_RESOURCE_TYPES)[number];

const SUPPORTED_SET = new Set<string>(SUPPORTED_RESOURCE_TYPES);

export const TERMINOLOGY_TYPES = new Set(['ValueSet', 'CodeSystem', 'ConceptMap', 'NamingSystem']);

export const KNOWLEDGE_TYPES = new Set([
  'ActivityDefinition',
  'Library',
  'PlanDefinition',
  'Measure',
  'Questionnaire',
]);

export const CONFORMANCE_TYPES = new Set([
  'StructureDefinition',
  'StructureMap',
  'SearchParameter',
  'CompartmentDefinition',
  'ImplementationGuide',
  'CapabilityStatement',
  'OperationDefinition',
  'GraphDefinition',
  'MessageDefinition',
  'SearchParameter',
]);

/** Legacy CRMI ballot suffix. Canonical ownership extension is artifact-isOwned. */
export const OWNED_EXTENSION_SUFFIX = 'crmi-owned';
export const ARTIFACT_IS_OWNED_SUFFIX = 'artifact-isOwned';
export const LICENSE_EXTENSION = 'http://hl7.org/fhir/uv/crmi/StructureDefinition/crmi-license';
export const LICENSE_DETAIL_EXTENSION = 'http://hl7.org/fhir/uv/crmi/StructureDefinition/crmi-licenseDetail';
export const LIBRARY_TYPE_SYSTEM = 'http://terminology.hl7.org/CodeSystem/library-type';

export interface FhirExtension {
  url?: string;
  valueCode?: string;
  valueString?: string;
  valueMarkdown?: string;
  valueCanonical?: string;
  valueUri?: string;
  valueBoolean?: boolean;
  extension?: FhirExtension[];
}

export interface FhirRelatedArtifact {
  type?: string;
  display?: string;
  resource?: string;
  extension?: FhirExtension[];
}

export interface FhirContent {
  contentType?: string;
  data?: string;
}

export interface FhirResource {
  resourceType: string;
  id?: string;
  url?: string;
  version?: string;
  name?: string;
  title?: string;
  status?: string;
  date?: string;
  publisher?: string;
  copyright?: string;
  approvalDate?: string;
  lastReviewDate?: string;
  effectivePeriod?: unknown;
  content?: FhirContent[];
  relatedArtifact?: FhirRelatedArtifact[];
  library?: string[];
  extension?: FhirExtension[];
  meta?: { extension?: FhirExtension[]; versionId?: string; lastUpdated?: string; profile?: string[] };
  compose?: {
    include?: Array<{ system?: string; valueSet?: string[] }>;
  };
  expansion?: unknown;
  definition?: {
    resource?: Array<{ reference?: string | { reference?: string } }>;
  };
  contained?: FhirResource[];
  parameter?: unknown[];
  dataRequirement?: unknown[];
  issue?: FhirIssue[];
  entry?: FhirBundleEntry[];
  type?: string | { coding?: Array<{ system?: string; code?: string; display?: string }> };
  timestamp?: string;
  request?: { method?: string; url?: string; ifNoneExist?: string };
  resource?: FhirResource;
  [key: string]: unknown;
}

export interface FhirIssue {
  severity: 'fatal' | 'error' | 'warning' | 'information';
  code: string;
  details?: { text?: string };
  diagnostics?: string;
  expression?: string[];
}

export interface FhirBundleEntry {
  fullUrl?: string;
  resource?: FhirResource;
  request?: { method?: string; url?: string; ifNoneExist?: string };
}

export interface FhirBundle extends FhirResource {
  resourceType: 'Bundle';
  type: string;
  entry?: FhirBundleEntry[];
}

export function isSupportedType(type: string): type is SupportedResourceType {
  return SUPPORTED_SET.has(type);
}

export function canonicalOf(resource: FhirResource): string | undefined {
  const url = typeof resource.url === 'string' ? resource.url.trim() : '';
  if (!url) {
    return undefined;
  }
  const version = typeof resource.version === 'string' ? resource.version.trim() : '';
  return version ? `${url}|${version}` : url;
}

export function splitCanonical(canonical: string): { url: string; version?: string } {
  const pipe = canonical.indexOf('|');
  if (pipe < 0) {
    return { url: canonical.trim() };
  }
  const url = canonical.slice(0, pipe).trim();
  const version = canonical.slice(pipe + 1).trim();
  return version ? { url, version } : { url };
}

export function resourceKey(resource: FhirResource): string {
  const canon = canonicalOf(resource);
  if (canon) {
    return `${resource.resourceType}|${canon}`;
  }
  return `${resource.resourceType}|id:${resource.id ?? ''}`;
}

export function hasOwnedExtension(artifact: FhirRelatedArtifact): boolean {
  return (artifact.extension ?? []).some((ext) => {
    const url = ext.url ?? '';
    const ownedUrl = url.endsWith(OWNED_EXTENSION_SUFFIX) || url.endsWith(ARTIFACT_IS_OWNED_SUFFIX);
    return ownedUrl && ext.valueBoolean !== false;
  });
}

export function extensionValue(resource: FhirResource, url: string): string | undefined {
  const lists = [resource.extension, resource.meta?.extension];
  for (const list of lists) {
    for (const ext of list ?? []) {
      if (ext.url !== url) {
        continue;
      }
      return ext.valueCode ?? ext.valueString ?? ext.valueMarkdown ?? ext.valueCanonical ?? ext.valueUri;
    }
  }
  return undefined;
}

export function operationOutcome(issues: FhirIssue[]): FhirResource {
  return {
    resourceType: 'OperationOutcome',
    issue: issues,
  };
}

export function decodeBase64Utf8(data: string): string {
  return Buffer.from(data, 'base64').toString('utf8');
}

export function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, '');
}
