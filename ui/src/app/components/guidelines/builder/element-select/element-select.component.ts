// Author: Preston Lee

import { Component, ChangeDetectionStrategy, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BaseElement } from '../../../../services/guidelines-state.service';

@Component({
  selector: 'app-element-select',
  imports: [FormsModule],
  templateUrl: './element-select.component.html',
  styleUrl: './element-select.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
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
    { value: 'or', label: 'Or (Conjunction)' },
  ];

  protected readonly selectedType = signal('');

  onAddElement(): void {
    const type = this.selectedType();
    if (!type) {
      return;
    }

    const element: BaseElement = {
      uniqueId: `element-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      type: 'baseElement',
      name: this.getDefaultName(type),
      fields: [
        { id: 'element_name', type: 'string', value: this.getDefaultName(type) },
      ],
      modifiers: [],
      returnType: 'boolean',
    };

    if (type === 'and' || type === 'or') {
      element.conjunction = true;
      element.name = type === 'and' ? 'And' : 'Or';
      element.childInstances = [];
    }

    this.addElement.emit(element);
    this.selectedType.set('');
  }

  private getDefaultName(type: string): string {
    const names: { [key: string]: string } = {
      condition: 'New Condition',
      observation: 'New Observation',
      medication: 'New Medication',
      procedure: 'New Procedure',
      encounter: 'New Encounter',
      and: 'And',
      or: 'Or',
    };
    return names[type] || 'New Element';
  }
}
