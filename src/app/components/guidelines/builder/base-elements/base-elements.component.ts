// Author: Preston Lee

import { Component, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GuidelinesStateService, BaseElement } from '../../../../services/guidelines-state.service';
import { ArtifactElementComponent } from './artifact-element/artifact-element.component';
import { ElementSelectComponent } from '../element-select/element-select.component';

@Component({
  selector: 'app-base-elements',
  standalone: true,
  imports: [CommonModule, FormsModule, ArtifactElementComponent, ElementSelectComponent],
  templateUrl: './base-elements.component.html',
  styleUrl: './base-elements.component.scss'
})
export class BaseElementsComponent {
  protected readonly baseElements = computed(() => {
    const artifact = this.guidelinesStateService.artifact();
    return artifact?.baseElements || [];
  });

  constructor(
    private guidelinesStateService: GuidelinesStateService
  ) {}

  onAddElement(element: BaseElement): void {
    this.guidelinesStateService.addBaseElement(element);
  }

  onUpdateElement(index: number, element: BaseElement): void {
    this.guidelinesStateService.updateBaseElement(index, element);
  }

  onDeleteElement(index: number): void {
    if (confirm('Are you sure you want to delete this element?')) {
      this.guidelinesStateService.deleteBaseElement(index);
    }
  }
}

