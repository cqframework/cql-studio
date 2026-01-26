// Author: Preston Lee

import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BaseElement } from '../../../../../services/guidelines-state.service';

@Component({
  selector: 'app-artifact-element',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './artifact-element.component.html',
  styleUrl: './artifact-element.component.scss'
})
export class ArtifactElementComponent {
  element = input.required<BaseElement>();
  index = input.required<number>();
  update = output<BaseElement>();
  delete = output<void>();

  protected get elementName(): string {
    const elem = this.element();
    if (!elem) return 'Unnamed';
    const nameField = elem.fields?.find((f: any) => f.id === 'element_name');
    return nameField?.value || elem.name || 'Unnamed Element';
  }

  protected get elementType(): string {
    return this.element()?.type || 'unknown';
  }

  onNameChange(name: string): void {
    const updated = { ...this.element() };
    if (!updated.fields) {
      updated.fields = [];
    }
    const nameField = updated.fields.find((f: any) => f.id === 'element_name');
    if (nameField) {
      nameField.value = name;
    } else {
      updated.fields.push({ id: 'element_name', type: 'string', value: name });
    }
    updated.name = name;
    this.update.emit(updated);
  }

  onDelete(): void {
    this.delete.emit();
  }
}

