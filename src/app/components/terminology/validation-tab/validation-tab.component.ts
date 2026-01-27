// Author: Preston Lee

import { Component, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { SettingsService } from '../../../services/settings.service';
import { TerminologyService } from '../../../services/terminology.service';
import { ToastService } from '../../../services/toast.service';

interface ValidationResult {
  valid: boolean;
  message?: string;
  display?: string;
}

@Component({
  selector: 'app-validation-tab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './validation-tab.component.html',
  styleUrl: './validation-tab.component.scss'
})
export class ValidationTabComponent {

  // Code validation
  protected readonly validationCode = signal<string>('');
  protected readonly validationSystem = signal<string>('');
  protected readonly validationValueSet = signal<string>('');
  protected readonly validationResult = signal<ValidationResult | null>(null);
  protected readonly validationLoading = signal<boolean>(false);
  protected readonly validationError = signal<string | null>(null);

  // Configuration status
  protected readonly hasValidConfiguration = computed(() => {
    const baseUrl = this.settingsService.getEffectiveTerminologyBaseUrl();
    return baseUrl.trim() !== '';
  });

  protected settingsService = inject(SettingsService);
  private terminologyService = inject(TerminologyService);
  private toastService = inject(ToastService);

  // Code validation operations
  async validateCode(): Promise<void> {
    if (!this.hasValidConfiguration()) {
      const errorMessage = 'Please configure terminology service settings first.';
      this.validationError.set(errorMessage);
      this.toastService.showWarning(errorMessage, 'Configuration Required');
      return;
    }

    const code = this.validationCode().trim();
    const system = this.validationSystem().trim();
    const valueset = this.validationValueSet().trim();

    if (!code || !system) {
      const errorMessage = 'Please enter both code and system.';
      this.validationError.set(errorMessage);
      this.toastService.showWarning(errorMessage, 'Validation Input Required');
      return;
    }

    this.validationLoading.set(true);
    this.validationError.set(null);

    try {
      const params: any = {
        code: code,
        system: system
      };

      if (valueset) {
        params.url = valueset;
      }

      const result = await firstValueFrom(this.terminologyService.validateCode(params));

      // Parse validation result
      const validParam = result?.parameter?.find(p => p.name === 'result');
      const displayParam = result?.parameter?.find(p => p.name === 'display');

      this.validationResult.set({
        valid: validParam?.valueBoolean || false,
        message: validParam?.valueBoolean ? 'Code is valid' : 'Code is not valid',
        display: displayParam?.valueString
      });
    } catch (error) {
      const errorMessage = this.getErrorMessage(error);
      this.validationError.set(errorMessage);
      this.toastService.showError(errorMessage, 'Code Validation Failed');
    } finally {
      this.validationLoading.set(false);
    }
  }

  private getErrorMessage(error: any): string {
    if (error?.status === 401 || error?.status === 403) {
      return 'Authentication failed. The terminology server may require authentication. Please check your authorization bearer token in Settings.';
    }
    if (error?.status === 404) {
      return 'Server responded with 404 error: not found.';
    }
    if (error?.status >= 500) {
      return 'Server error. Please try again later.';
    }
    return error?.message || 'An unexpected error occurred.';
  }
}
