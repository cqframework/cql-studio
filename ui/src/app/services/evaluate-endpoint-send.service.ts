// Author: Preston Lee

import { Injectable, computed, effect, inject, signal } from '@angular/core';
import type { CqlEnvironment } from '../models/environment.model';
import type { EvaluateEndpointInclusion } from './cql-evaluate-parameters.lib';
import { normalizeEndpointAddress } from './endpoint-config.lib';
import { EnvironmentService } from './environment.service';

export type EvaluateEndpointSendRole = 'terminology' | 'content' | 'data';

/**
 * Session toggles for whether IDE `$evaluate` includes each configured endpoint.
 * A blank profile address is always off. A present address defaults to on until
 * the user turns it off. Changing the active environment or that address clears
 * the override.
 */
@Injectable({ providedIn: 'root' })
export class EvaluateEndpointSendService {
  private readonly environmentService = inject(EnvironmentService);

  private readonly overrideKey = signal<string | null>(null);
  private readonly overrides = signal<Partial<Record<EvaluateEndpointSendRole, boolean>>>({});

  private readonly configKey = computed(() => {
    const env = this.environmentService.activeEnvironment();
    return [
      this.environmentService.activeSelectionKey(),
      this.roleAddress(env, 'terminology'),
      this.roleAddress(env, 'content'),
      this.roleAddress(env, 'data'),
    ].join('|');
  });

  readonly terminologyConfigured = computed(() => this.isConfigured('terminology'));
  readonly contentConfigured = computed(() => this.isConfigured('content'));
  readonly dataConfigured = computed(() => this.isConfigured('data'));

  readonly sendTerminology = computed(() => this.isSending('terminology'));
  readonly sendContent = computed(() => this.isSending('content'));
  readonly sendData = computed(() => this.isSending('data'));

  readonly inclusion = computed((): EvaluateEndpointInclusion => ({
    terminology: this.sendTerminology(),
    content: this.sendContent(),
    data: this.sendData(),
  }));

  constructor() {
    effect(() => {
      const key = this.configKey();
      if (this.overrideKey() !== key) {
        this.overrideKey.set(key);
        this.overrides.set({});
      }
    });
  }

  setSend(role: EvaluateEndpointSendRole, send: boolean): void {
    if (!this.isConfigured(role)) {
      return;
    }
    const key = this.configKey();
    const base = this.overrideKey() === key ? { ...this.overrides() } : {};
    base[role] = send;
    this.overrideKey.set(key);
    this.overrides.set(base);
  }

  private isConfigured(role: EvaluateEndpointSendRole): boolean {
    return this.roleAddress(this.environmentService.activeEnvironment(), role).length > 0;
  }

  private isSending(role: EvaluateEndpointSendRole): boolean {
    if (!this.isConfigured(role)) {
      return false;
    }
    const overrides = this.overrideKey() === this.configKey() ? this.overrides() : {};
    return overrides[role] ?? true;
  }

  private roleAddress(env: CqlEnvironment, role: EvaluateEndpointSendRole): string {
    return normalizeEndpointAddress(
      this.environmentService.getEndpointConfigurationForEnvironment(env, role)?.address
    );
  }
}
