// Author: Preston Lee

import { Component, input, output } from '@angular/core';

export type SettingsSectionId =
  | 'environments'
  | 'advanced'
  | 'runner'
  | 'registry'
  | 'vsac'
  | 'server';

export interface SettingsSection {
  id: SettingsSectionId;
  label: string;
  icon: string;
}

@Component({
  selector: 'app-settings-section-nav',
  templateUrl: './settings-section-nav.component.html'
})
export class SettingsSectionNavComponent {
  readonly activeSection = input.required<SettingsSectionId>();
  readonly sectionChange = output<SettingsSectionId>();

  readonly sections: SettingsSection[] = [
    { id: 'environments', label: 'Environments', icon: 'bi-globe2' },
    { id: 'advanced', label: 'Advanced', icon: 'bi-sliders' },
    { id: 'runner', label: 'Runner', icon: 'bi-play-circle' },
    { id: 'registry', label: 'Registry', icon: 'bi-box-seam' },
    { id: 'vsac', label: 'VSAC', icon: 'bi-cloud-download' },
    { id: 'server', label: 'CQL Studio Server', icon: 'bi-server' }
  ];

  select(section: SettingsSectionId): void {
    this.sectionChange.emit(section);
  }
}
