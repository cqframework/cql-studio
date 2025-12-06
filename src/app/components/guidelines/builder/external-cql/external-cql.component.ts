// Author: Preston Lee

import { Component, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GuidelinesStateService, ExternalCql } from '../../../../services/guidelines-state.service';

@Component({
  selector: 'app-external-cql',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './external-cql.component.html',
  styleUrl: './external-cql.component.scss'
})
export class ExternalCqlComponent {
  protected readonly externalCql = computed(() => {
    const artifact = this.guidelinesStateService.artifact();
    return artifact?.externalCql || [];
  });

  protected newExternalCql: Partial<ExternalCql> = {
    name: '',
    version: '',
    url: ''
  };

  protected editingIndex: number | null = null;
  protected editingExternalCql: Partial<ExternalCql> = {};

  constructor(
    private guidelinesStateService: GuidelinesStateService
  ) {}

  onAddExternalCql(): void {
    if (!this.newExternalCql.name) {
      return;
    }

    const externalCql: ExternalCql = {
      id: `ext-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      name: this.newExternalCql.name,
      version: this.newExternalCql.version,
      url: this.newExternalCql.url,
      functions: [],
      statements: []
    };

    this.guidelinesStateService.addExternalCql(externalCql);
    this.newExternalCql = { name: '', version: '', url: '' };
  }

  onEditExternalCql(index: number): void {
    const ext = this.externalCql()[index];
    this.editingIndex = index;
    this.editingExternalCql = { ...ext };
  }

  onSaveEdit(): void {
    if (this.editingIndex !== null && this.editingExternalCql.name) {
      const externalCql: ExternalCql = {
        id: this.editingExternalCql.id || `ext-${Date.now()}`,
        name: this.editingExternalCql.name,
        version: this.editingExternalCql.version,
        url: this.editingExternalCql.url,
        functions: this.editingExternalCql.functions || [],
        statements: this.editingExternalCql.statements || []
      };
      this.guidelinesStateService.updateExternalCql(this.editingIndex, externalCql);
      this.cancelEdit();
    }
  }

  cancelEdit(): void {
    this.editingIndex = null;
    this.editingExternalCql = {};
  }

  onDeleteExternalCql(index: number): void {
    if (confirm('Are you sure you want to delete this external CQL library?')) {
      this.guidelinesStateService.deleteExternalCql(index);
    }
  }
}

