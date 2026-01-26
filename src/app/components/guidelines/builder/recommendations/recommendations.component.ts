// Author: Preston Lee

import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GuidelinesStateService, Recommendation } from '../../../../services/guidelines-state.service';

@Component({
  selector: 'app-recommendations',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './recommendations.component.html',
  styleUrl: './recommendations.component.scss'
})
export class RecommendationsComponent {
  protected readonly recommendations = computed(() => {
    const artifact = this.guidelinesStateService.artifact();
    return artifact?.recommendations || [];
  });

  protected newRecommendation: Partial<Recommendation> = {
    label: '',
    description: ''
  };

  protected editingIndex: number | null = null;
  protected editingRecommendation: Partial<Recommendation> = {};

  private guidelinesStateService = inject(GuidelinesStateService);

  onAddRecommendation(): void {
    if (!this.newRecommendation.label) {
      return;
    }

    const recommendation: Recommendation = {
      id: `rec-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      label: this.newRecommendation.label,
      description: this.newRecommendation.description,
      subpopulations: []
    };

    this.guidelinesStateService.addRecommendation(recommendation);
    this.newRecommendation = { label: '', description: '' };
  }

  onEditRecommendation(index: number): void {
    const rec = this.recommendations()[index];
    this.editingIndex = index;
    this.editingRecommendation = { ...rec };
  }

  onSaveEdit(): void {
    if (this.editingIndex !== null && this.editingRecommendation.label) {
      const recommendation: Recommendation = {
        id: this.editingRecommendation.id || `rec-${Date.now()}`,
        label: this.editingRecommendation.label,
        description: this.editingRecommendation.description,
        subpopulations: this.editingRecommendation.subpopulations || []
      };
      this.guidelinesStateService.updateRecommendation(this.editingIndex, recommendation);
      this.cancelEdit();
    }
  }

  cancelEdit(): void {
    this.editingIndex = null;
    this.editingRecommendation = {};
  }

  onDeleteRecommendation(index: number): void {
    if (confirm('Are you sure you want to delete this recommendation?')) {
      this.guidelinesStateService.deleteRecommendation(index);
    }
  }
}

