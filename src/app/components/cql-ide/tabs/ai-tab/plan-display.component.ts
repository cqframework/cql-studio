// Author: Preston Lee

import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Plan, PlanStep } from '../../../../models/plan.model';

@Component({
  selector: 'app-plan-display',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './plan-display.component.html',
  styleUrls: ['./plan-display.component.scss']
})
export class PlanDisplayComponent {
  @Input() plan!: Plan;
  @Input() editable: boolean = true;
  @Input() executing: boolean = false;
  
  @Output() execute = new EventEmitter<void>();
  @Output() revise = new EventEmitter<void>();

  getStepStatusIcon(step: PlanStep): string {
    switch (step.status) {
      case 'completed':
        return 'bi-check-circle-fill';
      case 'in-progress':
        return 'bi-arrow-repeat';
      case 'failed':
        return 'bi-x-circle-fill';
      default:
        return 'bi-circle';
    }
  }

  getStepStatusClass(step: PlanStep): string {
    switch (step.status) {
      case 'completed':
        return 'step-completed';
      case 'in-progress':
        return 'step-in-progress';
      case 'failed':
        return 'step-failed';
      default:
        return 'step-pending';
    }
  }

  onExecute(): void {
    this.execute.emit();
  }

  onRevise(): void {
    this.revise.emit();
  }
}

