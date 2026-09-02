// Author: Preston Lee

import {Component, ChangeDetectionStrategy, input, output, computed, signal, inject} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Library } from 'fhir/r4';
import { SettingsService } from '../../../services/settings.service';
import { LibraryService } from '../../../services/library.service';

@Component({
  selector: 'app-new-guideline-modal',
  imports: [FormsModule],
  templateUrl: './new-guideline-modal.component.html',

  styleUrl: './new-guideline-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewGuidelineModalComponent {
  settingsService = input<SettingsService>();
  libraryService = input<LibraryService>();
  create = output<Partial<Library>>();
  cancel = output<void>();

  protected readonly library = signal<Partial<Library>>({
    name: '',
    title: '',
    version: '1.0.0',
    description: '',
    status: 'active'
  });

  protected readonly isVisible = signal(true);
  protected readonly errors = signal<{ [key: string]: string }>({});

  private defaultLibraryService = inject(LibraryService);

  protected readonly previewUrl = computed(() => {
    const name = this.library().name;
    if (!name) {
      return '';
    }
    const libraryId = name.replace(/[^a-zA-Z0-9-]/g, '-');
    const service = this.libraryService() || this.defaultLibraryService;
    return service.urlFor(libraryId);
  });

  patchLibrary(patch: Partial<Library>): void {
    this.library.update((current) => ({ ...current, ...patch }));
  }

  onNameChange(): void {
    this.validateName();
  }

  onVersionChange(): void {
    this.validateVersion();
  }

  private validateName(): void {
    const name = this.library().name?.trim() || '';
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
    const version = this.library().version?.trim() || '';
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

  protected isValid(): boolean {
    const name = this.library().name?.trim() || '';
    const version = this.library().version?.trim() || '';
    return name.length > 0 && version.length > 0 && Object.keys(this.errors()).length === 0;
  }

  onCreate(): void {
    this.validateName();
    this.validateVersion();
    
    if (!this.isValid()) {
      return;
    }

    const draft = { ...this.library() };
    if (!draft.version?.trim()) {
      draft.version = '1.0.0';
    }
    if (!draft.name?.trim()) {
      return;
    }

    this.create.emit(draft);
    this.isVisible.set(false);
  }

  onCancel(): void {
    this.cancel.emit();
    this.isVisible.set(false);
  }
}
