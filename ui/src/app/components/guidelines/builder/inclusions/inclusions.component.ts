// Author: Preston Lee

import { Component, computed, inject } from '@angular/core';
import { GuidelinesStateService, ConjunctionGroup } from '../../../../services/guidelines-state.service';
import { ConjunctionGroupComponent } from '../conjunction-group/conjunction-group.component';

@Component({
  selector: 'app-inclusions',
  imports: [ConjunctionGroupComponent],
  templateUrl: './inclusions.component.html',

  styleUrl: './inclusions.component.scss'
})
export class InclusionsComponent {
  protected readonly expTreeInclude = computed(() => {
    const artifact = this.guidelinesStateService.artifact();
    return artifact?.expTreeInclude;
  });

  private guidelinesStateService = inject(GuidelinesStateService);

  onUpdateTree(tree: ConjunctionGroup): void {
    this.guidelinesStateService.updateExpTreeInclude(tree);
  }
}

