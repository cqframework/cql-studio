// Author: Preston Lee

import { FhirPackageJson } from './fhir-package-registry.types';
import { IndexedResourceRowVm, PackageSummaryVm } from './fhir-package-view.model';

/** Stable key for a resolved NPM package instance: `name@version`. */
export type FhirPackageInstanceKey = string;

export interface PlannedPackageEntry {
  name: string;
  version: string;
  /** Max depth from the root package following dependency edges (root = 0). */
  depth: number;
  /** Direct dependency package names present in the resolved plan. */
  dependencies: string[];
}

export interface DependencyResolveResult {
  plannedPackages: PlannedPackageEntry[];
  /** Package names in import-safe order (dependencies before dependents). */
  importOrder: string[];
  warnings: string[];
  errors: string[];
  /** One resolved row per package name (deduplicated). */
  nodesByName: Map<string, ResolvedPackageNode>;
}

export interface ResolvedPackageNode {
  name: string;
  version: string;
  pkgJson: FhirPackageJson;
}

export type PackageLoadStatus = 'pending' | 'loading' | 'loaded' | 'error';

export interface PackageImportState {
  packageKey: FhirPackageInstanceKey;
  name: string;
  version: string;
  includePackage: boolean;
  loadStatus: PackageLoadStatus;
  loadError: string | null;
  summary: PackageSummaryVm | null;
  rows: IndexedResourceRowVm[];
  files: Map<string, Uint8Array>;
}

/** One POST outcome from {@link FhirPackageImportService.importTerminologyAndData}. */
export interface FhirPackageImportItemOutcome {
  channel: string;
  resourceType: string;
  resourceId: string;
  filename: string;
  ok: boolean;
  message: string;
  canonicalUrl?: string | null;
  displayName?: string | null;
}

export interface RegistryImportResultRow extends FhirPackageImportItemOutcome {
  packageName: string;
}

export type RegistryImportResultSortColumn =
  | 'packageName'
  | 'channel'
  | 'resourceType'
  | 'resourceId'
  | 'filename'
  | 'ok'
  | 'message';
