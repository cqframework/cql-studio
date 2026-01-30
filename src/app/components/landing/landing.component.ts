// Author: Preston Lee

import { Component, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SettingsService } from '../../services/settings.service';

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './landing.component.html',
  styleUrl: './landing.component.scss'
})
export class LandingComponent {
  readonly fhirBaseUrl = computed(() => this.settingsService.getEffectiveFhirBaseUrl());
  readonly terminologyBaseUrl = computed(() => this.settingsService.getEffectiveTerminologyBaseUrl());

  constructor(private readonly settingsService: SettingsService) {}
}

