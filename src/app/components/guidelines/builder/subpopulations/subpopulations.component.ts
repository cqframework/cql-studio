// Author: Preston Lee

import { Component, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GuidelinesStateService, Subpopulation } from '../../../../services/guidelines-state.service';
import { ConjunctionGroupComponent } from '../conjunction-group/conjunction-group.component';

@Component({
  selector: 'app-subpopulations',
  standalone: true,
  imports: [CommonModule, FormsModule, ConjunctionGroupComponent],
  templateUrl: './subpopulations.component.html',
  styleUrl: './subpopulations.component.scss'
})
export class SubpopulationsComponent {
  protected readonly subpopulations = computed(() => {
    const artifact = this.guidelinesStateService.artifact();
    return artifact?.subpopulations?.filter(s => !s.special) || [];
  });

  constructor(
    private guidelinesStateService: GuidelinesStateService
  ) {}

  onAddSubpopulation(): void {
    const newSubpopulation: Subpopulation = {
      uniqueId: `subpop-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      type: 'subpopulation',
      name: '',
      fields: [],
      modifiers: [],
      returnType: 'boolean',
      conjunction: true,
      childInstances: [],
      path: '',
      subpopulationName: `Subpopulation ${this.subpopulations().length + 1}`,
      expanded: true
    };
    this.guidelinesStateService.addSubpopulation(newSubpopulation);
  }

  onUpdateSubpopulation(index: number, subpopulation: Subpopulation): void {
    this.guidelinesStateService.updateSubpopulation(index, subpopulation);
  }

  onDeleteSubpopulation(index: number): void {
    if (confirm('Are you sure you want to delete this subpopulation?')) {
      this.guidelinesStateService.deleteSubpopulation(index);
    }
  }

  onNameChange(index: number, name: string): void {
    const subpop = this.subpopulations()[index];
    if (subpop) {
      const updated = { ...subpop, subpopulationName: name };
      this.guidelinesStateService.updateSubpopulation(index, updated);
    }
  }
}

