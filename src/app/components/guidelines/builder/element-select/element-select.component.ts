// Author: Preston Lee

import { Component, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BaseElement } from '../../../../services/guidelines-state.service';

@Component({
  selector: 'app-element-select',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './element-select.component.html',
  styleUrl: './element-select.component.scss'
})
export class ElementSelectComponent {
  addElement = output<BaseElement>();

  protected readonly elementTypes = [
    { value: 'condition', label: 'Condition' },
    { value: 'observation', label: 'Observation' },
    { value: 'medication', label: 'Medication' },
    { value: 'procedure', label: 'Procedure' },
    { value: 'encounter', label: 'Encounter' },
    { value: 'and', label: 'And (Conjunction)' },
    { value: 'or', label: 'Or (Conjunction)' }
  ];

  protected selectedType: string = '';

  onAddElement(): void {
    if (!this.selectedType) {
      return;
    }

    const element: BaseElement = {
      uniqueId: `element-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      type: 'baseElement',
      name: this.getDefaultName(this.selectedType),
      fields: [
        { id: 'element_name', type: 'string', value: this.getDefaultName(this.selectedType) }
      ],
      modifiers: [],
      returnType: 'boolean'
    };

    // Handle conjunction types
    if (this.selectedType === 'and' || this.selectedType === 'or') {
      element.conjunction = true;
      element.name = this.selectedType === 'and' ? 'And' : 'Or';
      element.childInstances = [];
    }

    this.addElement.emit(element);
    this.selectedType = '';
  }

  private getDefaultName(type: string): string {
    const names: { [key: string]: string } = {
      condition: 'New Condition',
      observation: 'New Observation',
      medication: 'New Medication',
      procedure: 'New Procedure',
      encounter: 'New Encounter',
      and: 'And',
      or: 'Or'
    };
    return names[type] || 'New Element';
  }
}

