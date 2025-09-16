// Author: Preston Lee

import { Component, OnInit } from '@angular/core';
import { SettingsService } from '../../services/settings.service';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ThemeType } from '../../models/settings.model';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss'
})
export class SettingsComponent implements OnInit {

  constructor(
    protected settingsService: SettingsService,
    public location: Location,
    protected router: Router,
  ) {
  }

  ngOnInit() {
    this.reload();
  }

  reload() {
    this.settingsService.reload();
  }

  themeTypes() {
    return ThemeType;
  }

  themePreferenceChanged($event: any) {
    this.settingsService.setEffectiveTheme();
  }

  onValidateSchemaChange(): void {
    this.settingsService.saveSettings();
  }

  save() {
    this.settingsService.saveSettings();
    // Simple alert instead of toastr for now
    alert("Settings are local to your browser only. Settings Saved");
    this.location.back();
  }

  restore() {
    this.settingsService.forceResetToDefaults();
    // Simple alert instead of toastr for now
    alert("All settings have been restored to their defaults. Settings Restored");
  }

  back() {
    this.location.back();
  }
}

