// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { FhirNpmPackageManifest, FhirPackageJson } from '../models/fhir-package-registry.types';
import {
  DependencyResolveResult,
  PlannedPackageEntry,
  ResolvedPackageNode
} from '../models/fhir-package-import.types';
import { FhirPackageRegistryService } from './fhir-package-registry.service';
import { decodeUtf8Bytes } from './utf8-encoding.lib';
import { FhirPackageTarService } from './fhir-package-tar.service';
import {
  compareResolvedVersions,
  pickResolvedVersion,
  topologicalImportOrder
} from './fhir-package-dependency-resolver.lib';

const PKG_JSON_PATH = 'package/package.json';

@Injectable({
  providedIn: 'root'
})
export class FhirPackageDependencyResolverService {
  private readonly registry = inject(FhirPackageRegistryService);
  private readonly tar = inject(FhirPackageTarService);

  /**
   * Walk `dependencies` from the root `package.json`, resolve versions from registry manifests,
   * and read each dependency's `package/package.json` from its tarball (registry manifests do not list deps).
   */
  async resolveTree(
    rootPackageName: string,
    rootVersion: string,
    rootPkgJson: FhirPackageJson
  ): Promise<DependencyResolveResult> {
    const warnings: string[] = [];
    const errors: string[] = [];
    const manifestCache = new Map<string, FhirNpmPackageManifest>();
    const nodesByName = new Map<string, ResolvedPackageNode>();

    const rootName = (rootPkgJson.name ?? rootPackageName).trim();
    nodesByName.set(rootName, {
      name: rootName,
      version: rootVersion,
      pkgJson: rootPkgJson
    });

    let changed = true;
    while (changed) {
      changed = false;
      const snapshot = [...nodesByName.entries()];
      for (const [, node] of snapshot) {
        const deps = node.pkgJson.dependencies ?? {};
        for (const [depNameRaw, rangeRaw] of Object.entries(deps)) {
          const depName = depNameRaw.trim();
          const range = String(rangeRaw).trim();
          if (!depName || !range) {
            continue;
          }

          let manifest: FhirNpmPackageManifest;
          try {
            manifest = await this.getManifestCached(depName, manifestCache);
          } catch (e) {
            errors.push(
              `${node.name}: failed to load manifest for dependency "${depName}": ${e instanceof Error ? e.message : String(e)}`
            );
            continue;
          }

          const versionKeys = Object.keys(manifest.versions ?? {});
          const resolved = pickResolvedVersion(versionKeys, range);
          if (!resolved) {
            errors.push(
              `${node.name}: no published version satisfies "${depName}" @ "${range}" (registry has: ${versionKeys.length} version(s)).`
            );
            continue;
          }

          const existing = nodesByName.get(depName);
          if (existing) {
            if (existing.version === resolved) {
              continue;
            }
            const preferred =
              compareResolvedVersions(resolved, existing.version) >= 0 ? resolved : existing.version;
            const other = preferred === resolved ? existing.version : resolved;
            warnings.push(
              `Dependency "${depName}" was required as "${other}" and "${preferred}"; using ${preferred} (higher of the two).`
            );
            if (preferred === existing.version) {
              continue;
            }
            changed = true;
            await this.upsertNodeFromTarball(depName, preferred, manifest, nodesByName, errors);
            continue;
          }

          changed = true;
          await this.upsertNodeFromTarball(depName, resolved, manifest, nodesByName, errors);
        }
      }
    }

    const names = [...nodesByName.keys()].sort((a, b) => a.localeCompare(b));
    const directDeps = (n: string) => {
      const pkg = nodesByName.get(n)?.pkgJson.dependencies ?? {};
      return Object.keys(pkg)
        .map((k) => k.trim())
        .filter((d) => nodesByName.has(d));
    };

    const { order: importOrder, cycleWarnings } = topologicalImportOrder(names, directDeps);
    warnings.push(...cycleWarnings);

    const depthMap = this.shortestDepthFromRoot(rootName, names, directDeps);
    const plannedPackages: PlannedPackageEntry[] = importOrder.map((name) => {
      const n = nodesByName.get(name)!;
      return {
        name,
        version: n.version,
        depth: depthMap.get(name) ?? 0,
        dependencies: directDeps(name)
      };
    });

    return {
      plannedPackages,
      importOrder,
      warnings,
      errors,
      nodesByName
    };
  }

  private async getManifestCached(
    packageId: string,
    cache: Map<string, FhirNpmPackageManifest>
  ): Promise<FhirNpmPackageManifest> {
    const hit = cache.get(packageId);
    if (hit) {
      return hit;
    }
    const m = await this.registry.getPackageManifest(packageId);
    cache.set(packageId, m);
    return m;
  }

  private async upsertNodeFromTarball(
    depName: string,
    resolved: string,
    manifest: FhirNpmPackageManifest,
    nodesByName: Map<string, ResolvedPackageNode>,
    errors: string[]
  ): Promise<void> {
    const ver = manifest.versions?.[resolved];
    const tarballUrl = ver?.dist?.tarball;
    if (!tarballUrl) {
      errors.push(`No tarball URL in manifest for "${depName}" @ "${resolved}".`);
      return;
    }
    try {
      const buf = await this.registry.fetchTarball(tarballUrl);
      const part = this.tar.extractTarGzPaths(buf, new Set([PKG_JSON_PATH]));
      const raw = part.get(PKG_JSON_PATH);
      if (!raw) {
        errors.push(`Tarball for "${depName}" @ "${resolved}" has no ${PKG_JSON_PATH}.`);
        return;
      }
      const text = decodeUtf8Bytes(raw, { fatal: false });
      const pkgJson = JSON.parse(text) as FhirPackageJson;
      nodesByName.set(depName, {
        name: depName,
        version: resolved,
        pkgJson
      });
    } catch (e) {
      errors.push(
        `Failed to read ${PKG_JSON_PATH} for "${depName}" @ "${resolved}": ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  private shortestDepthFromRoot(
    root: string,
    names: string[],
    directDeps: (name: string) => string[]
  ): Map<string, number> {
    const depth = new Map<string, number>();
    const q: { n: string; d: number }[] = [{ n: root, d: 0 }];
    depth.set(root, 0);
    while (q.length > 0) {
      const { n, d } = q.shift()!;
      for (const x of directDeps(n)) {
        const next = d + 1;
        if (!depth.has(x) || next < depth.get(x)!) {
          depth.set(x, next);
          q.push({ n: x, d: next });
        }
      }
    }
    for (const name of names) {
      if (!depth.has(name)) {
        depth.set(name, 0);
      }
    }
    return depth;
  }
}
