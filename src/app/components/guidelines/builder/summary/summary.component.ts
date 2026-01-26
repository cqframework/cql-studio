// Author: Preston Lee

import { Component, computed, Input, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Library } from 'fhir/r4';
import { GuidelinesStateService } from '../../../../services/guidelines-state.service';

@Component({
  selector: 'app-summary',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './summary.component.html',
  styleUrl: './summary.component.scss'
})
export class SummaryComponent {
  @Input() library!: Library;
  @Output() metadataChange = new EventEmitter<{ field: string; value: string }>();

  protected readonly artifact = computed(() => this.guidelinesStateService.artifact());

  private guidelinesStateService = inject(GuidelinesStateService);

  onMetadataChange(field: string, value: string): void {
    this.metadataChange.emit({ field, value });
  }

  protected getInclusionsCount(): number {
    const artifact = this.artifact();
    return artifact?.expTreeInclude?.childInstances?.length || 0;
  }

  protected getExclusionsCount(): number {
    const artifact = this.artifact();
    return artifact?.expTreeExclude?.childInstances?.length || 0;
  }

  protected getSubpopulationsCount(): number {
    const artifact = this.artifact();
    return artifact?.subpopulations?.filter(s => !s.special)?.length || 0;
  }

  protected getBaseElementsCount(): number {
    const artifact = this.artifact();
    return artifact?.baseElements?.length || 0;
  }

  protected getRecommendationsCount(): number {
    const artifact = this.artifact();
    return artifact?.recommendations?.length || 0;
  }

  protected getParametersCount(): number {
    const artifact = this.artifact();
    return artifact?.parameters?.length || 0;
  }
}

