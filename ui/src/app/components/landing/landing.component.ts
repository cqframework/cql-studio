// Author: Preston Lee

import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { SettingsService } from '../../services/settings.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-landing',
  imports: [RouterLink],
  templateUrl: './landing.component.html',

  styleUrl: './landing.component.scss'
})
export class LandingComponent {
  private readonly settingsService = inject(SettingsService);
  private readonly router = inject(Router);
  protected readonly authService = inject(AuthService);

  readonly activeEnvironmentName = computed(() => this.settingsService.getActiveEnvironment().name);
  readonly evaluationServerUrl = computed(() => this.settingsService.getEffectiveEvaluationServerUrl());
  readonly dataEndpointUrl = computed(() => this.settingsService.getEffectiveDataEndpointAddress());
  readonly terminologyEndpointUrl = computed(() => this.settingsService.getEffectiveTerminologyEndpointAddress());
  readonly contentEndpointUrl = computed(() => this.settingsService.getEffectiveContentEndpointAddress());

  signIn(): void {
    this.authService.login(this.router.url);
  }
}
