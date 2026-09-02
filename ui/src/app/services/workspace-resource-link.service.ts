// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { WorkspaceService } from './workspace.service';
import {
  WorkspaceResourceLinkInput,
  WorkspaceResourceLinkSummary,
  isWorkspaceResourceAlreadyExistsError,
  summarizeWorkspaceResourceLinks,
} from './workspace-resource-link.lib';

@Injectable({
  providedIn: 'root',
})
export class WorkspaceResourceLinkService {
  private readonly workspaceService = inject(WorkspaceService);

  /**
   * Adds each resource reference to each workspace sequentially.
   * Existing refs (409 / already-exists message) count as success.
   * Failures are counted but never thrown.
   */
  async linkResourcesToWorkspaces(
    workspaceIds: string[],
    resources: WorkspaceResourceLinkInput[],
    onProgress?: (message: string) => void
  ): Promise<WorkspaceResourceLinkSummary> {
    const uniqueWorkspaceIds = [...new Set(workspaceIds.map((id) => id.trim()).filter(Boolean))];
    const linkable = resources.filter(
      (r) => r.resourceType?.trim() && r.resourceId?.trim() && r.resourceId.trim() !== '—'
    );

    let created = 0;
    let alreadyLinked = 0;
    let failed = 0;
    let attempted = 0;
    const total = uniqueWorkspaceIds.length * linkable.length;

    if (uniqueWorkspaceIds.length === 0 || linkable.length === 0) {
      return summarizeWorkspaceResourceLinks({ attempted: 0, created: 0, alreadyLinked: 0, failed: 0 });
    }

    for (let wi = 0; wi < uniqueWorkspaceIds.length; wi++) {
      const workspaceId = uniqueWorkspaceIds[wi];
      for (let ri = 0; ri < linkable.length; ri++) {
        const resource = linkable[ri];
        attempted++;
        onProgress?.(
          `Linking to workspaces… ${attempted}/${total} (${resource.resourceType}/${resource.resourceId})`
        );
        try {
          await this.workspaceService.addResource(workspaceId, {
            resourceType: resource.resourceType.trim(),
            resourceId: resource.resourceId.trim(),
            canonicalUrl: resource.canonicalUrl ?? null,
            displayName: resource.displayName ?? null,
          });
          created++;
        } catch (e) {
          if (isWorkspaceResourceAlreadyExistsError(e)) {
            alreadyLinked++;
          } else {
            failed++;
          }
        }
      }
    }

    return summarizeWorkspaceResourceLinks({ attempted, created, alreadyLinked, failed });
  }
}
