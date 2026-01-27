// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { CqlTestResults } from '../models/cql-test-results.model';
import { SettingsService } from './settings.service';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

@Injectable({
  providedIn: 'root'
})
export class SchemaValidationService {
  private readonly settingsService = inject(SettingsService);
  private ajv: Ajv;
  private schema: any = null;

  constructor() {
    this.ajv = new Ajv({ 
      allErrors: true,
      removeAdditional: false      // Don't remove unknown properties
    });
    addFormats(this.ajv);  // Add format validation support
  }

  private get schemaUrl(): string {
    const baseUrl = this.settingsService.getEffectiveRunnerApiBaseUrl();
    return `${baseUrl}/schema/results`;
  }

  async validateResults(data: any): Promise<{ isValid: boolean; errors: string[] }> {
    try {
      // Load schema if not already loaded
      if (!this.schema) {
        await this.loadSchema();
      }

      // Validate data against schema
      const validate = this.ajv.compile(this.schema);
      const isValid = validate(data);

      if (isValid) {
        return { isValid: true, errors: [] };
      } else {
        // Format Ajv errors into readable messages
        const errors = validate.errors?.map(error => {
          const path = error.instancePath ? error.instancePath.substring(1) : 'root';
          return `${path}: ${error.message}`;
        }) || ['Unknown validation error'];
        
        return { isValid: false, errors };
      }
    } catch (error) {
      console.error('Error during validation:', error);
      return { 
        isValid: false, 
        errors: [`Validation failed: ${(error as Error).message}`] 
      };
    }
  }

  async loadSchema(): Promise<any> {
    if (this.schema) {
      return this.schema;
    }

    try {
      const response = await fetch(this.schemaUrl);
      if (!response.ok) {
        throw new Error(`Failed to load schema from server: ${response.statusText}`);
      }
      
      this.schema = await response.json();
      console.log('Schema loaded successfully from server');
      return this.schema;
    } catch (error) {
      console.error('Error loading schema from server:', error);
      throw error;
    }
  }
}
