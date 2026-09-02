// Author: Preston Lee

import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EnvironmentService } from '../../../services/environment.service';
import { EnvironmentSwitchService } from '../../../services/environment-switch.service';
import { SettingsService } from '../../../services/settings.service';
import { CqlEnvironment } from '../../../models/environment.model';
import { cloneEndpointConfiguration } from '../../../services/endpoint-config.lib';
import { SettingsEndpointEditorComponent } from '../settings-endpoint-editor/settings-endpoint-editor.component';
import { ToastService } from '../../../services/toast.service';

@Component({
  selector: 'app-settings-environments',
  imports: [FormsModule, SettingsEndpointEditorComponent],
  templateUrl: './settings-environments.component.html'
})
export class SettingsEnvironmentsComponent {
  private readonly environmentSwitchService = inject(EnvironmentSwitchService);
  private readonly toastService = inject(ToastService);
  protected readonly settingsService = inject(SettingsService);
  protected readonly environmentService = inject(EnvironmentService);

  readonly environments = this.environmentService.environments;
  readonly activeEnvironmentId = this.environmentService.activeEnvironmentId;

  readonly selectedEnvironmentId = signal<string | null>(null);
  readonly editingEnvironment = signal<CqlEnvironment | null>(null);

  readonly defaultEvaluationServerUrl = computed(
    () => this.environments().find((env) => env.builtIn)?.evaluationServer.address ?? ''
  );

  readonly selectedEnvironment = computed(() => {
    const id = this.selectedEnvironmentId() ?? this.activeEnvironmentId();
    return this.environments().find(env => env.id === id) ?? this.environments()[0] ?? null;
  });

  readonly canDeleteSelected = computed(() => {
    const env = this.selectedEnvironment();
    return !!env && !env.builtIn;
  });

  readonly isActiveSelected = computed(() => {
    const env = this.selectedEnvironment();
    return !!env && this.environmentService.isPersonalEnvironmentSelected(env.id);
  });

  constructor() {
    effect(() => {
      const env = this.selectedEnvironment();
      if (env) {
        this.editingEnvironment.set(this.cloneEnvironment(env));
      }
    });
  }

  selectEnvironment(id: string): void {
    this.selectedEnvironmentId.set(id);
  }

  updateSelectedName(name: string): void {
    const env = this.editingEnvironment();
    if (!env || env.builtIn) {
      return;
    }
    void this.persistEnvironment({ ...env, name });
  }

  onEvaluationServerChange(): void {
    const env = this.editingEnvironment();
    if (!env || env.builtIn) {
      return;
    }
    void this.persistEnvironment({
      ...env,
      evaluationServer: cloneEndpointConfiguration(env.evaluationServer)
    });
  }

  onDataEndpointChange(): void {
    const env = this.editingEnvironment();
    if (!env || env.builtIn) {
      return;
    }
    void this.persistEnvironment({
      ...env,
      dataEndpoint: cloneEndpointConfiguration(env.dataEndpoint)
    });
  }

  onTerminologyEndpointChange(): void {
    const env = this.editingEnvironment();
    if (!env || env.builtIn) {
      return;
    }
    void this.persistEnvironment({
      ...env,
      terminologyEndpoint: cloneEndpointConfiguration(env.terminologyEndpoint)
    });
  }

  onContentEndpointChange(): void {
    const env = this.editingEnvironment();
    if (!env || env.builtIn) {
      return;
    }
    void this.persistEnvironment({
      ...env,
      contentEndpoint: cloneEndpointConfiguration(env.contentEndpoint)
    });
  }

  setAsActive(): void {
    const env = this.selectedEnvironment();
    if (!env) {
      return;
    }
    this.environmentSwitchService.activateEnvironment(env.id);
  }

  async duplicateSelected(): Promise<void> {
    const env = this.selectedEnvironment();
    if (!env) {
      return;
    }
    const copy = this.environmentService.duplicateEnvironment(env.id);
    if (!copy) {
      return;
    }
    try {
      const saved = await this.settingsService.persistEnvironment(copy);
      this.selectedEnvironmentId.set(saved.id);
    } catch (err) {
      this.environmentService.deleteEnvironment(copy.id);
      this.toastService.showError(
        err instanceof Error ? err.message : 'Failed to save environment',
        'Environment'
      );
    }
  }

  async deleteSelected(): Promise<void> {
    const env = this.selectedEnvironment();
    if (!env || env.builtIn) {
      return;
    }
    if (!this.environmentService.deleteEnvironment(env.id)) {
      return;
    }
    try {
      await this.settingsService.deletePersonalEnvironment(env.id);
      this.selectedEnvironmentId.set(this.activeEnvironmentId());
    } catch (err) {
      this.toastService.showError(
        err instanceof Error ? err.message : 'Failed to delete environment',
        'Environment'
      );
      await this.settingsService.reloadFromServer();
    }
  }

  resetBuiltIn(): void {
    this.environmentService.resetBuiltInEnvironment();
    this.selectedEnvironmentId.set(this.activeEnvironmentId());
  }

  private async persistEnvironment(updated: CqlEnvironment): Promise<void> {
    if (updated.builtIn) {
      return;
    }
    this.environmentService.updateEnvironment(updated);
    this.editingEnvironment.set(this.cloneEnvironment(updated));
    try {
      const saved = await this.settingsService.persistEnvironment(updated);
      this.editingEnvironment.set(this.cloneEnvironment(saved));
      if (this.selectedEnvironmentId() === updated.id || !this.selectedEnvironmentId()) {
        this.selectedEnvironmentId.set(saved.id);
      }
    } catch (err) {
      this.toastService.showError(
        err instanceof Error ? err.message : 'Failed to save environment',
        'Environment'
      );
    }
  }

  private cloneEnvironment(env: CqlEnvironment): CqlEnvironment {
    return {
      id: env.id,
      name: env.name,
      builtIn: env.builtIn,
      evaluationServer: cloneEndpointConfiguration(env.evaluationServer),
      dataEndpoint: cloneEndpointConfiguration(env.dataEndpoint),
      terminologyEndpoint: cloneEndpointConfiguration(env.terminologyEndpoint),
      contentEndpoint: cloneEndpointConfiguration(env.contentEndpoint)
    };
  }
}
