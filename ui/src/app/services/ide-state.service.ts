// Author: Preston Lee

import { Injectable, signal, computed, inject } from '@angular/core';
import { IdePanel, IdePanelTab, IdePanelState } from '../components/cql-ide/panels/ide-panel-tab.interface';
import { LibraryResource, EditorFile, ExecutionResult, OutputSection, OutputType } from '../components/cql-ide/shared/ide-types';
import { Library, Patient, Parameters } from 'fhir/r4';

export interface IdeFindReferenceLocation {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  preview: string;
  kind: string;
}

export interface IdeFindReferencesResult {
  symbolName: string;
  locations: IdeFindReferenceLocation[];
}

export interface IdeValuesetPeekCode {
  system?: string;
  code?: string;
  display?: string;
}

export interface IdeValuesetPeekResult {
  name: string;
  url: string;
  id: string;
  codes: IdeValuesetPeekCode[];
  truncated: boolean;
  error?: string;
}

export interface IdeRenameSymbolRequest {
  libraryId: string;
  oldName: string;
  kind?: 'expression' | 'function';
}

/** Scopes for tab data invalidation. When data changes (e.g. library deleted from server), call invalidateTabData(scope) so tabs that display that data can refresh. Tabs subscribe via effect(() => tabDataInvalidation()[scope]). */
export const TabDataScope = {
  LibraryList: 'libraryList',
  // Add more as needed: PatientList: 'patientList', Outline: 'outline', etc.
} as const;
export type TabDataScopeKey = keyof typeof TabDataScope;

export interface EditorState {
  cursorPosition: { line: number; column: number } | undefined;
  wordCount: number | undefined;
  syntaxErrors: string[];
  isValidSyntax: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class IdeStateService {
  // Panel state
  private _panelState = signal<IdePanelState>({
    left: {
      id: 'left',
      isVisible: true,
      size: 300,
      tabs: [],
      activeTabId: null,
      minSize: 300,
      maxSize: 10000,
      position: 'left',
      resizeHandleDirection: 'right'
    },
    right: {
      id: 'right',
      isVisible: true,
      // Give the OpenCode/FHIR side pane enough width for tool activity,
      // command help, and model/provider details without wrapping every label.
      size: 380,
      tabs: [],
      activeTabId: null,
      minSize: 300,
      maxSize: 10000,
      position: 'right',
      resizeHandleDirection: 'left'
    },
    bottom: {
      id: 'bottom',
      isVisible: true,
      size: 300,
      tabs: [],
      activeTabId: null,
      minSize: 100,
      maxSize: 600,
      position: 'bottom',
      resizeHandleDirection: 'top'
    }
  });

  // Editor state
  private _editorState = signal<EditorState>({
    cursorPosition: undefined,
    wordCount: undefined,
    syntaxErrors: [],
    isValidSyntax: true
  });

  // Library resources
  private _libraryResources = signal<LibraryResource[]>([]);
  private _activeLibraryId = signal<string | null>(null);
  // Signal to trigger editor reloads
  private _reloadTrigger = signal<{ libraryId: string; timestamp: number } | null>(null);

  // Editor files
  private _editorFiles = signal<EditorFile[]>([]);
  private _activeFileId = signal<string | null>(null);

  // Execution state
  private _isExecuting = signal<boolean>(false);
  private _isEvaluating = signal<boolean>(false);
  private _isTranslating = signal<boolean>(false);
  private _executionResults = signal<any>(null);
  private _outputSections = signal<OutputSection[]>([]);
  private _executionProgress = signal<number>(0);
  private _executionStatus = signal<string>('');
  private _preserveLogs = signal<boolean>(false);

  // FHIR data
  private _selectedPatients = signal<Patient[]>([]);
  private _library = signal<Library | null>(null);
  private _evaluationResults = signal<Parameters | null>(null);
  private _elmTranslationResults = signal<string | null>(null);
  private _translationErrors = signal<string[]>([]);
  private _translationWarnings = signal<string[]>([]);
  private _translationMessages = signal<string[]>([]);

  // Drag and drop
  private _draggedTab = signal<IdePanelTab | null>(null);
  private _dragOverPanel = signal<string | null>(null);

  // Editor action requests (for tool orchestrator)
  private _navigateToLineRequest = signal<number | null>(null);
  private _formatCodeRequest = signal<boolean>(false);
  private _pendingEditorNavigation = signal<{
    libraryId: string;
    line: number;
    column: number;
  } | null>(null);

  private _findReferencesResult = signal<IdeFindReferencesResult | null>(null);
  private _valuesetPeekResult = signal<IdeValuesetPeekResult | null>(null);
  private _renameSymbolRequest = signal<IdeRenameSymbolRequest | null>(null);

  /** Per-scope invalidation counts. Tabs use effect(() => this.tabDataInvalidation()[scope]) and refresh when their scope's count increases. */
  private _tabDataInvalidation = signal<Record<string, number>>({});

  // Public computed signals
  public panelState = computed(() => this._panelState());
  public editorState = computed(() => this._editorState());
  public libraryResources = computed(() => this._libraryResources());
  public activeLibraryId = computed(() => this._activeLibraryId());
  public reloadTrigger = computed(() => this._reloadTrigger());
  public editorFiles = computed(() => this._editorFiles());
  public activeFileId = computed(() => this._activeFileId());
  public isExecuting = computed(() => this._isExecuting());
  public isEvaluating = computed(() => this._isEvaluating());
  public isTranslating = computed(() => this._isTranslating());
  public executionResults = computed(() => this._executionResults());
  public outputSections = computed(() => this._outputSections());
  public executionProgress = computed(() => this._executionProgress());
  public executionStatus = computed(() => this._executionStatus());
  public preserveLogs = computed(() => this._preserveLogs());
  public selectedPatients = computed(() => this._selectedPatients());
  public library = computed(() => this._library());
  public evaluationResults = computed(() => this._evaluationResults());
  public elmTranslationResults = computed(() => this._elmTranslationResults());
  public translationErrors = computed(() => this._translationErrors());
  public translationWarnings = computed(() => this._translationWarnings());
  public translationMessages = computed(() => this._translationMessages());
  public draggedTab = computed(() => this._draggedTab());
  public dragOverPanel = computed(() => this._dragOverPanel());
  public navigateToLineRequest = computed(() => this._navigateToLineRequest());
  public formatCodeRequest = computed(() => this._formatCodeRequest());
  public pendingEditorNavigation = computed(() => this._pendingEditorNavigation());
  /** Prefer asReadonly so tab templates subscribe to the same producer CodeMirror writers update. */
  public findReferencesResult = this._findReferencesResult.asReadonly();
  public valuesetPeekResult = this._valuesetPeekResult.asReadonly();
  /**
   * Monotonic revision bumped when IDE chrome must refresh under zoneless CD
   * (CodeMirror actions are outside Angular's event system).
   */
  private _uiRevision = signal(0);
  public uiRevision = this._uiRevision.asReadonly();
  public renameSymbolRequest = computed(() => this._renameSymbolRequest());
  /** Per-scope invalidation counts. Tabs subscribe in an effect and refresh when their scope's count increases (see invalidateTabData). */
  public tabDataInvalidation = computed(() => this._tabDataInvalidation());
  public activeLibraryIsReadOnly = computed(() => this.getActiveLibraryResource()?.isReadOnly ?? false);
  public activeLibraryContentLoadError = computed(() => this.getActiveLibraryResource()?.contentLoadError ?? null);

  // Panel management
  updatePanelState(updates: Partial<IdePanelState>): void {
    this._panelState.update(state => ({ ...state, ...updates }));
  }

  updatePanel(panelId: string, updates: Partial<IdePanel>): void {
    this._panelState.update(state => ({
      ...state,
      [panelId]: { ...state[panelId as keyof IdePanelState], ...updates }
    }));
  }

  addTabToPanel(panelId: string, tab: IdePanelTab): void {
    this._panelState.update(state => {
      const panel = state[panelId as keyof IdePanelState];
      const updatedPanel = {
        ...panel,
        tabs: [...panel.tabs, tab],
        // Keep the existing active tab; only default when the panel was empty.
        activeTabId: panel.activeTabId ?? tab.id
      };
      return { ...state, [panelId]: updatedPanel };
    });
  }

  removeTabFromPanel(panelId: string, tabId: string): void {
    this._panelState.update(state => {
      const panel = state[panelId as keyof IdePanelState];
      const updatedTabs = panel.tabs.filter(tab => tab.id !== tabId);
      const updatedPanel = {
        ...panel,
        tabs: updatedTabs,
        activeTabId: updatedTabs.length > 0 ? updatedTabs[0].id : null
      };
      return { ...state, [panelId]: updatedPanel };
    });
  }

  clearPanelTabs(panelId: string): void {
    this._panelState.update(state => {
      const panel = state[panelId as keyof IdePanelState];
      const updatedPanel = {
        ...panel,
        tabs: [],
        activeTabId: null
      };
      return { ...state, [panelId]: updatedPanel };
    });
  }

  setActiveTab(panelId: string, tabId: string): void {
    this._panelState.update(state => {
      const panel = state[panelId as keyof IdePanelState];
      const updatedTabs = panel.tabs.map(tab => ({
        ...tab,
        isActive: tab.id === tabId
      }));
      const updatedPanel = {
        ...panel,
        tabs: updatedTabs,
        activeTabId: tabId
      };
      return { ...state, [panelId]: updatedPanel };
    });
  }

  togglePanel(panelId: string): void {
    this._panelState.update(state => {
      const panel = state[panelId as keyof IdePanelState];
      return { ...state, [panelId]: { ...panel, isVisible: !panel.isVisible } };
    });
  }

  setPanelSize(panelId: string, size: number): void {
    this._panelState.update(state => {
      const panel = state[panelId as keyof IdePanelState];
      const clampedSize = Math.max(panel.minSize, Math.min(panel.maxSize, size));
      return { ...state, [panelId]: { ...panel, size: clampedSize } };
    });
  }

  /** Notify that tab data for the given scope is stale. Tabs that display that data should refresh (e.g. Navigation tab for TabDataScope.LibraryList). */
  invalidateTabData(scope: string): void {
    this._tabDataInvalidation.update(m => ({ ...m, [scope]: (m[scope] ?? 0) + 1 }));
  }

  // Editor state management
  updateEditorState(updates: Partial<EditorState>): void {
    this._editorState.update(state => ({ ...state, ...updates }));
  }

  setExecuting(executing: boolean): void {
    this._isExecuting.set(executing);
  }

  setEvaluating(evaluating: boolean): void {
    this._isEvaluating.set(evaluating);
  }

  setTranslating(translating: boolean): void {
    this._isTranslating.set(translating);
  }

  setExecutionResults(results: any): void {
    this._executionResults.set(results);
  }

  setOutputSections(sections: OutputSection[]): void {
    // setOutputSections should always replace the sections (used for state updates like expand/collapse)
    this._outputSections.set(sections);
  }

  addOutputSection(section: OutputSection): void {
    this.addOutputSections([section]);
  }

  addOutputSections(sections: OutputSection[]): void {
    if (sections.length === 0) {
      return;
    }
    if (!this._preserveLogs()) {
      this._outputSections.set(sections);
    } else {
      this._outputSections.update(existing => [...existing, ...sections]);
    }
  }

  // Convenience methods for different output types
  addTextOutput(title: string, content: string, status: 'success' | 'error' | 'pending' = 'success'): void {
    const section: OutputSection = {
      id: this.generateOutputId(),
      title,
      content,
      type: 'text',
      status,
      expanded: true,
      timestamp: new Date()
    };
    this.addOutputSection(section);
  }

  addJsonOutput(title: string, content: string, status: 'success' | 'error' | 'pending' = 'success'): void {
    const section: OutputSection = {
      id: this.generateOutputId(),
      title,
      content,
      type: 'json',
      status,
      expanded: false,
      timestamp: new Date()
    };
    this.addOutputSection(section);
  }

  addErrorOutput(title: string, content: string): void {
    const section: OutputSection = {
      id: this.generateOutputId(),
      title,
      content,
      type: 'error',
      status: 'error',
      expanded: false,
      timestamp: new Date()
    };
    this.addOutputSection(section);
  }

  addWarningOutput(title: string, content: string): void {
    const section: OutputSection = {
      id: this.generateOutputId(),
      title,
      content,
      type: 'warning',
      status: 'success',
      expanded: false,
      timestamp: new Date()
    };
    this.addOutputSection(section);
  }

  addInfoOutput(title: string, content: string): void {
    const section: OutputSection = {
      id: this.generateOutputId(),
      title,
      content,
      type: 'info',
      status: 'success',
      expanded: false,
      timestamp: new Date()
    };
    this.addOutputSection(section);
  }

  addCustomOutput(title: string, content: string, type: OutputType, metadata?: Record<string, any>): void {
    const section: OutputSection = {
      id: this.generateOutputId(),
      title,
      content,
      type,
      status: 'success',
      expanded: false,
      timestamp: new Date(),
      metadata
    };
    this.addOutputSection(section);
  }

  private generateOutputId(): string {
    return `output_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // CQL-specific output methods
  addCqlExecutionOutput(libraryName: string, patientName: string, result: any, executionTime: number): void {
    const section: OutputSection = {
      id: this.generateOutputId(),
      title: `CQL Execution: ${libraryName}`,
      content: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
      type: 'custom',
      status: 'success',
      expanded: false,
      timestamp: new Date(),
      executionTime,
      metadata: {
        libraryName,
        patientName,
        resultType: typeof result
      }
    };
    this.addOutputSection(section);
  }

  addCqlTranslationOutput(libraryName: string, cqlVersion: string, elmContent: string): void {
    const section: OutputSection = {
      id: this.generateOutputId(),
      title: `CQL Translation: ${libraryName}`,
      content: elmContent,
      type: 'custom',
      status: 'success',
      expanded: false,
      timestamp: new Date(),
      metadata: {
        libraryName,
        cqlVersion,
        contentType: 'elm'
      }
    };
    this.addOutputSection(section);
  }

  addCqlValidationOutput(libraryName: string, validationResults: any, errorCount: number): void {
    const section: OutputSection = {
      id: this.generateOutputId(),
      title: `CQL Validation: ${libraryName}`,
      content: typeof validationResults === 'string' ? validationResults : JSON.stringify(validationResults, null, 2),
      type: 'custom',
      status: errorCount > 0 ? 'error' : 'success',
      expanded: false,
      timestamp: new Date(),
      metadata: {
        libraryName,
        errorCount,
        validationType: 'cql'
      }
    };
    this.addOutputSection(section);
  }

  clearOutputSections(): void {
    this._outputSections.set([]);
  }

  setExecutionProgress(progress: number): void {
    this._executionProgress.set(progress);
  }

  setExecutionStatus(status: string): void {
    this._executionStatus.set(status);
  }

  setPreserveLogs(preserveLogs: boolean): void {
    this._preserveLogs.set(preserveLogs);
  }

  // Patient management
  addPatient(patient: Patient): void {
    this._selectedPatients.update(patients => {
      if (patients.find(p => p.id === patient.id)) return patients;
      return [...patients, patient];
    });
  }

  removePatient(patientId: string): void {
    this._selectedPatients.update(patients => patients.filter(p => p.id !== patientId));
  }

  clearPatients(): void {
    this._selectedPatients.set([]);
  }

  setLibrary(library: Library | null): void {
    this._library.set(library);
  }

  setEvaluationResults(results: Parameters | null): void {
    this._evaluationResults.set(results);
  }

  setElmTranslationResults(results: string | null): void {
    this._elmTranslationResults.set(results);
  }

  setTranslationErrors(errors: string[]): void {
    this._translationErrors.set(errors);
  }

  setTranslationWarnings(warnings: string[]): void {
    this._translationWarnings.set(warnings);
  }

  setTranslationMessages(messages: string[]): void {
    this._translationMessages.set(messages);
  }

  clearElmTranslationResults(): void {
    this._elmTranslationResults.set(null);
    this._translationErrors.set([]);
    this._translationWarnings.set([]);
    this._translationMessages.set([]);
  }

  // Drag and drop management
  setDraggedTab(tab: IdePanelTab | null): void {
    this._draggedTab.set(tab);
  }

  setDragOverPanel(panelId: string | null): void {
    this._dragOverPanel.set(panelId);
  }

  // Utility methods
  getPanel(panelId: string): IdePanel | undefined {
    return this._panelState()[panelId as keyof IdePanelState];
  }

  getActiveTab(panelId: string): IdePanelTab | undefined {
    const panel = this.getPanel(panelId);
    return panel?.tabs.find(tab => tab.isActive);
  }

  hasActiveTab(panelId: string, tabType: string): boolean {
    const panel = this.getPanel(panelId);
    return panel?.tabs.some(tab => tab.type === tabType && tab.isActive) ?? false;
  }

  // Library resource management
  addLibraryResource(resource: LibraryResource): void {
    this._libraryResources.update(resources => {
      const existingIndex = resources.findIndex(r => r.id === resource.id);
      if (existingIndex >= 0) {
        const updated = [...resources];
        updated[existingIndex] = resource;
        return updated;
      }
      return [...resources, resource];
    });
  }

  selectLibraryResource(libraryId: string | null): void {
    const previousId = this._activeLibraryId();
    this._activeLibraryId.set(libraryId || null);
    if (previousId !== (libraryId || null)) {
      this._findReferencesResult.set(null);
      this._valuesetPeekResult.set(null);
    }
  }

  getActiveLibraryResource(): LibraryResource | null {
    const activeId = this._activeLibraryId();
    if (activeId == null) return null;
    return this._libraryResources().find(r => r.id === activeId) || null;
  }

  removeLibraryResource(libraryId: string): void {
    this._libraryResources.update(resources => 
      resources.filter(r => r.id !== libraryId)
    );
  }

  updateLibraryResource(libraryId: string, updates: Partial<LibraryResource>): void {
    this._libraryResources.update(resources => 
      resources.map(r => r.id === libraryId ? { ...r, ...updates } : r)
    );
  }

  triggerReload(libraryId: string): void {
    // Timestamp makes each trigger distinct so the same library can reload repeatedly.
    // Do not clear via queueMicrotask: effects run during change detection (not as
    // microtasks), so a microtask clear races ahead and the editor never sees the value.
    this._reloadTrigger.set({ libraryId, timestamp: Date.now() });
  }

  reorderLibraryResources(fromIndex: number, toIndex: number): void {
    this._libraryResources.update(resources => {
      const newResources = [...resources];
      const [movedResource] = newResources.splice(fromIndex, 1);
      newResources.splice(toIndex, 0, movedResource);
      return newResources;
    });
  }

  revertLibraryContentToOriginal(libraryId: string): void {
    this._libraryResources.update(resources => 
      resources.map(r => r.id === libraryId ? { 
        ...r, 
        cqlContent: r.originalContent,
        isDirty: false 
      } : r)
    );
  }

  moveTabToPanel(tabId: string, fromPanelId: string, toPanelId: string): void {
    // Find the tab in the source panel
    const sourcePanel = this.getPanel(fromPanelId);
    if (!sourcePanel) return;

    const tab = sourcePanel.tabs.find(t => t.id === tabId);
    if (!tab) return;

    // Remove from source panel
    this.removeTabFromPanel(fromPanelId, tabId);
    
    // Add to target panel
    this.addTabToPanel(toPanelId, tab);
  }

  reorderTabInPanel(panelId: string, fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) return;
    this._panelState.update(state => {
      const panel = state[panelId as keyof IdePanelState];
      const tabs = [...panel.tabs];
      const [moved] = tabs.splice(fromIndex, 1);
      tabs.splice(toIndex, 0, moved);
      return {
        ...state,
        [panelId]: { ...panel, tabs, activeTabId: panel.activeTabId }
      };
    });
  }

  // Editor action methods (for tool orchestrator)
  requestNavigateToLine(lineNumber: number): void {
    this._navigateToLineRequest.set(lineNumber);
    // Clear after a tick to allow component to react
    queueMicrotask(() => this._navigateToLineRequest.set(null));
  }

  requestNavigateToPosition(line: number, column = 0): void {
    const libraryId = this._activeLibraryId();
    if (!libraryId) {
      this.requestNavigateToLine(line);
      return;
    }
    this.requestNavigateToDefinition({ libraryId, line, column });
  }

  setFindReferencesResult(result: IdeFindReferencesResult | null): void {
    if (result == null && this._findReferencesResult() == null) {
      return;
    }
    this._findReferencesResult.set(result);
    if (result) {
      this.ensureTabActive('references-tab');
    }
    this.bumpUiRevision();
  }

  setValuesetPeekResult(result: IdeValuesetPeekResult | null): void {
    if (result == null && this._valuesetPeekResult() == null) {
      return;
    }
    this._valuesetPeekResult.set(result);
    if (result) {
      this.ensureTabActive('valueset-peek-tab');
    }
    this.bumpUiRevision();
  }

  /** Notify zoneless change detection that IDE chrome should re-check. */
  bumpUiRevision(): void {
    this._uiRevision.update(v => v + 1);
  }

  requestRenameSymbol(request: IdeRenameSymbolRequest | null): void {
    this._renameSymbolRequest.set(request);
  }

  consumeRenameSymbolRequest(): IdeRenameSymbolRequest | null {
    const current = this._renameSymbolRequest();
    this._renameSymbolRequest.set(null);
    return current;
  }

  activateOutputTab(): void {
    this.ensureTabActive('output-tab');
    this.bumpUiRevision();
  }

  activateOpenCodeTab(): void {
    this.ensureTabActive('ai-tab');
    this.bumpUiRevision();
  }

  private ensureTabActive(tabId: string): void {
    for (const panelId of ['bottom', 'left', 'right'] as const) {
      const panel = this.getPanel(panelId);
      if (!panel?.tabs.some(t => t.id === tabId)) {
        continue;
      }
      if (!panel.isVisible) {
        this.togglePanel(panelId);
      }
      this.setActiveTab(panelId, tabId);
      return;
    }
  }

  requestNavigateToDefinition(request: {
    libraryId: string;
    line: number;
    column?: number;
  }): void {
    this._pendingEditorNavigation.set({
      libraryId: request.libraryId,
      line: request.line,
      column: request.column ?? 0
    });

    if (this._activeLibraryId() !== request.libraryId) {
      this.selectLibraryResource(request.libraryId);
    }
  }

  consumePendingEditorNavigation(): {
    libraryId: string;
    line: number;
    column: number;
  } | null {
    const pending = this._pendingEditorNavigation();
    if (!pending) {
      return null;
    }
    this._pendingEditorNavigation.set(null);
    return pending;
  }

  peekPendingEditorNavigation(): {
    libraryId: string;
    line: number;
    column: number;
  } | null {
    return this._pendingEditorNavigation();
  }

  clearPendingEditorNavigation(): void {
    this._pendingEditorNavigation.set(null);
  }

  requestFormatCode(): void {
    this._formatCodeRequest.set(true);
    // Clear after a tick to allow component to react
    queueMicrotask(() => this._formatCodeRequest.set(false));
  }
}
