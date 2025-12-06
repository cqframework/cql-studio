// Author: Preston Lee

import { Component, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GuidelinesStateService, ConjunctionGroup } from '../../../../services/guidelines-state.service';
import { ConjunctionGroupComponent } from '../conjunction-group/conjunction-group.component';

@Component({
  selector: 'app-inclusions',
  standalone: true,
  imports: [CommonModule, ConjunctionGroupComponent],
  templateUrl: './inclusions.component.html',
  styleUrl: './inclusions.component.scss'
})
export class InclusionsComponent {
  protected readonly expTreeInclude = computed(() => {
    const artifact = this.guidelinesStateService.artifact();
    return artifact?.expTreeInclude;
  });

  constructor(
    private guidelinesStateService: GuidelinesStateService
  ) {}

  onUpdateTree(tree: ConjunctionGroup): void {
    this.guidelinesStateService.updateExpTreeInclude(tree);
  }
}

