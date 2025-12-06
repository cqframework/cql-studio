// Author: Preston Lee

import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GuidelinesStateService, CqlFunction } from '../../../../services/guidelines-state.service';
import { GuidelineFunctionEditorComponent } from '../function-editor/function-editor.component';

@Component({
  selector: 'app-functions',
  standalone: true,
  imports: [CommonModule, FormsModule, GuidelineFunctionEditorComponent],
  templateUrl: './functions.component.html',
  styleUrl: './functions.component.scss'
})
export class FunctionsComponent {
  protected readonly functions = signal<CqlFunction[]>([]);
  protected readonly editingIndex = signal<number | null>(null);
  protected readonly showEditor = signal<boolean>(false);
  protected readonly editingFunction = signal<CqlFunction | null>(null);

  constructor(private guidelinesStateService: GuidelinesStateService) {
    this.updateFunctions();
  }

  private updateFunctions(): void {
    const artifact = this.guidelinesStateService.artifact();
    this.functions.set(artifact?.functions || []);
  }

  onAddFunction(): void {
    const newFunction: CqlFunction = {
      id: `func-${Date.now()}`,
      name: '',
      returnType: 'Boolean',
      parameters: [],
      body: null,
      description: ''
    };
    this.editingFunction.set(newFunction);
    this.editingIndex.set(-1);
    this.showEditor.set(true);
  }

  onEditFunction(index: number): void {
    const func = this.functions()[index];
    if (func) {
      this.editingFunction.set({ ...func });
      this.editingIndex.set(index);
      this.showEditor.set(true);
    }
  }

  onDeleteFunction(index: number): void {
    if (confirm('Are you sure you want to delete this function?')) {
      this.guidelinesStateService.deleteFunction(index);
      this.updateFunctions();
    }
  }

  onSaveFunction(func: CqlFunction): void {
    const index = this.editingIndex();
    if (index === null) {
      return;
    }

    if (index === -1) {
      this.guidelinesStateService.addFunction(func);
    } else {
      this.guidelinesStateService.updateFunction(index, func);
    }
    this.updateFunctions();
    this.onCloseEditor();
  }

  onCloseEditor(): void {
    this.showEditor.set(false);
    this.editingFunction.set(null);
    this.editingIndex.set(null);
  }

  getFunctionSignature(func: CqlFunction): string {
    const params = func.parameters.map(p => `${p.name}: ${p.type}`).join(', ');
    return `${func.name}(${params}): ${func.returnType}`;
  }
}

