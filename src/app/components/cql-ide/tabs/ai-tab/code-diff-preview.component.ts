// Author: Preston Lee

import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface CodeDiff {
  before: string;
  after: string;
  title?: string;
  description?: string;
}

@Component({
  selector: 'app-code-diff-preview',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './code-diff-preview.component.html',
  styleUrls: ['./code-diff-preview.component.scss']
})
export class CodeDiffPreviewComponent {
  @Input() diff!: CodeDiff;
  @Input() autoApply: boolean = false;
  @Output() approve = new EventEmitter<void>();
  @Output() reject = new EventEmitter<void>();

  viewMode: 'unified' | 'side-by-side' = 'unified';

  onApprove(): void {
    this.approve.emit();
  }

  onReject(): void {
    this.reject.emit();
  }

  toggleViewMode(): void {
    this.viewMode = this.viewMode === 'unified' ? 'side-by-side' : 'unified';
  }

  /**
   * Split text into lines for diff display
   */
  getLines(text: string): string[] {
    return text.split('\n');
  }

  /**
   * Simple diff line comparison
   * Handles undefined lines (when arrays have different lengths)
   */
  isLineDifferent(beforeLine: string | undefined, afterLine: string | undefined): boolean {
    // If both are undefined, they're the same
    if (beforeLine === undefined && afterLine === undefined) {
      return false;
    }
    // If one is undefined and the other isn't, they're different
    if (beforeLine === undefined || afterLine === undefined) {
      return true;
    }
    // Both defined, compare trimmed values
    return beforeLine.trim() !== afterLine.trim();
  }
}

