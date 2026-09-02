// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { SettingsService } from './settings.service';
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';

@Injectable({
  providedIn: 'root'
})
export class SchemaValidationService {
  private readonly settingsService = inject(SettingsService);
  private ajv: Ajv;
  private resultsSchema: any = null;
  private configurationSchema: any = null;

  constructor() {
    this.ajv = new Ajv({
      allErrors: true,
      removeAdditional: false
    });
    addFormats(this.ajv);
  }

  private get resultsSchemaUrl(): string {
    const baseUrl = this.settingsService.getEffectiveRunnerApiBaseUrl();
    return `${baseUrl}/schema/results`;
  }

  private get configurationSchemaUrl(): string {
    const baseUrl = this.settingsService.getEffectiveRunnerApiBaseUrl();
    return `${baseUrl}/schema/configuration`;
  }

  private formatValidationErrors(validate: ValidateFunction): string[] {
    return validate.errors?.map((error: ErrorObject) => {
      const path = error.instancePath ? error.instancePath.substring(1) : 'root';
      return `${path}: ${error.message}`;
    }) || ['Unknown validation error'];
  }

  async validateResults(data: any): Promise<{ isValid: boolean; errors: string[] }> {
    try {
      if (!this.resultsSchema) {
        await this.loadResultsSchema();
      }
      const validate = this.ajv.compile(this.resultsSchema);
      const isValid = validate(data);
      if (isValid) {
        return { isValid: true, errors: [] };
      }
      return { isValid: false, errors: this.formatValidationErrors(validate) };
    } catch (error) {
      console.error('Error during results validation:', error);
      return {
        isValid: false,
        errors: [`Validation failed: ${(error as Error).message}`]
      };
    }
  }

  async validateConfiguration(data: any): Promise<{ isValid: boolean; errors: string[] }> {
    try {
      if (!this.configurationSchema) {
        await this.loadConfigurationSchema();
      }
      const validate = this.ajv.compile(this.configurationSchema);
      const isValid = validate(data);
      if (isValid) {
        return { isValid: true, errors: [] };
      }
      return { isValid: false, errors: this.formatValidationErrors(validate) };
    } catch (error) {
      console.error('Error during configuration validation:', error);
      return {
        isValid: false,
        errors: [`Validation failed: ${(error as Error).message}`]
      };
    }
  }

  async loadResultsSchema(): Promise<any> {
    if (this.resultsSchema) {
      return this.resultsSchema;
    }
    const response = await fetch(this.resultsSchemaUrl);
    if (!response.ok) {
      throw new Error(`Failed to load results schema from server: ${response.statusText}`);
    }
    this.resultsSchema = await response.json();
    return this.resultsSchema;
  }

  async loadConfigurationSchema(): Promise<any> {
    if (this.configurationSchema) {
      return this.configurationSchema;
    }
    const response = await fetch(this.configurationSchemaUrl);
    if (!response.ok) {
      throw new Error(`Failed to load configuration schema from server: ${response.statusText}`);
    }
    this.configurationSchema = await response.json();
    return this.configurationSchema;
  }

  getResultsSchema(): any {
    return this.resultsSchema;
  }

  getConfigurationSchema(): any {
    return this.configurationSchema;
  }
}
