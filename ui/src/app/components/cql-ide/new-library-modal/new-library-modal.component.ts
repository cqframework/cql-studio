// Author: Preston Lee

import {Component, ChangeDetectionStrategy, output, signal, computed, inject} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { LibraryService } from '../../../services/library.service';
import { IdeStateService } from '../../../services/ide-state.service';
import {
  isValidLibraryTitle,
  sanitizeLibraryTitleInput
} from '../../../services/new-cql-library.lib';

@Component({
  selector: 'app-new-library-modal',
  imports: [FormsModule],
  templateUrl: './new-library-modal.component.html',
  styleUrl: './new-library-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewLibraryModalComponent {
  create = output<string>();
  cancel = output<void>();

  private readonly libraryService = inject(LibraryService);
  private readonly ideStateService = inject(IdeStateService);

  protected readonly title = signal('');
  protected readonly errorMessage = signal('');
  protected readonly isValidating = signal(false);

  protected readonly previewUrl = computed(() => {
    const t = this.title().trim();
    if (!t || !isValidLibraryTitle(t)) {
      return '';
    }
    return this.libraryService.urlFor(t);
  });

  protected readonly canSubmit = computed(() => {
    const t = this.title().trim();
    return isValidLibraryTitle(t) && !this.isValidating();
  });

  onTitleInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const sanitized = sanitizeLibraryTitleInput(input.value);
    if (sanitized !== input.value) {
      input.value = sanitized;
    }
    this.title.set(sanitized);
    this.errorMessage.set('');
  }

  onTitleModelChange(value: string): void {
    const sanitized = sanitizeLibraryTitleInput(value);
    this.title.set(sanitized);
    this.errorMessage.set('');
  }

  async onValidateAndCreate(): Promise<void> {
    const t = this.title().trim();
    this.errorMessage.set('');

    if (!t) {
      this.errorMessage.set('Title is required');
      return;
    }

    if (!isValidLibraryTitle(t)) {
      this.errorMessage.set(
        'Title must start with a letter and contain only letters, numbers, and underscores'
      );
      return;
    }

    const openTab = this.ideStateService.libraryResources().find(lib => lib.id === t);
    if (openTab) {
      this.errorMessage.set(`A library with ID "${t}" is already open in the editor`);
      return;
    }

    this.isValidating.set(true);

    try {
      await firstValueFrom(this.libraryService.get(t));
      this.isValidating.set(false);
      this.errorMessage.set(
        `A library with ID "${t}" already exists on the server`
      );
    } catch (error: unknown) {
      const status = error instanceof HttpErrorResponse
        ? error.status
        : (error as { status?: number })?.status;

      if (status !== 404) {
        const message = error instanceof HttpErrorResponse
          ? (error.message || error.statusText)
          : (error as { message?: string })?.message;
        this.errorMessage.set(
          `Unable to validate library ID on server: ${message || 'Unknown error'}`
        );
        this.isValidating.set(false);
        return;
      }

      try {
        const existing = await firstValueFrom(
          this.libraryService.findByNameAndVersion(t, '1.0.0')
        );
        this.isValidating.set(false);
        if (existing) {
          this.errorMessage.set(
            `A library named "${t}" version 1.0.0 already exists on the server`
          );
          return;
        }
        this.create.emit(t);
      } catch (nameCheckError: unknown) {
        const message = nameCheckError instanceof HttpErrorResponse
          ? (nameCheckError.message || nameCheckError.statusText)
          : (nameCheckError as { message?: string })?.message;
        this.errorMessage.set(
          `Unable to validate library name on server: ${message || 'Unknown error'}`
        );
        this.isValidating.set(false);
      }
    }
  }

  onCancel(): void {
    this.cancel.emit();
  }
}
