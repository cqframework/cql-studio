// Author: Preston Lee

import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Library } from 'fhir/r4';

@Component({
  selector: 'app-conversion-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './conversion-modal.component.html',
  styleUrl: './conversion-modal.component.scss'
})
export class ConversionModalComponent {
  library = input.required<Library>();
  issues = input<string[]>([]);
  proceed = output<void>();
  cancel = output<void>();

  protected isVisible = true;

  constructor() {
    this.isVisible = true;
  }

  onProceed(): void {
    this.proceed.emit();
    this.isVisible = false;
  }

  onCancel(): void {
    this.cancel.emit();
    this.isVisible = false;
  }
}

