// Author: Preston Lee

import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GuidelinesStateService, Parameter } from '../../../../services/guidelines-state.service';

@Component({
  selector: 'app-parameters',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './parameters.component.html',
  styleUrl: './parameters.component.scss'
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

  protected newParameter: Partial<Parameter> = {
    name: '',
    type: 'String',
    description: ''
  };

  protected editingIndex: number | null = null;
  protected editingParameter: Partial<Parameter> = {};

  private guidelinesStateService = inject(GuidelinesStateService);

  onAddParameter(): void {
    if (!this.newParameter.name || !this.newParameter.type) {
      return;
    }

    const parameter: Parameter = {
      name: this.newParameter.name,
      type: this.newParameter.type,
      description: this.newParameter.description,
      defaultValue: this.newParameter.defaultValue
    };

    this.guidelinesStateService.addParameter(parameter);
    this.newParameter = { name: '', type: 'String', description: '' };
  }

  onEditParameter(index: number): void {
    const param = this.parameters()[index];
    this.editingIndex = index;
    this.editingParameter = { ...param };
  }

  onSaveEdit(): void {
    if (this.editingIndex !== null && this.editingParameter.name && this.editingParameter.type) {
      const parameter: Parameter = {
        name: this.editingParameter.name,
        type: this.editingParameter.type,
        description: this.editingParameter.description,
        defaultValue: this.editingParameter.defaultValue
      };
      this.guidelinesStateService.updateParameter(this.editingIndex, parameter);
      this.cancelEdit();
    }
  }

  cancelEdit(): void {
    this.editingIndex = null;
    this.editingParameter = {};
  }

  onDeleteParameter(index: number): void {
    if (confirm('Are you sure you want to delete this parameter?')) {
      this.guidelinesStateService.deleteParameter(index);
    }
  }
}

