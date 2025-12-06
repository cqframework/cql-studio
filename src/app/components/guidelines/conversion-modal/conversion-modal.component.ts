// Author: Preston Lee

import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Library } from 'fhir/r4';

@Component({
  selector: 'app-conversion-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './conversion-modal.component.html',
  styleUrl: './conversion-modal.component.scss'
})
export class ConversionModalComponent implements OnInit {
  @Input() library!: Library;
  @Input() issues: string[] = [];
  @Output() proceed = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();

  protected isVisible = true;

  ngOnInit(): void {
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

