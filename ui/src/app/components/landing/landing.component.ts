// Author: Preston Lee

import { Component, computed, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { SettingsService } from '../../services/settings.service';
import { AuthService } from '../../services/auth.service';
import { sanitizeReturnToPath } from '../../utils/sanitize-return-to';

@Component({
  selector: 'app-landing',
  imports: [],
  templateUrl: './landing.component.html',

  styleUrl: './landing.component.scss'
})
export class LandingComponent {
  private readonly settingsService = inject(SettingsService);
  private readonly route = inject(ActivatedRoute);
  protected readonly authService = inject(AuthService);

  readonly activeEnvironmentName = computed(() => this.settingsService.getActiveEnvironment().name);
  readonly evaluationServerUrl = computed(() => this.settingsService.getEffectiveEvaluationServerUrl());
  readonly dataEndpointUrl = computed(() => this.settingsService.getEffectiveDataEndpointAddress());
  readonly terminologyEndpointUrl = computed(() => this.settingsService.getEffectiveTerminologyEndpointAddress());
  readonly contentEndpointUrl = computed(() => this.settingsService.getEffectiveContentEndpointAddress());

  signIn(): void {
    const raw = this.route.snapshot.queryParamMap.get('returnTo');
    this.authService.login(sanitizeReturnToPath(raw));
  }
}
