// Author: Preston Lee

import { FhirPackageJson } from '../models/fhir-package-registry.types';

const DIRECTORY_KEYS_FOR_EXAMPLES = ['example', 'examples'] as const;

/**
 * Archive path prefixes for files that NPM marks as examples via `package.json` `directories`.
 * Paths in `directories` are relative to the folder containing `package.json` (the `package/` tree in a `.tgz`).
 */
export function archivePathPrefixesForExampleDirectories(pkg: FhirPackageJson): string[] {
  const dirs = pkg.directories;
  if (!dirs || typeof dirs !== 'object') {
    return [];
  }
  const record = dirs as Record<string, unknown>;
  const out: string[] = [];
  for (const key of DIRECTORY_KEYS_FOR_EXAMPLES) {
    const v = record[key];
    if (typeof v !== 'string') {
      continue;
    }
    const p = toArchivePrefixUnderPackage(v.trim());
    if (p) {
      out.push(p);
    }
  }
  return [...new Set(out)];
}

function toArchivePrefixUnderPackage(dir: string): string {
  if (!dir) {
    return '';
  }
  let s = dir.replace(/\\/g, '/').replace(/^\/+/, '');
  // Strip leading "./" segments (possibly repeated) before removing the trailing slash.
  s = s.replace(/^(\.\/)+/, '');
  s = s.replace(/\/+$/, '');
  if (!s) {
    return '';
  }
  // `directories.example` is already relative to the package root; avoid double-prefixing if a
  // manifest author wrote it as "package/example" instead of just "example".
  if (s === 'package' || s.startsWith('package/')) {
    s = s.slice('package'.length).replace(/^\/+/, '');
  }
  return s ? `package/${s}/` : 'package/';
}

/** Whether `filename` (archive key) is under one of the example prefixes. */
export function filenameIsUnderExamplePrefixes(filename: string, prefixes: string[]): boolean {
  if (!prefixes.length) {
    return false;
  }
  const n = filename.replace(/\\/g, '/');
  return prefixes.some((pre) => n.startsWith(pre));
}
