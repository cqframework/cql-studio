// Author: Preston Lee

import { Component, Input, Output, EventEmitter, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Library, Patient } from 'fhir/r4';
import { LibraryService } from '../../../../services/library.service';
import { PatientService } from '../../../../services/patient.service';
import { IdeStateService } from '../../../../services/ide-state.service';
import { SettingsService } from '../../../../services/settings.service';
import { SyntaxHighlighterComponent } from '../../../shared/syntax-highlighter/syntax-highlighter.component';

@Component({
  selector: 'app-fhir-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, SyntaxHighlighterComponent],
  templateUrl: './fhir-tab.component.html',
  styleUrls: ['./fhir-tab.component.scss']
})
export class FhirTabComponent {
  @Output() saveLibrary = new EventEmitter<void>();
  @Output() deleteLibrary = new EventEmitter<void>();

  constructor(
    public libraryService: LibraryService,
    public patientService: PatientService,
    public ideStateService: IdeStateService,
    public settingsService: SettingsService,
    public router: Router
  ) {}

  public activeLibrary = computed(() => this.ideStateService.getActiveLibraryResource());
  public hasSelectedLibrary = computed(() => !!this.activeLibrary());
  public hasSelectedPatients = computed(() => this.patientService.selectedPatients.length > 0);
  public selectedPatients = computed(() => this.patientService.selectedPatients);
  public fhirServerUrl = computed(() => this.settingsService.getEffectiveFhirBaseUrl());

  onLibraryIdChange(value: string): void {
    const activeLibrary = this.activeLibrary();
    if (activeLibrary) {
      const trimmedValue = value.trim();
      
      // Don't update if the value is empty or the same as current ID
      if (!trimmedValue || trimmedValue === activeLibrary.id) {
        return;
      }
      
      const oldId = activeLibrary.id;
      const newId = trimmedValue;
      
      // Generate new URL for the new ID
      const newUrl = this.libraryService.urlFor(newId);
      
      // Update the library resource with new ID and URL
      this.ideStateService.updateLibraryResource(oldId, { 
        id: newId,
        url: newUrl
      });
      
      // Update the active library ID to point to the new ID
      this.ideStateService.selectLibraryResource(newId);
      
      // Trigger a save operation to persist the changes to the server
      this.saveLibrary.emit();
    }
  }

  onLibraryVersionChange(value: string): void {
    const activeLibrary = this.activeLibrary();
    if (activeLibrary) {
      this.ideStateService.updateLibraryResource(activeLibrary.id, { version: value });
      // Trigger a save operation to persist the changes to the server
      this.saveLibrary.emit();
    }
  }

  onLibraryDescriptionChange(value: string): void {
    const activeLibrary = this.activeLibrary();
    if (activeLibrary) {
      this.ideStateService.updateLibraryResource(activeLibrary.id, { description: value });
      // Trigger a save operation to persist the changes to the server
      this.saveLibrary.emit();
    }
  }

  onLibraryNameInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = input.value;
    
    // Remove invalid characters (only allow letters, numbers, hyphens, and underscores)
    const validValue = value.replace(/[^-a-zA-Z0-9_]/g, '');
    
    // Update the input value if it was changed
    if (validValue !== value) {
      input.value = validValue;
      // Trigger the ngModelChange to update the component state
      this.onLibraryNameChange(validValue);
    }
    
    // Add visual feedback
    this.updateInputValidation(input, validValue);
  }

  private updateInputValidation(input: HTMLInputElement, value: string): void {
    // Remove existing validation classes
    input.classList.remove('is-valid', 'is-invalid');
    
    // Add validation class based on value
    if (value.length > 0) {
      // Check if the value matches the valid pattern
      const isValid = /^[-a-zA-Z0-9_]+$/.test(value);
      input.classList.add(isValid ? 'is-valid' : 'is-invalid');
    }
  }

  onLibraryNameChange(value: string): void {
    const activeLibrary = this.activeLibrary();
    if (activeLibrary) {
      // Update only the name, not the ID
      this.ideStateService.updateLibraryResource(activeLibrary.id, { name: value });
      // Trigger a save operation to persist the changes to the server
      this.saveLibrary.emit();
    }
  }

  onLibraryTitleChange(value: string): void {
    const activeLibrary = this.activeLibrary();
    if (activeLibrary) {
      this.ideStateService.updateLibraryResource(activeLibrary.id, { title: value });
      // Trigger a save operation to persist the changes to the server
      this.saveLibrary.emit();
    }
  }

  onSaveLibrary(): void {
    this.saveLibrary.emit();
  }

  onDeleteLibrary(): void {
    this.deleteLibrary.emit();
  }

  onNavigateToSettings(): void {
    this.router.navigate(['/settings']);
  }

  libraryAsString(): string {
    const activeLibrary = this.activeLibrary();
    if (!activeLibrary) return '';

    const libraryCopy = { ...activeLibrary.library };
    if (libraryCopy) {
      libraryCopy.id = activeLibrary.id || '';
      libraryCopy.name = activeLibrary.name || '';
      libraryCopy.title = activeLibrary.title || activeLibrary.name || '';
      // libraryCopy.version = activeLibrary.version || '';
      libraryCopy.description = activeLibrary.description || '';
      libraryCopy.url = activeLibrary.url || this.libraryService.urlFor(activeLibrary.id || '');
      
      if (activeLibrary.cqlContent && activeLibrary.cqlContent.trim()) {
        libraryCopy.content = [{
          contentType: 'text/cql',
          data: btoa(activeLibrary.cqlContent)
        }];
      } else {
        libraryCopy.content = [];
      }
      
      return JSON.stringify(libraryCopy, null, 2);
    }
    return '';
  }

  patientAsString(patient?: Patient): string {
    const targetPatient = patient || this.patientService.selectedPatient;
    if (targetPatient) {
      return JSON.stringify(targetPatient, null, 2);
    }
    return '';
  }

  getPatientDisplayName(patient: Patient): string {
    // Try multiple approaches to get patient name
    if (patient.name && patient.name.length > 0) {
      const name = patient.name[0];
      const given = name.given ? name.given.join(' ') : '';
      const family = name.family || '';
      const result = `${given} ${family}`.trim();
      if (result) {
        return result;
      }
    }
    
    // Try alternative name fields
    if (patient.text && patient.text.div) {
      // Extract name from text field if available
      const textMatch = patient.text.div.match(/<div[^>]*>([^<]+)<\/div>/);
      if (textMatch && textMatch[1]) {
        return textMatch[1].trim();
      }
    }
    
    // Try identifier fields
    if (patient.identifier && patient.identifier.length > 0) {
      const identifier = patient.identifier[0];
      if (identifier.value) {
        return identifier.value;
      }
    }
    
    // Fall back to ID
    return patient.id || 'Unknown';
  }

  trackByPatientId(index: number, patient: Patient): string {
    return patient.id || index.toString();
  }

  onCopyResourceToClipboard(): void {
    const resources: string[] = [];
    
    // Add library resource if available
    if (this.hasSelectedLibrary()) {
      const libraryJson = this.libraryAsString();
      if (libraryJson) {
        resources.push(`// Library Resource\n${libraryJson}`);
      }
    }
    
    // Add patient resources if available
    if (this.hasSelectedPatients()) {
      this.selectedPatients().forEach(patient => {
        const patientJson = this.patientAsString(patient);
        if (patientJson) {
          resources.push(`// Patient Resource: ${this.getPatientDisplayName(patient)}\n${patientJson}`);
        }
      });
    }
    
    if (resources.length === 0) {
      this.ideStateService.addTextOutput(
        'Copy Failed', 
        'No FHIR resources available to copy', 
        'error'
      );
      return;
    }
    
    const combinedJson = resources.join('\n\n');
    
    // Copy to clipboard
    navigator.clipboard.writeText(combinedJson).then(() => {
      this.ideStateService.addTextOutput(
        'Resource Copied', 
        `Successfully copied ${resources.length} FHIR resource(s) to clipboard`, 
        'success'
      );
    }).catch((error) => {
      this.ideStateService.addTextOutput(
        'Copy Failed', 
        `Failed to copy to clipboard: ${error.message}`, 
        'error'
      );
    });
  }
}
