// Author: Preston Lee

import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EnvironmentService } from '../../../services/environment.service';
import { EnvironmentSwitchService } from '../../../services/environment-switch.service';
import { SettingsService } from '../../../services/settings.service';
import { CqlEnvironment } from '../../../models/environment.model';
import { cloneEndpointConfiguration } from '../../../services/endpoint-config.lib';
import { SettingsEndpointEditorComponent } from '../settings-endpoint-editor/settings-endpoint-editor.component';

@Component({
  selector: 'app-settings-environments',
  imports: [FormsModule, SettingsEndpointEditorComponent],
  templateUrl: './settings-environments.component.html'
})
export class SettingsEnvironmentsComponent {
  private readonly environmentSwitchService = inject(EnvironmentSwitchService);
  protected readonly settingsService = inject(SettingsService);
  protected readonly environmentService = inject(EnvironmentService);

  readonly environments = this.environmentService.environments;
  readonly activeEnvironmentId = this.environmentService.activeEnvironmentId;

  readonly selectedEnvironmentId = signal<string | null>(null);
  readonly editingEnvironment = signal<CqlEnvironment | null>(null);

  readonly selectedEnvironment = computed(() => {
    const id = this.selectedEnvironmentId() ?? this.activeEnvironmentId();
    return this.environments().find(env => env.id === id) ?? this.environments()[0] ?? null;
  });

  readonly canDeleteSelected = computed(() => {
    const env = this.selectedEnvironment();
    return !!env && !env.builtIn && this.environments().length > 1;
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
    if (!env) {
      return;
    }
    this.persistEnvironment({ ...env, name });
  }

  onEvaluationServerChange(): void {
    const env = this.editingEnvironment();
    if (!env) {
      return;
    }
    this.persistEnvironment({
      ...env,
      evaluationServer: cloneEndpointConfiguration(env.evaluationServer)
    });
  }

  onDataEndpointChange(): void {
    const env = this.editingEnvironment();
    if (!env) {
      return;
    }
    this.persistEnvironment({
      ...env,
      dataEndpoint: cloneEndpointConfiguration(env.dataEndpoint)
    });
  }

  onTerminologyEndpointChange(): void {
    const env = this.editingEnvironment();
    if (!env) {
      return;
    }
    this.persistEnvironment({
      ...env,
      terminologyEndpoint: cloneEndpointConfiguration(env.terminologyEndpoint)
    });
  }

  onContentEndpointChange(): void {
    const env = this.editingEnvironment();
    if (!env) {
      return;
    }
    this.persistEnvironment({
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

  duplicateSelected(): void {
    const env = this.selectedEnvironment();
    if (!env) {
      return;
    }
    const copy = this.environmentService.duplicateEnvironment(env.id);
    if (copy) {
      this.settingsService.persistEnvironmentToSettings();
      this.settingsService.saveSettings();
      this.selectedEnvironmentId.set(copy.id);
    }
  }

  deleteSelected(): void {
    const env = this.selectedEnvironment();
    if (!env) {
      return;
    }
    if (this.environmentService.deleteEnvironment(env.id)) {
      this.settingsService.persistEnvironmentToSettings();
      this.settingsService.saveSettings();
      this.selectedEnvironmentId.set(this.activeEnvironmentId());
    }
  }

  resetBuiltIn(): void {
    this.environmentService.resetBuiltInEnvironment();
    this.settingsService.persistEnvironmentToSettings();
    this.settingsService.saveSettings();
    this.selectedEnvironmentId.set(this.activeEnvironmentId());
  }

  private persistEnvironment(updated: CqlEnvironment): void {
    this.environmentService.updateEnvironment(updated);
    this.editingEnvironment.set(this.cloneEnvironment(updated));
    this.settingsService.persistEnvironmentToSettings();
    this.settingsService.saveSettings();
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
