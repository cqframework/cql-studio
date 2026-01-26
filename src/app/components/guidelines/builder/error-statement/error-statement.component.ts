// Author: Preston Lee

import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GuidelinesStateService, ErrorStatement } from '../../../../services/guidelines-state.service';

@Component({
  selector: 'app-error-statement',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './error-statement.component.html',
  styleUrl: './error-statement.component.scss'
})
export class ErrorStatementComponent {
  protected readonly errorStatement = computed(() => {
    const artifact = this.guidelinesStateService.artifact();
    return artifact?.errorStatement;
  });

  protected readonly hasErrorStatement = computed(() => !!this.errorStatement());

  private guidelinesStateService = inject(GuidelinesStateService);

  onAddErrorStatement(): void {
    const newErrorStatement: ErrorStatement = {
      ifCondition: null,
      thenClause: null,
      elseClause: null,
      nestedStatements: []
    };
    this.guidelinesStateService.updateErrorStatement(newErrorStatement);
  }

  onRemoveErrorStatement(): void {
    if (confirm('Are you sure you want to remove the error statement?')) {
      this.guidelinesStateService.updateErrorStatement(undefined);
    }
  }

  onUpdateErrorStatement(updates: Partial<ErrorStatement>): void {
    const current = this.errorStatement();
    if (current) {
      this.guidelinesStateService.updateErrorStatement({ ...current, ...updates });
    }
  }
}

