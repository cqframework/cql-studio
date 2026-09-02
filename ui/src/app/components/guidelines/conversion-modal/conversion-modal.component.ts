// Author: Preston Lee

import {Component, ChangeDetectionStrategy, input, output, signal} from '@angular/core';
import { Library } from 'fhir/r4';

@Component({
  selector: 'app-conversion-modal',
  imports: [],
  templateUrl: './conversion-modal.component.html',

  styleUrl: './conversion-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConversionModalComponent {
  library = input.required<Library>();
  issues = input<string[]>([]);
  proceed = output<void>();
  cancel = output<void>();

  protected readonly isVisible = signal(true);

  onProceed(): void {
    this.proceed.emit();
    this.isVisible.set(false);
  }

  onCancel(): void {
    this.cancel.emit();
    this.isVisible.set(false);
  }
}
