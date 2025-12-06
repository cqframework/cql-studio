// Author: Preston Lee

import { Injectable, signal, computed, inject } from '@angular/core';
import { LibraryService } from './library.service';
import { SettingsService } from './settings.service';
import { Library } from 'fhir/r4';

export interface BaseElement {
  uniqueId: string;
  type: string;
  name: string;
  fields: any[];
  modifiers?: any[];
  returnType?: string;
  conjunction?: boolean;
  childInstances?: BaseElement[];
  path?: string;
  usedBy?: any[];
}

export interface Parameter {
  name: string;
  type: string;
  defaultValue?: any;
  description?: string;
}

export interface CqlFunction {
  id: string;
  name: string;
  returnType: string;
  parameters: Array<{
    name: string;
    type: string;
    defaultValue?: string;
  }>;
  body: BaseElement | null; // Visual expression tree for function body
  description?: string;
}

export interface Recommendation {
  id: string;
  label: string;
  description?: string;
  subpopulations?: any[];
}

export interface ConjunctionGroup extends BaseElement {
  conjunction: true;
  name: 'And' | 'Or';
  childInstances: BaseElement[];
  path: string;
}

export interface Subpopulation extends BaseElement {
  subpopulationName: string;
  special?: boolean;
  expanded?: boolean;
}

export interface ErrorStatement {
  ifCondition?: any;
  thenClause?: any;
  elseClause?: any;
  nestedStatements?: ErrorStatement[];
}

export interface ExternalCql {
  id: string;
  name: string;
  version?: string;
  url?: string;
  functions?: any[];
  statements?: any[];
}

export interface GuidelinesArtifact {
  // CDS Connect structure matching
  expTreeInclude: ConjunctionGroup; // Inclusion criteria tree
  expTreeExclude: ConjunctionGroup; // Exclusion criteria tree
  subpopulations: Subpopulation[];
  baseElements: BaseElement[];
  recommendations: Recommendation[];
  parameters: Parameter[];
  functions: CqlFunction[];
  errorStatement?: ErrorStatement;
  externalCql: ExternalCql[];
  metadata: {
    name: string;
    title: string;
    version: string;
    description?: string;
    url?: string;
    fhirVersion?: string;
  };
}

@Injectable({
  providedIn: 'root'
})
export class GuidelinesStateService {
  private libraryService = inject(LibraryService);
  private settingsService = inject(SettingsService);

  // Artifact state
  private _artifact = signal<GuidelinesArtifact | null>(null);
  private _activeLibraryId = signal<string | null>(null);
  private _isDirty = signal<boolean>(false);
  private _isLoading = signal<boolean>(false);
  private _isSaving = signal<boolean>(false);
  private _error = signal<string | null>(null);
  private _library = signal<Library | null>(null);

  // Public computed signals
  public artifact = computed(() => this._artifact());
  public activeLibraryId = computed(() => this._activeLibraryId());
  public isDirty = computed(() => this._isDirty());
  public isLoading = computed(() => this._isLoading());
  public isSaving = computed(() => this._isSaving());
  public error = computed(() => this._error());
  public library = computed(() => this._library());

  // Initialize with empty artifact matching CDS Connect structure
  initializeEmptyArtifact(): void {
    const emptyConjunctionGroup: ConjunctionGroup = {
      uniqueId: `group-${Date.now()}`,
      type: 'conjunction',
      name: 'And',
      fields: [],
      modifiers: [],
      returnType: 'boolean',
      conjunction: true,
      childInstances: [],
      path: ''
    };

    this._artifact.set({
      expTreeInclude: { ...emptyConjunctionGroup, uniqueId: `include-${Date.now()}` },
      expTreeExclude: { ...emptyConjunctionGroup, uniqueId: `exclude-${Date.now()}` },
      subpopulations: [],
      baseElements: [],
      recommendations: [],
      parameters: [],
      functions: [],
      errorStatement: undefined,
      externalCql: [],
      metadata: {
        name: 'NewGuideline',
        title: 'New Guideline',
        version: '1.0.0',
        description: '',
        url: '',
        fhirVersion: '4.0.1'
      }
    });
    this._isDirty.set(false);
    this._error.set(null);
  }

  // Set artifact
  setArtifact(artifact: GuidelinesArtifact): void {
    this._artifact.set(artifact);
    this._isDirty.set(true);
  }

  // Update artifact metadata
  updateMetadata(metadata: Partial<GuidelinesArtifact['metadata']>): void {
    const current = this._artifact();
    if (current) {
      this._artifact.set({
        ...current,
        metadata: { ...current.metadata, ...metadata } as GuidelinesArtifact['metadata']
      });
      this._isDirty.set(true);
    }
  }

  // Base elements management
  addBaseElement(element: BaseElement): void {
    const current = this._artifact();
    if (current) {
      this._artifact.set({
        ...current,
        baseElements: [...current.baseElements, element]
      });
      this._isDirty.set(true);
    }
  }

  updateBaseElement(index: number, element: BaseElement): void {
    const current = this._artifact();
    if (current && index >= 0 && index < current.baseElements.length) {
      const updated = [...current.baseElements];
      updated[index] = element;
      this._artifact.set({
        ...current,
        baseElements: updated
      });
      this._isDirty.set(true);
    }
  }

  deleteBaseElement(index: number): void {
    const current = this._artifact();
    if (current && index >= 0 && index < current.baseElements.length) {
      const updated = current.baseElements.filter((_, i) => i !== index);
      this._artifact.set({
        ...current,
        baseElements: updated
      });
      this._isDirty.set(true);
    }
  }

  // Parameters management
  addParameter(parameter: Parameter): void {
    const current = this._artifact();
    if (current) {
      this._artifact.set({
        ...current,
        parameters: [...current.parameters, parameter]
      });
      this._isDirty.set(true);
    }
  }

  updateParameter(index: number, parameter: Parameter): void {
    const current = this._artifact();
    if (current && index >= 0 && index < current.parameters.length) {
      const updated = [...current.parameters];
      updated[index] = parameter;
      this._artifact.set({
        ...current,
        parameters: updated
      });
      this._isDirty.set(true);
    }
  }

  deleteParameter(index: number): void {
    const current = this._artifact();
    if (current && index >= 0 && index < current.parameters.length) {
      const updated = current.parameters.filter((_, i) => i !== index);
      this._artifact.set({
        ...current,
        parameters: updated
      });
      this._isDirty.set(true);
    }
  }

  // Recommendations management
  addRecommendation(recommendation: Recommendation): void {
    const current = this._artifact();
    if (current) {
      const recommendations = current.recommendations || [];
      this._artifact.set({
        ...current,
        recommendations: [...recommendations, recommendation]
      });
      this._isDirty.set(true);
    }
  }

  updateRecommendation(index: number, recommendation: Recommendation): void {
    const current = this._artifact();
    if (current && current.recommendations) {
      if (index >= 0 && index < current.recommendations.length) {
        const updated = [...current.recommendations];
        updated[index] = recommendation;
        this._artifact.set({
          ...current,
          recommendations: updated
        });
        this._isDirty.set(true);
      }
    }
  }

  deleteRecommendation(index: number): void {
    const current = this._artifact();
    if (current && current.recommendations) {
      if (index >= 0 && index < current.recommendations.length) {
        const updated = current.recommendations.filter((_, i) => i !== index);
        this._artifact.set({
          ...current,
          recommendations: updated
        });
        this._isDirty.set(true);
      }
    }
  }

  // Library management
  setActiveLibraryId(libraryId: string | null): void {
    this._activeLibraryId.set(libraryId);
  }

  setLibrary(library: Library | null): void {
    this._library.set(library);
  }

  // State management
  setLoading(loading: boolean): void {
    this._isLoading.set(loading);
  }

  setSaving(saving: boolean): void {
    this._isSaving.set(saving);
  }

  setError(error: string | null): void {
    this._error.set(error);
  }

  clearDirty(): void {
    this._isDirty.set(false);
  }

  // Inclusions/Exclusions management
  updateExpTreeInclude(tree: ConjunctionGroup): void {
    const current = this._artifact();
    if (current) {
      this._artifact.set({ ...current, expTreeInclude: tree });
      this._isDirty.set(true);
    }
  }

  updateExpTreeExclude(tree: ConjunctionGroup): void {
    const current = this._artifact();
    if (current) {
      this._artifact.set({ ...current, expTreeExclude: tree });
      this._isDirty.set(true);
    }
  }

  // Subpopulations management
  addSubpopulation(subpopulation: Subpopulation): void {
    const current = this._artifact();
    if (current) {
      this._artifact.set({
        ...current,
        subpopulations: [...current.subpopulations, subpopulation]
      });
      this._isDirty.set(true);
    }
  }

  updateSubpopulation(index: number, subpopulation: Subpopulation): void {
    const current = this._artifact();
    if (current && index >= 0 && index < current.subpopulations.length) {
      const updated = [...current.subpopulations];
      updated[index] = subpopulation;
      this._artifact.set({ ...current, subpopulations: updated });
      this._isDirty.set(true);
    }
  }

  deleteSubpopulation(index: number): void {
    const current = this._artifact();
    if (current && index >= 0 && index < current.subpopulations.length) {
      const updated = current.subpopulations.filter((_, i) => i !== index);
      this._artifact.set({ ...current, subpopulations: updated });
      this._isDirty.set(true);
    }
  }

  // Error statement management
  updateErrorStatement(errorStatement: ErrorStatement | undefined): void {
    const current = this._artifact();
    if (current) {
      this._artifact.set({ ...current, errorStatement });
      this._isDirty.set(true);
    }
  }

  // Functions management
  addFunction(func: CqlFunction): void {
    const current = this._artifact();
    if (current) {
      this._artifact.set({
        ...current,
        functions: [...(current.functions || []), func]
      });
      this._isDirty.set(true);
    }
  }

  updateFunction(index: number, func: CqlFunction): void {
    const current = this._artifact();
    if (current && current.functions && index >= 0 && index < current.functions.length) {
      const updated = [...current.functions];
      updated[index] = func;
      this._artifact.set({ ...current, functions: updated });
      this._isDirty.set(true);
    }
  }

  deleteFunction(index: number): void {
    const current = this._artifact();
    if (current && current.functions && index >= 0 && index < current.functions.length) {
      const updated = current.functions.filter((_, i) => i !== index);
      this._artifact.set({ ...current, functions: updated });
      this._isDirty.set(true);
    }
  }

  // External CQL management
  addExternalCql(externalCql: ExternalCql): void {
    const current = this._artifact();
    if (current) {
      this._artifact.set({
        ...current,
        externalCql: [...current.externalCql, externalCql]
      });
      this._isDirty.set(true);
    }
  }

  updateExternalCql(index: number, externalCql: ExternalCql): void {
    const current = this._artifact();
    if (current && index >= 0 && index < current.externalCql.length) {
      const updated = [...current.externalCql];
      updated[index] = externalCql;
      this._artifact.set({ ...current, externalCql: updated });
      this._isDirty.set(true);
    }
  }

  deleteExternalCql(index: number): void {
    const current = this._artifact();
    if (current && index >= 0 && index < current.externalCql.length) {
      const updated = current.externalCql.filter((_, i) => i !== index);
      this._artifact.set({ ...current, externalCql: updated });
      this._isDirty.set(true);
    }
  }

  // Tab metadata for visual indicators
  getTabMetadata(): {
    summary: { hasContent: boolean; hasError: boolean };
    inclusions: { hasContent: boolean; hasError: boolean };
    exclusions: { hasContent: boolean; hasError: boolean };
    subpopulations: { hasContent: boolean; hasError: boolean };
    baseElements: { hasContent: boolean; hasError: boolean };
    recommendations: { hasContent: boolean; hasError: boolean };
    parameters: { hasContent: boolean; hasError: boolean };
    functions: { hasContent: boolean; hasError: boolean };
    handleErrors: { hasContent: boolean; hasError: boolean };
    externalCql: { hasContent: boolean; hasError: boolean };
  } {
    const artifact = this._artifact();
    if (!artifact) {
      return {
        summary: { hasContent: false, hasError: false },
        inclusions: { hasContent: false, hasError: false },
        exclusions: { hasContent: false, hasError: false },
        subpopulations: { hasContent: false, hasError: false },
        baseElements: { hasContent: false, hasError: false },
        recommendations: { hasContent: false, hasError: false },
        parameters: { hasContent: false, hasError: false },
        functions: { hasContent: false, hasError: false },
        handleErrors: { hasContent: false, hasError: false },
        externalCql: { hasContent: false, hasError: false }
      };
    }

    return {
      summary: {
        hasContent: true,
        hasError: false
      },
      inclusions: {
        hasContent: artifact.expTreeInclude?.childInstances?.length > 0,
        hasError: false
      },
      exclusions: {
        hasContent: artifact.expTreeExclude?.childInstances?.length > 0,
        hasError: false
      },
      subpopulations: {
        hasContent: artifact.subpopulations?.length > 0,
        hasError: false
      },
      baseElements: {
        hasContent: artifact.baseElements?.length > 0,
        hasError: false
      },
      recommendations: {
        hasContent: artifact.recommendations?.length > 0,
        hasError: false
      },
      parameters: {
        hasContent: artifact.parameters?.length > 0,
        hasError: false
      },
      functions: {
        hasContent: artifact.functions?.length > 0,
        hasError: false
      },
      handleErrors: {
        hasContent: !!artifact.errorStatement,
        hasError: false
      },
      externalCql: {
        hasContent: artifact.externalCql?.length > 0,
        hasError: false
      }
    };
  }

  // Reset state
  reset(): void {
    this._artifact.set(null);
    this._activeLibraryId.set(null);
    this._isDirty.set(false);
    this._isLoading.set(false);
    this._isSaving.set(false);
    this._error.set(null);
    this._library.set(null);
  }
}

