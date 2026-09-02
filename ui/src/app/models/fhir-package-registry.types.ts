// Author: Preston Lee

/** Catalog row from GET {registry}/catalog?name= */
export interface FhirPackageCatalogEntry {
  Name: string;
  Description: string | null;
  FhirVersion: string;
}

/** NPM manifest for a FHIR package (subset of fields we use). */
export interface FhirNpmPackageManifest {
  _id?: string;
  name: string;
  description?: string;
  'dist-tags'?: { latest?: string; [tag: string]: string | undefined };
  versions: Record<
    string,
    {
      name?: string;
      version?: string;
      description?: string;
      dist?: { tarball?: string; shasum?: string };
      fhirVersion?: string;
      url?: string;
    }
  >;
}

/**
 * NPM `directories` field (see npm docs). Paths are relative to the folder that contains `package.json`
 * (the `package/` root inside the `.tgz`). Example artifacts use `example` and/or `examples`.
 */
export interface FhirPackageJsonDirectories {
  lib?: string;
  bin?: string;
  man?: string;
  doc?: string;
  /** Primary key for example scripts / instances (npm). */
  example?: string;
  /** Some packages use this key for example content. */
  examples?: string;
  test?: string;
  [key: string]: string | undefined;
}

/** FHIR package.json inside the tarball (NPM + FHIR fields). */
export interface FhirPackageJson {
  name?: string;
  version?: string;
  type?: string;
  canonical?: string;
  title?: string;
  description?: string;
  fhirVersions?: string[];
  'fhir-version-list'?: string[];
  dependencies?: Record<string, string>;
  /** Declares where example content lives; used instead of path heuristics. */
  directories?: FhirPackageJsonDirectories;
  jurisdiction?: string;
  url?: string;
  license?: string;
  author?: string;
  date?: string;
}

/** package/.index.json per FHIR spec */
export interface FhirPackageIndexFile {
  filename?: string;
  resourceType?: string;
  id?: string;
  url?: string;
  version?: string;
  kind?: string;
  type?: string;
  supplements?: string;
  content?: string;
}

export interface FhirPackageIndexJson {
  'index-version'?: number;
  files?: FhirPackageIndexFile[];
}
