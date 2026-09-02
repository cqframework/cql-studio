// Author: Preston Lee

import { RegistryImportResultRow } from '../../models/fhir-package-import.types';
import { WorkspaceResourceLinkInput } from '../../services/workspace-resource-link.lib';

export function linkableImportRows(
  rows: readonly RegistryImportResultRow[]
): WorkspaceResourceLinkInput[] {
  const byKey = new Map<string, WorkspaceResourceLinkInput>();
  for (const row of rows) {
    if (!row.ok || !row.resourceId || row.resourceId === '—') {
      continue;
    }
    if (row.message.startsWith('Skipped')) {
      continue;
    }
    const resourceType = row.resourceType?.trim();
    if (!resourceType || resourceType === '—') {
      continue;
    }
    const key = `${resourceType}|${row.resourceId}`;
    if (byKey.has(key)) {
      continue;
    }
    byKey.set(key, {
      resourceType,
      resourceId: row.resourceId,
      canonicalUrl: row.canonicalUrl ?? null,
      displayName: row.displayName ?? null
    });
  }
  return [...byKey.values()];
}
