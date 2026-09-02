// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { EnvironmentService } from './environment.service';
import { SettingsService } from './settings.service';
import { IdeContextService } from './ide-context.service';
import { CqlLibrarySourceService } from './cql-library-source.service';
import { FhirCapabilityService } from './fhir-capability.service';
import { ToastService } from './toast.service';
import { WorkspaceService } from './workspace.service';
import { AuthService } from './auth.service';

@Injectable({
  providedIn: 'root'
})
export class EnvironmentSwitchService {
  private readonly environmentService = inject(EnvironmentService);
  private readonly settingsService = inject(SettingsService);
  private readonly ideContextService = inject(IdeContextService);
  private readonly librarySourceService = inject(CqlLibrarySourceService);
  private readonly fhirCapabilityService = inject(FhirCapabilityService);
  private readonly toastService = inject(ToastService);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly authService = inject(AuthService);

  private catalogLoadToken = 0;

  activateEnvironment(id: string, options?: { showToast?: boolean }): boolean {
    const previousKey = this.selectionKey();
    const env = this.environmentService.setActiveEnvironment(id);
    if (!env) {
      return false;
    }
    this.persistAndNotify(previousKey, env.name, options);
    return true;
  }

  activateWorkspaceEnvironment(
    workspaceId: string,
    environmentId: string,
    options?: { showToast?: boolean }
  ): boolean {
    const previousKey = this.selectionKey();
    const env = this.environmentService.setActiveWorkspaceEnvironment(workspaceId, environmentId);
    if (!env) {
      return false;
    }
    this.persistAndNotify(previousKey, env.name, options);
    return true;
  }

  async reloadWorkspaceCatalog(): Promise<void> {
    const previousKey = this.selectionKey();
    if (!this.authService.isAuthenticated()) {
      this.environmentService.clearWorkspaceCatalog();
      this.persistAndNotify(previousKey, this.environmentService.activeEnvironment().name, {
        showToast: false,
      });
      return;
    }
    const token = ++this.catalogLoadToken;
    try {
      const workspaces = await this.workspaceService.list();
      const previousById = new Map(
        this.environmentService.workspaceCatalog().map((entry) => [entry.workspaceId, entry])
      );
      const entries = await Promise.all(
        workspaces.map(async (ws) => {
          try {
            const environments = await this.workspaceService.listEnvironments(ws.id);
            return {
              workspaceId: ws.id,
              workspaceName: ws.name,
              environments,
            };
          } catch {
            const previous = previousById.get(ws.id);
            return {
              workspaceId: ws.id,
              workspaceName: ws.name,
              environments: previous?.environments ?? [],
            };
          }
        })
      );
      if (token !== this.catalogLoadToken) {
        return;
      }
      this.environmentService.setWorkspaceCatalog(entries);
      this.persistAndNotify(previousKey, this.environmentService.activeEnvironment().name, {
        showToast: false,
      });
    } catch {
      // Keep existing catalog entries on transient list failures, but resolve sticky workspace selection.
      this.environmentService.ensureActiveWorkspaceStillValid();
      this.persistAndNotify(previousKey, this.environmentService.activeEnvironment().name, {
        showToast: false,
      });
    }
  }

  clearWorkspaceCatalog(): void {
    const previousKey = this.selectionKey();
    this.catalogLoadToken += 1;
    this.environmentService.clearWorkspaceCatalog();
    this.persistAndNotify(previousKey, this.environmentService.activeEnvironment().name, {
      showToast: false,
    });
  }

  /** Persist selection and clear IDE/FHIR caches if catalog mutations changed the active environment. */
  afterCatalogMutation(previousKey: string): void {
    this.persistAndNotify(previousKey, this.environmentService.activeEnvironment().name, {
      showToast: false,
    });
  }

  /** Current personal/workspace selection key for cache-clear comparisons. */
  currentSelectionKey(): string {
    return this.selectionKey();
  }

  private persistAndNotify(
    previousKey: string,
    envName: string,
    options?: { showToast?: boolean }
  ): void {
    this.settingsService.persistEnvironmentToSettings();
    this.settingsService.saveSettings();
    this.afterActivation(previousKey, this.selectionKey(), envName, options);
  }

  private selectionKey(): string {
    if (this.environmentService.activeEnvironmentSource() === 'workspace') {
      const ref = this.environmentService.activeWorkspaceEnvironment();
      return ref ? `workspace:${ref.workspaceId}:${ref.environmentId}` : 'workspace:missing';
    }
    return `personal:${this.environmentService.getActiveEnvironmentIdSnapshot()}`;
  }

  private afterActivation(
    previousKey: string,
    nextKey: string,
    envName: string,
    options?: { showToast?: boolean }
  ): void {
    if (previousKey === nextKey) {
      return;
    }
    this.ideContextService.clearAllSelections();
    this.librarySourceService.invalidate();
    this.fhirCapabilityService.clearCache();
    this.fhirCapabilityService.loadMetadata();
    if (options?.showToast !== false) {
      this.toastService.showInfo(
        'Context selection and cached libraries were cleared.',
        `Environment: ${envName}`
      );
    }
  }
}
