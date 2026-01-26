// Author: Preston Lee

import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GuidelinesStateService, ConjunctionGroup } from '../../../../services/guidelines-state.service';
import { ConjunctionGroupComponent } from '../conjunction-group/conjunction-group.component';

@Component({
  selector: 'app-exclusions',
  standalone: true,
  imports: [CommonModule, ConjunctionGroupComponent],
  templateUrl: './exclusions.component.html',
  styleUrl: './exclusions.component.scss'
})
export class ExclusionsComponent {
  protected readonly expTreeExclude = computed(() => {
    const artifact = this.guidelinesStateService.artifact();
    return artifact?.expTreeExclude;
  });

  private guidelinesStateService = inject(GuidelinesStateService);

  onUpdateTree(tree: ConjunctionGroup): void {
    this.guidelinesStateService.updateExpTreeExclude(tree);
  }
}

