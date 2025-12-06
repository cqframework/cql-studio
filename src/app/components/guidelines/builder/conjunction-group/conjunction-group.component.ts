// Author: Preston Lee

import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConjunctionGroup, BaseElement } from '../../../../services/guidelines-state.service';
import { ElementSelectComponent } from '../element-select/element-select.component';
import { ArtifactElementComponent } from '../base-elements/artifact-element/artifact-element.component';

@Component({
  selector: 'app-conjunction-group',
  standalone: true,
  imports: [CommonModule, ElementSelectComponent, ArtifactElementComponent],
  templateUrl: './conjunction-group.component.html',
  styleUrl: './conjunction-group.component.scss'
})
export class ConjunctionGroupComponent {
  @Input() tree!: ConjunctionGroup;
  @Input() treeName!: string;
  @Output() updateTree = new EventEmitter<ConjunctionGroup>();

  onAddElement(element: BaseElement): void {
    const updated = {
      ...this.tree,
      childInstances: [...(this.tree.childInstances || []), element]
    };
    this.updateTree.emit(updated);
  }

  onUpdateElement(index: number, element: BaseElement): void {
    const updated = {
      ...this.tree,
      childInstances: this.tree.childInstances.map((e, i) => i === index ? element : e)
    };
    this.updateTree.emit(updated);
  }

  onDeleteElement(index: number): void {
    const updated = {
      ...this.tree,
      childInstances: this.tree.childInstances.filter((_, i) => i !== index)
    };
    this.updateTree.emit(updated);
  }

  onToggleConjunction(): void {
    const updated: ConjunctionGroup = {
      ...this.tree,
      name: (this.tree.name === 'And' ? 'Or' : 'And') as 'And' | 'Or'
    };
    this.updateTree.emit(updated);
  }
}

