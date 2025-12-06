// Author: Preston Lee

import { Component, Input, Output, EventEmitter, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CqlFunction, BaseElement, ConjunctionGroup } from '../../../../services/guidelines-state.service';
import { ConjunctionGroupComponent } from '../conjunction-group/conjunction-group.component';

const CQL_DATA_TYPES = [
  'Boolean', 'Integer', 'Long', 'Decimal', 'String', 'DateTime', 'Date', 'Time',
  'Quantity', 'Ratio', 'Code', 'Concept', 'CodeableConcept', 'Coding', 'Identifier',
  'Reference', 'Period', 'Range', 'Interval', 'List<Boolean>', 'List<Integer>',
  'List<Long>', 'List<Decimal>', 'List<String>', 'List<DateTime>', 'List<Date>',
  'List<Time>', 'List<Quantity>', 'List<Ratio>', 'List<Code>', 'List<Concept>',
  'List<CodeableConcept>', 'List<Coding>', 'List<Identifier>', 'List<Reference>',
  'List<Period>', 'List<Range>', 'List<Interval>', 'Tuple', 'Choice'
];

@Component({
  selector: 'app-guideline-function-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, ConjunctionGroupComponent],
  templateUrl: './function-editor.component.html',
  styleUrl: './function-editor.component.scss'
})
export class GuidelineFunctionEditorComponent {
  @Input() function!: CqlFunction;
  @Output() save = new EventEmitter<CqlFunction>();
  @Output() cancel = new EventEmitter<void>();

  protected readonly dataTypes = CQL_DATA_TYPES;
  protected readonly func = signal<CqlFunction>({
    id: '',
    name: '',
    returnType: 'Boolean',
    parameters: [],
    body: null,
    description: ''
  });
  protected readonly newParameterName = signal<string>('');
  protected readonly newParameterType = signal<string>('Boolean');
  protected readonly editingParamIndex = signal<number | null>(null);

  protected readonly isValid = computed(() => {
    const f = this.func();
    return f.name.trim().length > 0 &&
           /^[A-Za-z][A-Za-z0-9_]*$/.test(f.name) &&
           f.returnType.length > 0 &&
           f.body !== null;
  });

  ngOnInit(): void {
    this.func.set({ ...this.function });
    // Initialize empty body if needed
    if (!this.func().body) {
      const emptyBody: ConjunctionGroup = {
        uniqueId: `body-${Date.now()}`,
        type: 'conjunction',
        name: 'And',
        fields: [],
        modifiers: [],
        returnType: this.func().returnType,
        conjunction: true,
        childInstances: [],
        path: ''
      };
      this.func.set({ ...this.func(), body: emptyBody });
    }
  }

  onNameChange(name: string): void {
    this.func.set({ ...this.func(), name: name.trim() });
  }

  onReturnTypeChange(type: string): void {
    this.func.set({ ...this.func(), returnType: type });
    // Update body return type if it exists
    const body = this.func().body;
    if (body) {
      this.func.set({
        ...this.func(),
        body: { ...body, returnType: type }
      });
    }
  }

  onDescriptionChange(description: string): void {
    this.func.set({ ...this.func(), description: description.trim() });
  }

  onAddParameter(): void {
    const name = this.newParameterName().trim();
    const type = this.newParameterType();
    
    if (!name || !/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
      return;
    }

    // Check for duplicate parameter names
    const existing = this.func().parameters.find(p => p.name === name);
    if (existing) {
      return;
    }

    const params = [...this.func().parameters, { name, type }];
    this.func.set({ ...this.func(), parameters: params });
    this.newParameterName.set('');
    this.newParameterType.set('Boolean');
  }

  onDeleteParameter(index: number): void {
    const params = this.func().parameters.filter((_, i) => i !== index);
    this.func.set({ ...this.func(), parameters: params });
  }

  onUpdateBody(tree: ConjunctionGroup): void {
    this.func.set({ ...this.func(), body: tree });
  }

  onSave(): void {
    if (this.isValid()) {
      this.save.emit(this.func());
    }
  }

  onCancel(): void {
    this.cancel.emit();
  }

  getParameterTypes(): string[] {
    return this.dataTypes;
  }
}

