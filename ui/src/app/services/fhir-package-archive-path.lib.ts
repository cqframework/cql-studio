// Author: Preston Lee

/**
 * Map keys from {@link FhirPackageTarService} match tar paths (e.g. `package/ValueSet-foo.json`).
 * `package/.index.json` entries sometimes omit the `package/` prefix or use backslashes.
 * Returns the key present in `files`, or null if none match.
 */
export function resolvePackageArchiveKey(
  filename: string,
  files: Map<string, Uint8Array>
): string | null {
  const norm = filename
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^\.\//, '');
  if (!norm) {
    return null;
  }
  const candidates: string[] = [];
  const add = (s: string) => {
    if (s && !candidates.includes(s)) {
      candidates.push(s);
    }
  };
  add(norm);
  if (!norm.startsWith('package/')) {
    add(`package/${norm}`);
  }
  if (norm.startsWith('package/')) {
    const rest = norm.slice('package/'.length);
    if (rest) {
      add(rest);
    }
  }
  for (const c of candidates) {
    if (files.has(c)) {
      return c;
    }
  }
  return null;
}

export function isFhirPackageArchiveName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.tgz') || lower.endsWith('.tar.gz');
}
