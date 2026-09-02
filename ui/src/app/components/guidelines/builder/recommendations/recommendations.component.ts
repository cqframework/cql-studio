// Author: Preston Lee

import { Component, ChangeDetectionStrategy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GuidelinesStateService, Recommendation } from '../../../../services/guidelines-state.service';

@Component({
  selector: 'app-recommendations',
  imports: [FormsModule],
  templateUrl: './recommendations.component.html',
  styleUrl: './recommendations.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecommendationsComponent {
  protected readonly recommendations = computed(() => {
    const artifact = this.guidelinesStateService.artifact();
    return artifact?.recommendations || [];
  });

  protected readonly newRecommendation = signal<Partial<Recommendation>>({
    label: '',
    description: '',
  });

  protected readonly editingIndex = signal<number | null>(null);
  protected readonly editingRecommendation = signal<Partial<Recommendation>>({});

  private guidelinesStateService = inject(GuidelinesStateService);

  onAddRecommendation(): void {
    const draft = this.newRecommendation();
    if (!draft.label) {
      return;
    }

    const recommendation: Recommendation = {
      id: `rec-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      label: draft.label,
      description: draft.description,
      subpopulations: [],
    };

    this.guidelinesStateService.addRecommendation(recommendation);
    this.newRecommendation.set({ label: '', description: '' });
  }

  onEditRecommendation(index: number): void {
    const rec = this.recommendations()[index];
    this.editingIndex.set(index);
    this.editingRecommendation.set({ ...rec });
  }

  onSaveEdit(): void {
    const index = this.editingIndex();
    const draft = this.editingRecommendation();
    if (index !== null && draft.label) {
      const recommendation: Recommendation = {
        id: draft.id || `rec-${Date.now()}`,
        label: draft.label,
        description: draft.description,
        subpopulations: draft.subpopulations || [],
      };
      this.guidelinesStateService.updateRecommendation(index, recommendation);
      this.cancelEdit();
    }
  }

  cancelEdit(): void {
    this.editingIndex.set(null);
    this.editingRecommendation.set({});
  }

  onDeleteRecommendation(index: number): void {
    if (confirm('Are you sure you want to delete this recommendation?')) {
      this.guidelinesStateService.deleteRecommendation(index);
    }
  }

  patchNewRecommendation(patch: Partial<Recommendation>): void {
    this.newRecommendation.update((current) => ({ ...current, ...patch }));
  }

  patchEditingRecommendation(patch: Partial<Recommendation>): void {
    this.editingRecommendation.update((current) => ({ ...current, ...patch }));
  }
}
