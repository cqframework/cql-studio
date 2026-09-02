// Author: Preston Lee

import semver from 'semver';

export function packageInstanceKey(name: string, version: string): string {
  return `${name}@${version}`;
}

/**
 * Pick a concrete version from registry manifest keys for an NPM-style range or exact version.
 */
export function pickResolvedVersion(availableVersions: string[], range: string): string | null {
  if (availableVersions.length === 0) {
    return null;
  }
  const semverOk = availableVersions.filter((v) => semver.valid(v) != null);
  const best = semver.maxSatisfying(semverOk.length > 0 ? semverOk : availableVersions, range, {
    includePrerelease: true
  });
  if (best) {
    return best;
  }
  if (availableVersions.includes(range)) {
    return range;
  }
  return null;
}

export function compareResolvedVersions(a: string, b: string): number {
  const ca = semver.clean(a);
  const cb = semver.clean(b);
  if (ca && cb) {
    return semver.compare(ca, cb);
  }
  return a.localeCompare(b);
}

/**
 * Topological order: every dependency name appears before any package that lists it in `directDeps`.
 */
export function topologicalImportOrder(
  names: string[],
  directDeps: (name: string) => string[]
): { order: string[]; cycleWarnings: string[] } {
  const nameSet = new Set(names);
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const n of names) {
    const deps = directDeps(n).filter((d) => nameSet.has(d));
    indegree.set(n, deps.length);
  }

  for (const p of names) {
    for (const d of directDeps(p).filter((x) => nameSet.has(x))) {
      if (!dependents.has(d)) {
        dependents.set(d, []);
      }
      dependents.get(d)!.push(p);
    }
  }

  const queue = names.filter((n) => (indegree.get(n) ?? 0) === 0);
  queue.sort((a, b) => a.localeCompare(b));

  const order: string[] = [];
  while (queue.length > 0) {
    const n = queue.shift()!;
    order.push(n);
    for (const p of dependents.get(n) ?? []) {
      const next = (indegree.get(p) ?? 0) - 1;
      indegree.set(p, next);
      if (next === 0) {
        queue.push(p);
      }
    }
    queue.sort((a, b) => a.localeCompare(b));
  }

  const cycleWarnings: string[] = [];
  if (order.length < names.length) {
    const seen = new Set(order);
    const remaining = names.filter((n) => !seen.has(n));
    cycleWarnings.push(
      `Circular dependency among: ${remaining.sort((a, b) => a.localeCompare(b)).join(', ')}. Remaining packages are appended in name order.`
    );
    for (const n of remaining.sort((a, b) => a.localeCompare(b))) {
      order.push(n);
    }
  }

  return { order, cycleWarnings };
}
