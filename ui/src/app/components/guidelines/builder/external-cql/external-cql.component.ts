// Author: Preston Lee

import { Component, ChangeDetectionStrategy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GuidelinesStateService, ExternalCql } from '../../../../services/guidelines-state.service';

@Component({
  selector: 'app-external-cql',
  imports: [FormsModule],
  templateUrl: './external-cql.component.html',
  styleUrl: './external-cql.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExternalCqlComponent {
  protected readonly externalCql = computed(() => {
    const artifact = this.guidelinesStateService.artifact();
    return artifact?.externalCql || [];
  });

  protected readonly newExternalCql = signal<Partial<ExternalCql>>({
    name: '',
    version: '',
    url: '',
  });

  protected readonly editingIndex = signal<number | null>(null);
  protected readonly editingExternalCql = signal<Partial<ExternalCql>>({});

  private guidelinesStateService = inject(GuidelinesStateService);

  onAddExternalCql(): void {
    const draft = this.newExternalCql();
    if (!draft.name) {
      return;
    }

    const externalCql: ExternalCql = {
      id: `ext-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      name: draft.name,
      version: draft.version,
      url: draft.url,
      functions: [],
      statements: [],
    };

    this.guidelinesStateService.addExternalCql(externalCql);
    this.newExternalCql.set({ name: '', version: '', url: '' });
  }

  onEditExternalCql(index: number): void {
    const ext = this.externalCql()[index];
    this.editingIndex.set(index);
    this.editingExternalCql.set({ ...ext });
  }

  onSaveEdit(): void {
    const index = this.editingIndex();
    const draft = this.editingExternalCql();
    if (index !== null && draft.name) {
      const externalCql: ExternalCql = {
        id: draft.id || `ext-${Date.now()}`,
        name: draft.name,
        version: draft.version,
        url: draft.url,
        functions: draft.functions || [],
        statements: draft.statements || [],
      };
      this.guidelinesStateService.updateExternalCql(index, externalCql);
      this.cancelEdit();
    }
  }

  cancelEdit(): void {
    this.editingIndex.set(null);
    this.editingExternalCql.set({});
  }

  onDeleteExternalCql(index: number): void {
    if (confirm('Are you sure you want to delete this external CQL library?')) {
      this.guidelinesStateService.deleteExternalCql(index);
    }
  }

  patchNewExternalCql(patch: Partial<ExternalCql>): void {
    this.newExternalCql.update((current) => ({ ...current, ...patch }));
  }

  patchEditingExternalCql(patch: Partial<ExternalCql>): void {
    this.editingExternalCql.update((current) => ({ ...current, ...patch }));
  }
}
