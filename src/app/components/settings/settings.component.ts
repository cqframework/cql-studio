// Author: Preston Lee

import { Component, OnInit, viewChild, ElementRef, inject, signal } from '@angular/core';
import { SettingsService } from '../../services/settings.service';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AiProviderType, ThemeType } from '../../models/settings.model';
import { ToastService } from '../../services/toast.service';
import { ClipboardService } from '../../services/clipboard.service';
import { SettingsActionsComponent } from './settings-actions/settings-actions.component';
import { SettingsSectionNavComponent, SettingsSectionId } from './settings-section-nav/settings-section-nav.component';
import { SettingsEnvironmentsComponent } from './settings-environments/settings-environments.component';
import { OpenCodeService } from '../../services/opencode.service';

@Component({
  selector: 'app-settings',
  imports: [FormsModule, SettingsActionsComponent, SettingsSectionNavComponent, SettingsEnvironmentsComponent],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss'
})
export class SettingsComponent implements OnInit {
  importFileInput = viewChild.required<ElementRef<HTMLInputElement>>('importFileInput');

  protected readonly settingsService = inject(SettingsService);
  protected readonly router = inject(Router);
  protected readonly route = inject(ActivatedRoute);
  protected readonly toastService = inject(ToastService);
  private readonly clipboardService = inject(ClipboardService);
  private readonly openCodeService = inject(OpenCodeService);

  readonly activeSection = signal<SettingsSectionId>('environments');
  readonly providerModels = signal<string[]>([]);
  readonly modelsLoading = signal(false);
  readonly modelsError = signal<string | null>(null);

  ngOnInit() {
    // Do not reload from localStorage on every visit — that discarded live
    // patchSettings edits that had not been Saved yet. Import/Restore still reload.
    this.settingsService.setEffectiveTheme();
    const section = this.route.snapshot.queryParamMap.get('section');
    if (this.isValidSection(section)) {
      this.activeSection.set(section);
    }
  }

  reload() {
    this.settingsService.reload();
  }

  themeTypes() {
    return ThemeType;
  }

  themePreferenceChanged() {
    this.settingsService.setEffectiveTheme();
  }

  onThemePreferredChange(value: ThemeType): void {
    // Theme takes effect immediately; persist like validateSchema.
    this.settingsService.updateSettings({ theme_preferred: value });
    this.themePreferenceChanged();
  }

  onValidateSchemaChange(value: boolean): void {
    this.settingsService.updateSettings({ validateSchema: value });
  }

  onSectionChange(section: SettingsSectionId): void {
    this.activeSection.set(section);
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { section },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  onAiProviderChange(value: AiProviderType): void {
    this.settingsService.patchSettings({ aiProvider: value });
    this.providerModels.set([]);
    this.modelsError.set(null);
  }

  async refreshProviderModels(): Promise<void> {
    const settings = this.settingsService.settings();
    const type = this.settingsService.getEffectiveAiProvider();
    this.modelsLoading.set(true);
    this.modelsError.set(null);
    try {
      const models = await this.openCodeService.listProviderModels({
        type,
        ...(type === 'ollama' ? {
          baseUrl: this.settingsService.getEffectiveOllamaBaseUrl(),
          apiKey: this.settingsService.getEffectiveOllamaApiKey() || undefined,
        } : type === 'openai-compatible' ? {
          baseUrl: this.settingsService.getEffectiveCompatibleProviderBaseUrl(),
          apiKey: this.settingsService.getEffectiveCompatibleProviderApiKey() || undefined,
        } : {
          apiKey: this.settingsService.getEffectiveOpenAiApiKey() || undefined,
        }),
      });
      this.providerModels.set(models);
      const current = this.settingsService.settings();
      const currentModel = type === 'ollama' ? current.ollamaModel
        : type === 'openai' ? current.openaiModel : current.compatibleProviderModel;
      if (!currentModel.trim() && models.length > 0) {
        this.settingsService.patchSettings(type === 'ollama'
          ? { ollamaModel: models[0] }
          : type === 'openai' ? { openaiModel: models[0] } : { compatibleProviderModel: models[0] });
      }
    } catch (error) {
      this.modelsError.set(error instanceof Error ? error.message : 'Unable to load provider models.');
    } finally {
      this.modelsLoading.set(false);
    }
  }

  save() {
    this.settingsService.saveSettings();
    this.toastService.showSuccess('Settings are local to your browser only.', 'Settings Saved');
  }

  restore() {
    this.settingsService.forceResetToDefaults();
    this.toastService.showSuccess('All settings have been restored to their defaults.', 'Settings Restored');
  }

  onResetClipboard(): void {
    this.clipboardService.resetClipboard();
    this.toastService.showSuccess('Clipboard has been cleared.', 'Clipboard Reset');
  }

  onExportSettings(): void {
    const json = this.settingsService.exportSettingsJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = SettingsService.EXPORT_FILENAME;
    a.click();
    URL.revokeObjectURL(url);
    this.toastService.showSuccess('Settings exported to ' + SettingsService.EXPORT_FILENAME, 'Settings Exported');
  }

  onImportSettings(): void {
    this.importFileInput().nativeElement.click();
  }

  onImportFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      if (this.settingsService.importSettingsJson(text)) {
        this.toastService.showSuccess('Settings loaded from file.', 'Settings Imported');
      } else {
        this.toastService.showError('File is not valid settings JSON.', 'Import Failed');
      }
    };
    reader.readAsText(file);
  }

  private isValidSection(section: string | null): section is SettingsSectionId {
    return section === 'environments'
      || section === 'advanced'
      || section === 'runner'
      || section === 'registry'
      || section === 'vsac'
      || section === 'server';
  }
}
