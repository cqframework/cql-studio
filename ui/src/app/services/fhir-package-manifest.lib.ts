// Author: Preston Lee

import {
  FhirPackageIndexFile,
  FhirPackageIndexJson,
  FhirPackageJson
} from '../models/fhir-package-registry.types';
import { Resource } from 'fhir/r4';
import { resourceTypeOf } from './fhir-resource-type.lib';

/** FHIR package name: two+ dotted namespaces, each starting with a lowercase letter. */
export const FHIR_PACKAGE_NAME_PATTERN =
  /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;

/** Loose SemVer: MAJOR.MINOR.PATCH with optional pre-release/build. */
export const FHIR_PACKAGE_VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export const DEFAULT_FHIR_CORE_PACKAGE = 'hl7.fhir.r4.core';
export const DEFAULT_FHIR_CORE_VERSION = '4.0.1';
export const DEFAULT_FHIR_VERSIONS = ['4.0.1'] as const;
export const FHIR_PACKAGE_INDEX_VERSION = 2;

export interface FhirPackageManifestInput {
  name: string;
  version: string;
  author: string;
  description: string;
  type?: string;
  canonical?: string;
  title?: string;
  url?: string;
  license?: string;
  jurisdiction?: string;
  fhirVersions?: string[];
  dependencies?: Record<string, string>;
}

export interface FhirPackageManifestValidation {
  valid: boolean;
  errors: string[];
}

export function validateFhirPackageManifestInput(
  input: FhirPackageManifestInput
): FhirPackageManifestValidation {
  const errors: string[] = [];
  const name = input.name?.trim() ?? '';
  const version = input.version?.trim() ?? '';
  const author = input.author?.trim() ?? '';
  const description = input.description?.trim() ?? '';
  const type = (input.type ?? 'Conformance').trim();

  if (!name) {
    errors.push('Package name is required.');
  } else if (!FHIR_PACKAGE_NAME_PATTERN.test(name)) {
    errors.push(
      'Package name must be two or more lowercase dotted namespaces (e.g. org.example.mypackage).'
    );
  }

  if (!version) {
    errors.push('Package version is required.');
  } else if (!FHIR_PACKAGE_VERSION_PATTERN.test(version)) {
    errors.push('Package version must be Semantic Versioning (e.g. 1.0.0).');
  }

  if (!author) {
    errors.push('Author is required.');
  }

  if (!description) {
    errors.push('Description is required.');
  }

  if (type === 'IG' && !(input.canonical?.trim())) {
    errors.push('Canonical URL is required when package type is IG.');
  }

  const deps = input.dependencies ?? {};
  if (Object.keys(deps).length === 0) {
    errors.push('Dependencies are required and must include a FHIR core package.');
  } else {
    const hasCore = Object.keys(deps).some((k) => /^hl7\.fhir\.r\d+\.core$/i.test(k));
    if (!hasCore) {
      errors.push('Dependencies must include a FHIR core package (e.g. hl7.fhir.r4.core).');
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a parsed `package/package.json` against FHIR NPM package rules
 * (https://hl7.org/fhir/packages.html). Rejects generic NPM manifests that lack
 * FHIR required fields (dotted name, semver, author, description, core dependency).
 */
export function validateFhirPackageJson(pkg: FhirPackageJson): FhirPackageManifestValidation {
  return validateFhirPackageManifestInput({
    name: pkg.name ?? '',
    version: pkg.version ?? '',
    author: fhirPackageAuthorToString(pkg.author),
    description: pkg.description ?? '',
    type: pkg.type,
    canonical: pkg.canonical,
    dependencies: pkg.dependencies
  });
}

export function fhirPackageAuthorToString(author: FhirPackageJson['author']): string {
  if (typeof author === 'string') {
    return author;
  }
  if (author != null && typeof author === 'object') {
    const obj = author as { name?: string; email?: string };
    if (typeof obj.name === 'string' && obj.name.trim()) {
      return obj.name.trim();
    }
  }
  return '';
}

export function buildFhirPackageJson(input: FhirPackageManifestInput): FhirPackageJson {
  const validation = validateFhirPackageManifestInput(input);
  if (!validation.valid) {
    throw new Error(validation.errors.join(' '));
  }

  const dependencies = {
    ...(input.dependencies ?? {
      [DEFAULT_FHIR_CORE_PACKAGE]: DEFAULT_FHIR_CORE_VERSION
    })
  };

  const pkg: FhirPackageJson = {
    name: input.name.trim(),
    version: input.version.trim(),
    author: input.author.trim(),
    description: input.description.trim(),
    type: (input.type ?? 'Conformance').trim(),
    dependencies,
    fhirVersions: [...(input.fhirVersions?.length ? input.fhirVersions : DEFAULT_FHIR_VERSIONS)]
  };

  if (input.canonical?.trim()) {
    pkg.canonical = input.canonical.trim();
  }
  if (input.title?.trim()) {
    pkg.title = input.title.trim();
  }
  if (input.url?.trim()) {
    pkg.url = input.url.trim();
  }
  if (input.license?.trim()) {
    pkg.license = input.license.trim();
  }
  if (input.jurisdiction?.trim()) {
    pkg.jurisdiction = input.jurisdiction.trim();
  }

  return pkg;
}

export function fhirPackageResourceFilename(resource: Resource, fallbackIndex: number): string {
  const rt = resourceTypeOf(resource) ?? 'Resource';
  const id = typeof (resource as unknown as { id?: string }).id === 'string'
    ? (resource as unknown as { id: string }).id.trim()
    : '';
  if (id) {
    const safe = id.replace(/[^A-Za-z0-9._-]+/g, '_');
    return `${rt}-${safe}.json`;
  }
  return `${rt}-${fallbackIndex}.json`;
}

function stringProp(resource: Resource, key: string): string | undefined {
  const value = (resource as unknown as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function buildFhirPackageIndexFile(
  filename: string,
  resource: Resource
): FhirPackageIndexFile {
  const entry: FhirPackageIndexFile = { filename };
  const resourceType = resourceTypeOf(resource);
  if (resourceType) {
    entry.resourceType = resourceType;
  }
  for (const key of ['id', 'url', 'version', 'kind', 'type', 'supplements', 'content'] as const) {
    const value = stringProp(resource, key);
    if (value) {
      entry[key] = value;
    }
  }
  return entry;
}

export function buildFhirPackageIndexJson(
  files: Array<{ filename: string; resource: Resource }>
): FhirPackageIndexJson {
  return {
    'index-version': FHIR_PACKAGE_INDEX_VERSION,
    files: files.map(({ filename, resource }) => buildFhirPackageIndexFile(filename, resource))
  };
}

export function prepareValueSetForCapability(
  vs: import('fhir/r4').ValueSet,
  capability: 'computable' | 'expanded'
): import('fhir/r4').ValueSet {
  if (capability === 'expanded') {
    if (vs.expansion) {
      const { compose: _compose, ...rest } = vs;
      return { ...rest };
    }
    return { ...vs };
  }
  // computable / minimal: prefer compose; drop expansion when compose exists
  if (vs.compose) {
    const { expansion: _expansion, ...rest } = vs;
    return { ...rest };
  }
  return { ...vs };
}
