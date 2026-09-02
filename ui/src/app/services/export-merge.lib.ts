// Author: Preston Lee

import { ImplementationGuide, Resource } from 'fhir/r4';
import { ExportDataSelection, IgExportOptions } from './export-data-resource.lib';
import { ExportDependencyGraph } from './export-dependency-graph.service';
import {
  exportDataResourceKey,
  filterImplementationGuide
} from './implementation-guide.lib';
import { resourceTypeOf } from './fhir-resource-type.lib';
import { isResourceType } from './fhir-resource-type.lib';

/**
 * Applies the user's sanitize choice for a single ImplementationGuide resource. Shared by
 * `mergeExportResources` and any destination-specific path (e.g. raw-cql `data/` files) that writes
 * data selections outside the merged resource list, so sanitize behavior never diverges by output.
 */
export function applyIgSanitizeIfConfigured(
  resource: Resource,
  igOptions: Record<string, IgExportOptions>
): Resource {
  if (!isResourceType(resource, 'ImplementationGuide')) {
    return resource;
  }
  const opts = igOptions[exportDataResourceKey(resource)];
  if (!opts?.sanitize) {
    return resource;
  }
  return filterImplementationGuide(
    resource,
    new Set(opts.selectedEntryKeys),
    new Set(opts.selectedGlobalIndices)
  );
}

export function mergeExportResources(
  graph: ExportDependencyGraph,
  graphKeys: ReadonlySet<string>,
  dataSelections: ExportDataSelection[],
  igOptions: Record<string, IgExportOptions>
): Resource[] {
  const seen = new Set<string>();
  const out: Resource[] = [];

  const push = (resource: Resource) => {
    const r = applyIgSanitizeIfConfigured(resource, igOptions);
    const k = exportDataResourceKey(r);
    if (seen.has(k)) {
      return;
    }
    seen.add(k);
    out.push(r);
  };

  for (const node of graph.flat) {
    if (graphKeys.has(node.key) && node.status === 'resolved' && node.resource) {
      push(node.resource);
    }
  }

  for (const sel of dataSelections) {
    push(sel.resource);
  }

  return out;
}

export function hasNonLibraryClinicalData(selections: ExportDataSelection[]): boolean {
  return selections.some((s) => {
    const rt = resourceTypeOf(s.resource);
    return rt != null && rt !== 'Library' && rt !== 'ValueSet' && rt !== 'CodeSystem';
  });
}

export function sanitizedIgCount(
  selections: ExportDataSelection[],
  igOptions: Record<string, IgExportOptions>
): number {
  return selections.filter((s) => {
    if (!isResourceType(s.resource, 'ImplementationGuide')) {
      return false;
    }
    const opts = igOptions[exportDataResourceKey(s.resource)];
    return opts?.sanitize ?? false;
  }).length;
}

export function igSyncEnabled(
  selections: ExportDataSelection[],
  igOptions: Record<string, IgExportOptions>
): boolean {
  return primaryIgForManifestSync(selections, igOptions) != null;
}

export function primaryIgForManifestSync(
  selections: ExportDataSelection[],
  igOptions: Record<string, IgExportOptions>
): ImplementationGuide | null {
  for (const sel of selections) {
    if (!isResourceType(sel.resource, 'ImplementationGuide')) {
      continue;
    }
    const opts = igOptions[exportDataResourceKey(sel.resource)];
    if (opts?.syncPackageManifest) {
      return sel.resource;
    }
  }
  return null;
}
