// Author: Preston Lee

import { Resource } from 'fhir/r4';

/** Payload for {@link WorkspaceService.addResource}. */
export interface WorkspaceResourceLinkInput {
  resourceType: string;
  resourceId: string;
  canonicalUrl?: string | null;
  displayName?: string | null;
}

export interface WorkspaceResourceLinkSummary {
  attempted: number;
  created: number;
  alreadyLinked: number;
  failed: number;
  message: string;
}

export const WORKSPACE_RESOURCE_ALREADY_EXISTS =
  'Resource reference already exists in this workspace';

export function isWorkspaceResourceAlreadyExistsError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message.includes(WORKSPACE_RESOURCE_ALREADY_EXISTS);
}

export function displayNameFromFhirResource(
  resource: Resource & { url?: string; name?: string | { text?: string }; title?: string },
  fallbackId?: string
): string | null {
  const fromName =
    typeof resource.name === 'string'
      ? resource.name
      : resource.name && typeof resource.name === 'object'
        ? resource.name.text
        : undefined;
  const value = fromName || resource.title || fallbackId || resource.id || null;
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || null;
}

export function workspaceLinkInputFromFhirResource(
  resource: Resource & { url?: string; name?: string | { text?: string }; title?: string }
): WorkspaceResourceLinkInput | null {
  const resourceType = resource.resourceType?.trim();
  const resourceId = typeof resource.id === 'string' ? resource.id.trim() : '';
  if (!resourceType || !resourceId) {
    return null;
  }
  const url = typeof resource.url === 'string' ? resource.url.trim() : '';
  return {
    resourceType,
    resourceId,
    canonicalUrl: url || null,
    displayName: displayNameFromFhirResource(resource, resourceId),
  };
}

export function summarizeWorkspaceResourceLinks(stats: {
  attempted: number;
  created: number;
  alreadyLinked: number;
  failed: number;
}): WorkspaceResourceLinkSummary {
  const { attempted, created, alreadyLinked, failed } = stats;
  if (attempted === 0) {
    return {
      attempted,
      created,
      alreadyLinked,
      failed,
      message: '',
    };
  }
  const parts: string[] = [];
  if (created > 0) {
    parts.push(`linked ${created}`);
  }
  if (alreadyLinked > 0) {
    parts.push(`${alreadyLinked} already linked`);
  }
  if (failed > 0) {
    parts.push(`${failed} failed`);
  }
  const detail = parts.length > 0 ? parts.join(', ') : 'no changes';
  return {
    attempted,
    created,
    alreadyLinked,
    failed,
    message: `Workspace references: ${detail} (${attempted} attempt(s)).`,
  };
}
