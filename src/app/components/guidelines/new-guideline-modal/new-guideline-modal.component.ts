// Author: Preston Lee

import { Component, Input, Output, EventEmitter, computed, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Library } from 'fhir/r4';
import { SettingsService } from '../../../services/settings.service';
import { LibraryService } from '../../../services/library.service';

@Component({
  selector: 'app-new-guideline-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './new-guideline-modal.component.html',
  styleUrl: './new-guideline-modal.component.scss'
})
export class NewGuidelineModalComponent {
  @Input() settingsService?: SettingsService;
  @Input() libraryService?: LibraryService;
  @Output() create = new EventEmitter<Partial<Library>>();
  @Output() cancel = new EventEmitter<void>();

  protected library: Partial<Library> = {
    name: '',
    title: '',
    version: '1.0.0',
    description: '',
    status: 'active'
  };

  protected isVisible = true;
  protected readonly errors = signal<{ [key: string]: string }>({});

  private defaultSettingsService = inject(SettingsService);
  private defaultLibraryService = inject(LibraryService);

  constructor() {
    this.isVisible = true;
    // URL is computed, so it will update automatically when name changes
  }

  protected readonly previewUrl = computed(() => {
    if (!this.library.name) {
      return '';
    }
    const libraryId = this.library.name.replace(/[^a-zA-Z0-9-]/g, '-');
    const service = this.libraryService || this.defaultLibraryService;
    return service.urlFor(libraryId);
  });

  onNameChange(): void {
    this.validateName();
    this.updatePreviewUrl();
  }

  onVersionChange(): void {
    this.validateVersion();
  }

  private validateName(): void {
    const name = this.library.name?.trim() || '';
    const errors = { ...this.errors() };
    
    if (!name) {
      errors['name'] = 'Name is required';
    } else if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
      errors['name'] = 'Name must start with a letter and contain only letters, numbers, and underscores';
    } else {
      delete errors['name'];
    }
    
    this.errors.set(errors);
  }

  private validateVersion(): void {
    const version = this.library.version?.trim() || '';
    const errors = { ...this.errors() };
    
    if (!version) {
      errors['version'] = 'Version is required';
    } else if (!/^\d+\.\d+\.\d+/.test(version)) {
      errors['version'] = 'Version should follow semantic versioning (e.g., 1.0.0)';
    } else {
      delete errors['version'];
    }
    
    this.errors.set(errors);
  }

  private updatePreviewUrl(): void {
    // URL is computed, so it will update automatically
  }

  protected isValid(): boolean {
    const name = this.library.name?.trim() || '';
    const version = this.library.version?.trim() || '';
    return name.length > 0 && version.length > 0 && Object.keys(this.errors()).length === 0;
  }

  onCreate(): void {
    // Validate all fields
    this.validateName();
    this.validateVersion();
    
    if (!this.isValid()) {
      return;
    }

    // Ensure version is not null/empty
    if (!this.library.version || !this.library.version.trim()) {
      this.library.version = '1.0.0';
    }

    // Ensure name is not null/empty
    if (!this.library.name || !this.library.name.trim()) {
      return;
    }

    this.create.emit(this.library);
    this.isVisible = false;
  }

  onCancel(): void {
    this.cancel.emit();
    this.isVisible = false;
  }
}

