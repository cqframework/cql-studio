// Author: Preston Lee

import {Component, ChangeDetectionStrategy, input, output, signal, computed} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  isValidRenameTarget,
  normalizeRenameTarget
} from '../../../services/cql-symbol-rename.lib';

@Component({
  selector: 'app-rename-symbol-modal',
  imports: [FormsModule],
  templateUrl: './rename-symbol-modal.component.html',
  styleUrl: './rename-symbol-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RenameSymbolModalComponent {
  oldName = input.required<string>();
  confirm = output<string>();
  cancel = output<void>();

  protected readonly newName = signal('');
  protected readonly errorMessage = signal('');

  protected readonly canSubmit = computed(() => {
    const name = this.newName().trim();
    const normalized = normalizeRenameTarget(name);
    return (
      normalized.length > 0 &&
      normalized !== this.oldName() &&
      isValidRenameTarget(name) &&
      !this.errorMessage()
    );
  });

  onNameChange(value: string): void {
    this.newName.set(value);
    this.errorMessage.set('');
    const trimmed = value.trim();
    if (!trimmed) {
      this.errorMessage.set('Name is required');
      return;
    }
    if (!isValidRenameTarget(trimmed)) {
      this.errorMessage.set(
        'Use a CQL identifier, or a quoted name without embedded quotes'
      );
    }
  }

  onConfirm(): void {
    if (!this.canSubmit()) {
      return;
    }
    this.confirm.emit(normalizeRenameTarget(this.newName()));
  }

  onCancel(): void {
    this.cancel.emit();
  }
}
