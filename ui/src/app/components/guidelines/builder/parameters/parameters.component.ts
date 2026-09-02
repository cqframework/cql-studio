// Author: Preston Lee

import {Component, ChangeDetectionStrategy, computed, inject, signal} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GuidelinesStateService, Parameter } from '../../../../services/guidelines-state.service';

@Component({
  selector: 'app-parameters',
  imports: [FormsModule],
  templateUrl: './parameters.component.html',

  styleUrl: './parameters.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ParametersComponent {
  protected readonly parameters = computed(() => {
    const artifact = this.guidelinesStateService.artifact();
    return artifact?.parameters || [];
  });

  protected readonly parameterTypes = [
    'String',
    'Integer',
    'Decimal',
    'Boolean',
    'Date',
    'DateTime',
    'Quantity'
  ];

  protected readonly newParameter = signal<Partial<Parameter>>({
    name: '',
    type: 'String',
    description: ''
  });

  protected readonly editingIndex = signal<number | null>(null);
  protected readonly editingParameter = signal<Partial<Parameter>>({});

  private guidelinesStateService = inject(GuidelinesStateService);

  onAddParameter(): void {
    const draft = this.newParameter();
    if (!draft.name || !draft.type) {
      return;
    }

    const parameter: Parameter = {
      name: draft.name,
      type: draft.type,
      description: draft.description,
      defaultValue: draft.defaultValue
    };

    this.guidelinesStateService.addParameter(parameter);
    this.newParameter.set({ name: '', type: 'String', description: '' });
  }

  onEditParameter(index: number): void {
    const param = this.parameters()[index];
    this.editingIndex.set(index);
    this.editingParameter.set({ ...param });
  }

  onSaveEdit(): void {
    const index = this.editingIndex();
    const draft = this.editingParameter();
    if (index !== null && draft.name && draft.type) {
      const parameter: Parameter = {
        name: draft.name,
        type: draft.type,
        description: draft.description,
        defaultValue: draft.defaultValue
      };
      this.guidelinesStateService.updateParameter(index, parameter);
      this.cancelEdit();
    }
  }

  cancelEdit(): void {
    this.editingIndex.set(null);
    this.editingParameter.set({});
  }

  onDeleteParameter(index: number): void {
    if (confirm('Are you sure you want to delete this parameter?')) {
      this.guidelinesStateService.deleteParameter(index);
    }
  }

  patchNewParameter(patch: Partial<Parameter>): void {
    this.newParameter.update((current) => ({ ...current, ...patch }));
  }

  patchEditingParameter(patch: Partial<Parameter>): void {
    this.editingParameter.update((current) => ({ ...current, ...patch }));
  }
}
