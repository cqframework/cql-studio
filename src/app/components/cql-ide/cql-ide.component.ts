// Author: Preston Lee

import { Component, OnInit, OnDestroy, HostListener, viewChild, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { IdeStateService } from '../../services/ide-state.service';
import { IdeTabRegistryService } from '../../services/ide-tab-registry.service';
import { LibraryService } from '../../services/library.service';
import { PatientService } from '../../services/patient.service';
import { TranslationService } from '../../services/translation.service';
import { CqlExecutionService } from '../../services/cql-execution.service';
import { SettingsService } from '../../services/settings.service';
import { AiService } from '../../services/ai.service';
import { Library } from 'fhir/r4';
import { KeyboardShortcut } from './shared/ide-types';

// Import all the new components
import { IdeStatusBarComponent } from './ide-status-bar/ide-status-bar.component';
import { IdePanelComponent } from './panels/ide-panel.component';
import { CqlEditorComponent } from './editors/cql-editor/cql-editor.component';
import { EditorTabsComponent } from './editors/editor-tabs/editor-tabs.component';

@Component({
  selector: 'app-cql-ide',
  standalone: true,
  imports: [
    CommonModule,
    IdeStatusBarComponent,
    IdePanelComponent,
    CqlEditorComponent,
    EditorTabsComponent
  ],
  templateUrl: './cql-ide.component.html',
  styleUrls: ['./cql-ide.component.scss']
})
export class CqlIdeComponent implements OnInit, OnDestroy {
  cqlEditor = viewChild(CqlEditorComponent);
  
  // Simple state properties
  leftPanelVisible = true;
  rightPanelVisible = true;
  bottomPanelVisible = true;
  activeLibraryId: string | null = null;
  libraryResources: any[] = [];
  selectedPatients: any[] = [];
  

  private router = inject(Router);
  private route = inject(ActivatedRoute);
  public ideStateService = inject(IdeStateService);
  public ideTabRegistryService = inject(IdeTabRegistryService);
  private libraryService = inject(LibraryService);
  private patientService = inject(PatientService);
  private translationService = inject(TranslationService);
  private cqlExecutionService = inject(CqlExecutionService);
  public settingsService = inject(SettingsService);
  private aiService = inject(AiService);

  constructor() {
    // Watch for editor action requests from tool orchestrator (effect must be in constructor)
    effect(() => {
      const lineNumber = this.ideStateService.navigateToLineRequest();
      if (lineNumber !== null) {
        this.onNavigateToLine(lineNumber);
      }
    });
    
    effect(() => {
      const shouldFormat = this.ideStateService.formatCodeRequest();
      if (shouldFormat) {
        this.onFormatCql();
      }
    });
  }

  ngOnInit(): void {
    console.log('CQL IDE Component initialized');
    this.initializeDefaultTabs();
    
    // Update AI tab availability when settings change
    // Note: We'll call updateAiTabAvailability() when settings are updated
    // This could be improved with a proper signal-based approach in the future
  }

  ngOnDestroy(): void {
    console.log('CQL IDE Component destroyed');
    // Clean up tabs and state when component is destroyed
    this.cleanupTabs();
  }

  private initializeDefaultTabs(): void {
    // Check if tabs already exist to prevent duplicates
    const leftPanel = this.ideStateService.getPanel('left');
    const rightPanel = this.ideStateService.getPanel('right');
    const bottomPanel = this.ideStateService.getPanel('bottom');
    
    if (leftPanel && leftPanel.tabs.length > 0 && 
        rightPanel && rightPanel.tabs.length > 0 && 
        bottomPanel && bottomPanel.tabs.length > 0) {
      console.log('Default tabs already exist, skipping initialization');
      return;
    }

    // Add default tabs to panels
    const navigationTab = {
      id: 'navigation-tab',
      title: 'Navigation',
      icon: 'bi-list',
      type: 'navigation',
      isActive: true,
      isClosable: false,
      component: null
    };

    const outlineTab = {
      id: 'outline-tab',
      title: 'Outline',
      icon: 'bi-diagram-3',
      type: 'outline',
      isActive: false,
      isClosable: true,
      component: null
    };

    const fhirTab = {
      id: 'fhir-tab',
      title: 'FHIR',
      icon: 'bi-heart-pulse',
      type: 'fhir',
      isActive: false,
      isClosable: false,
      component: null
    };

    const elmTab = {
      id: 'elm-tab',
      title: 'ELM',
      icon: 'bi-code-slash',
      type: 'elm',
      isActive: false,
      isClosable: true,
      component: null
    };

    const clipboardTab = {
      id: 'clipboard-tab',
      title: 'Clipboard',
      icon: 'bi-clipboard',
      type: 'clipboard',
      isActive: false,
      isClosable: true,
      component: null
    };

    const aiTab = {
      id: 'ai-tab',
      title: 'AI',
      icon: 'bi-robot',
      type: 'ai',
      isActive: true,
      isClosable: true,
      component: null
    };

    const outputTab = {
      id: 'output-tab',
      title: 'Console',
      icon: 'bi-terminal',
      type: 'output',
      isActive: true,
      isClosable: true,
      component: null
    };

    const problemsTab = {
      id: 'problems-tab',
      title: 'Problems',
      icon: 'bi-exclamation-triangle',
      type: 'problems',
      isActive: false,
      isClosable: false,
      component: null
    };


    // Add tabs to panels
    this.ideStateService.addTabToPanel('left', navigationTab);
    this.ideStateService.addTabToPanel('left', outlineTab);
    this.ideStateService.addTabToPanel('right', fhirTab);
    this.ideStateService.addTabToPanel('right', elmTab);
    this.ideStateService.addTabToPanel('right', clipboardTab);
    
    // Only add AI tab if server proxy and Ollama are configured and AI is enabled
    const aiTabAdded = this.aiService.isAiAssistantAvailable();
    if (aiTabAdded) {
      this.ideStateService.addTabToPanel('right', aiTab);
    }
    
    this.ideStateService.addTabToPanel('bottom', outputTab);
    this.ideStateService.addTabToPanel('bottom', problemsTab);
    
    // Set the active tab for the right panel: AI tab if available, otherwise FHIR tab
    if (aiTabAdded) {
      this.ideStateService.setActiveTab('right', 'ai-tab');
    } else {
      this.ideStateService.setActiveTab('right', 'fhir-tab');
    }
  }

  private cleanupTabs(): void {
    // Clear all tabs from all panels
    this.ideStateService.clearPanelTabs('left');
    this.ideStateService.clearPanelTabs('right');
    this.ideStateService.clearPanelTabs('bottom');
    
    // Clear output sections
    this.ideStateService.clearOutputSections();
    
    // Reset execution state
    this.ideStateService.setExecuting(false);
    this.ideStateService.setExecutionProgress(0);
    this.ideStateService.setExecutionStatus('');
  }

  /**
   * Update AI tab availability based on settings
   */
  updateAiTabAvailability(): void {
    const rightPanel = this.ideStateService.getPanel('right');
    if (!rightPanel) return;

    const hasAiTab = rightPanel.tabs.some(tab => tab.type === 'ai');
    const shouldHaveAiTab = this.aiService.isAiAssistantAvailable();

    if (shouldHaveAiTab && !hasAiTab) {
      // Add AI tab
      const aiTab = {
        id: 'ai-tab',
        title: 'AI',
        icon: 'bi-robot',
        type: 'ai',
        isActive: false,
        isClosable: true,
        component: null
      };
      this.ideStateService.addTabToPanel('right', aiTab);
    } else if (!shouldHaveAiTab && hasAiTab) {
      // Remove AI tab
      this.ideStateService.removeTabFromPanel('right', 'ai-tab');
    }
  }

  // Panel management
  onTogglePanel(panelId: string): void {
    switch (panelId) {
      case 'left':
        this.leftPanelVisible = !this.leftPanelVisible;
        break;
      case 'right':
        this.rightPanelVisible = !this.rightPanelVisible;
        break;
      case 'bottom':
        this.bottomPanelVisible = !this.bottomPanelVisible;
        break;
    }
    this.ideStateService.togglePanel(panelId);
  }

  onSetActiveTab(panelId: string, tabId: string): void {
    this.ideStateService.setActiveTab(panelId, tabId);
  }

  onMoveTab(event: { tabId: string; fromPanelId: string; toPanelId: string }): void {
    this.ideStateService.moveTabToPanel(event.tabId, event.fromPanelId, event.toPanelId);
  }

  onReorderPanelTab(event: { panelId: string; fromIndex: number; toIndex: number }): void {
    this.ideStateService.reorderTabInPanel(event.panelId, event.fromIndex, event.toIndex);
  }

  // Drag and drop handlers
  onTabDrop(event: { tab: any, targetPanelId: string }): void {
    console.log('Tab dropped:', event);
  }

  onDragOver(panelId: string): void {
    this.ideStateService.setDragOverPanel(panelId);
  }

  onDragLeave(panelId: string): void {
    if (this.ideStateService.dragOverPanel() === panelId) {
      this.ideStateService.setDragOverPanel(null);
    }
  }

  // Library management
  onLibraryIdChange(libraryId: string): void {
    this.activeLibraryId = libraryId;
    this.ideStateService.selectLibraryResource(libraryId);
  }


  isActiveLibraryNew(): boolean {
    const activeLibrary = this.ideStateService.getActiveLibraryResource();
    // A library is considered "new" if it doesn't have a corresponding FHIR library object
    // or if it's marked as dirty (has unsaved changes)
    return !activeLibrary?.library || activeLibrary.isDirty;
  }



  onLibraryVersionChange(version: string): void {
    // Handle library version change
    console.log('Library version changed:', version);
  }

  onLibraryDescriptionChange(description: string): void {
    // Handle library description change
    console.log('Library description changed:', description);
  }

  onSaveLibrary(): void {
    const activeLibrary = this.ideStateService.getActiveLibraryResource();
    if (!activeLibrary) {
      console.warn('No active library to save');
      return;
    }

    // Get the current content from the library resource
    const currentContent = activeLibrary.cqlContent || '';
    if (!currentContent.trim()) {
      console.warn('No content to save');
      return;
    }

    console.log('Saving library:', activeLibrary.id);
    this.ideStateService.setExecutionStatus('Translating CQL to ELM...');
    this.ideStateService.setTranslating(true);

    // Translate CQL to ELM using the translation service (as if triggered from ELM tab)
    const translationResult = this.translationService.translateCqlToElm(currentContent);
    
    // Update translation state with errors/warnings
    this.ideStateService.setTranslationErrors(translationResult.errors);
    this.ideStateService.setTranslationWarnings(translationResult.warnings);
    this.ideStateService.setTranslationMessages(translationResult.messages);
    
    this.ideStateService.setTranslating(false);

    // Set ELM results in state (for display in ELM tab)
    this.ideStateService.setElmTranslationResults(translationResult.elmXml);

    // Check if we have ELM XML to save (even if there are errors, we may have partial results)
    if (!translationResult.elmXml) {
      console.error('Translation failed - no ELM XML generated');
      this.ideStateService.setExecutionStatus('Translation failed - no ELM output generated');
      
      // Add error message to Console pane
      const libraryName = activeLibrary.name || activeLibrary.id || 'Library';
      const errorMessages = translationResult.errors.length > 0 
        ? translationResult.errors.join('\n')
        : 'Translation failed to generate ELM XML';
      this.ideStateService.addTextOutput(
        `Save Failed: ${libraryName}`,
        `Failed to save library "${libraryName}" - no ELM XML was generated.\n\nErrors:\n${errorMessages}`,
        'error'
      );
      
      // Mark as dirty again since save failed
      this.ideStateService.updateLibraryResource(activeLibrary.id, {
        isDirty: true
      });
      
      // Clear error status after a short delay
      setTimeout(() => {
        this.ideStateService.setExecutionStatus('');
      }, 5000);
      return;
    }

    // If we have ELM XML, proceed with saving (even if there are errors)
    if (translationResult.hasErrors) {
      console.warn('Translation completed with errors, but ELM XML is available. Proceeding with save.');
      this.ideStateService.setExecutionStatus('Saving library (with translation warnings)...');
      
      // Add warning message to Console pane (using 'error' status since there are translation errors)
      const libraryName = activeLibrary.name || activeLibrary.id || 'Library';
      const errorMessages = translationResult.errors.join('\n');
      this.ideStateService.addTextOutput(
        `Save Warning: ${libraryName}`,
        `Library "${libraryName}" saved with translation errors.\n\nErrors:\n${errorMessages}\n\nELM XML was generated and saved.`,
        'error'
      );
    } else {
      console.log('Translation successful');
      this.ideStateService.setExecutionStatus('Saving library...');
    }

    // Update the library resource with current content
    this.ideStateService.updateLibraryResource(activeLibrary.id, {
      cqlContent: currentContent,
      isDirty: false
    });

    // Check if this is a new library (no FHIR library object) or existing library
    // Also check if the ID has changed (which requires creating a new library)
    const hasExistingLibrary = activeLibrary.library && activeLibrary.library.id;
    const idHasChanged = hasExistingLibrary && activeLibrary.library && activeLibrary.library.id !== activeLibrary.id;
    
    // Always include ELM XML in the Library content per FHIR Library resource specifications
    // The ELM XML is base64 encoded and included with contentType 'application/elm+xml'
    if (hasExistingLibrary && !idHasChanged) {
      // Update existing library (ID hasn't changed)
      this.updateExistingLibrary(activeLibrary.library, currentContent, translationResult.elmXml);
    } else {
      // Create new library (either no existing library or ID has changed)
      this.createNewLibrary(activeLibrary, currentContent, translationResult.elmXml);
    }
  }

  onDeleteLibrary(libraryId: string): void {
    const resources = this.ideStateService.libraryResources();
    const wasActive = this.ideStateService.activeLibraryId() === libraryId;
    let adjacentId: string | null = null;

    if (wasActive && resources.length > 1) {
      const idx = resources.findIndex(r => r.id === libraryId);
      if (idx >= 0) {
        if (idx > 0) {
          adjacentId = resources[idx - 1].id;
        } else {
          adjacentId = resources[idx + 1].id;
        }
      }
    }

    if (wasActive && adjacentId) {
      this.ideStateService.selectLibraryResource(adjacentId);
    } else if (wasActive) {
      this.ideStateService.selectLibraryResource('');
    }

    this.ideStateService.removeLibraryResource(libraryId);
  }

  // Translation
  onTranslateCqlToElm(): void {
    this.ideStateService.setTranslating(true);
    // Implementation for CQL to ELM translation
    console.log('Translating CQL to ELM');
  }

  onClearElmTranslation(): void {
    this.ideStateService.setElmTranslationResults(null);
  }

  // Execution
  onExecuteAll(): void {
    this.ideStateService.setExecuting(true);
    
    // Get all library resources
    const libraries = this.ideStateService.libraryResources();
    if (libraries.length === 0) {
      console.log('No libraries to execute');
      this.ideStateService.setExecuting(false);
      return;
    }
    
    // Get selected patient IDs
    const patientIds = this.patientService.selectedPatients.map(p => p.id).filter(id => id) as string[];
    
    // Prepare libraries for execution
    const librariesToExecute = libraries.map(lib => ({
      id: lib.id,
      name: lib.name || lib.id
    }));
    
    // Execute all libraries using CQL execution service
    this.cqlExecutionService.executeAllLibraries(librariesToExecute, patientIds).subscribe({
      next: (results) => {
        console.log('All libraries execution completed:', results);
        this.ideStateService.setExecuting(false);
        
        // Format and add results to output sections
        this.formatAndAddExecutionResults(results, 'Execute All Libraries');
      },
      error: (error) => {
        console.error('All libraries execution failed:', error);
        this.ideStateService.setExecuting(false);
        
        // Add error to output sections
        this.addErrorToOutput('Execute All Libraries', error);
      }
    });
  }

  onNavigateToLine(lineNumber: number): void {
    // Navigate to the specified line in the active CQL editor
    if (this.cqlEditor()) {
      this.cqlEditor()!.navigateToLine(lineNumber);
    } else {
      console.warn('CQL editor not available for navigation');
    }
  }

  // Settings
  onPreserveLogsChange(preserveLogs: boolean): void {
    // Handle preserve logs setting change
    console.log('Preserve logs changed:', preserveLogs);
  }

  // Additional methods needed for the template
  onStartResize(event: { type: string; event: MouseEvent; newSize?: number }): void {
    if (event.newSize !== undefined) {
      this.ideStateService.setPanelSize(event.type, event.newSize);
    }
  }

  onReorderEditorTabs(event: { fromIndex: number; toIndex: number }): void {
    console.log('Reorder editor tabs:', event);
  }

  onInsertCqlCode(code: string): void {
    if (this.cqlEditor()) {
      this.cqlEditor()!.insertText(code);
    } else {
      console.warn('CQL editor not available for code insertion');
    }
  }

  onReplaceCqlCode(code: string): void {
    if (this.cqlEditor()) {
      this.cqlEditor()!.setValue(code);
    } else {
      console.warn('CQL editor not available for code replacement');
    }
  }

  onEditorContentChange(event: { cursorPosition: { line: number; column: number }, wordCount: number, content: string }, libraryId: string): void {
    this.ideStateService.updateEditorState({
      cursorPosition: event.cursorPosition,
      wordCount: event.wordCount
    });
    
    // Update the specific library's content and dirty state
    const library = this.ideStateService.libraryResources().find(lib => lib.id === libraryId);
    if (library) {
      const currentContent = event.content;
      const isDirty = currentContent !== library.originalContent;
      
      // Update the library resource with the new content
      this.ideStateService.updateLibraryResource(libraryId, {
        cqlContent: currentContent,
        isDirty: isDirty
      });
    }
  }

  onEditorSyntaxErrors(errors: string[]): void {
    this.ideStateService.updateEditorState({
      syntaxErrors: errors,
      isValidSyntax: errors.length === 0
    });
  }

  // Editor toolbar methods
  onExecuteLibrary(): void {
    const activeLibrary = this.ideStateService.getActiveLibraryResource();
    if (!activeLibrary) {
      console.log('No active library to execute');
      return;
    }
    
    this.ideStateService.setExecuting(true);
    this.ideStateService.setExecutionStatus('Translating CQL to ELM...');
    
    // Get selected patient IDs
    const patientIds = this.patientService.selectedPatients.map(p => p.id).filter(id => id) as string[];
    
    // Get current CQL content from memory (even if not saved)
    const currentCqlContent = activeLibrary.cqlContent || '';
    
    // Translate CQL to ELM using the translation service (similar to Save)
    const translationResult = this.translationService.translateCqlToElm(currentCqlContent);
    
    // Update translation state with errors/warnings
    this.ideStateService.setTranslationErrors(translationResult.errors);
    this.ideStateService.setTranslationWarnings(translationResult.warnings);
    this.ideStateService.setTranslationMessages(translationResult.messages);
    
    // Set ELM results in state (for display in ELM tab)
    this.ideStateService.setElmTranslationResults(translationResult.elmXml);
    
    // Check if we have ELM XML (even if there are errors, we may have partial results)
    if (!translationResult.elmXml) {
      console.warn('Translation failed - no ELM XML generated, executing without ELM');
      this.ideStateService.setExecutionStatus('Executing (translation failed, no ELM)...');
    } else {
      this.ideStateService.setExecutionStatus('Executing library...');
    }
    
    // Execute single library using CQL execution service
    // Pass the entire activeLibrary resource with current CQL content and ELM
    this.cqlExecutionService.executeLibrary(
      activeLibrary.id, 
      patientIds,
      {
        cqlContent: currentCqlContent,
        elmXml: translationResult.elmXml || undefined,
        libraryResource: activeLibrary // Pass entire library resource with current values
      }
    ).subscribe({
      next: (result) => {
        console.log('Library execution completed:', result);
        this.ideStateService.setExecuting(false);
        this.ideStateService.setExecutionStatus('');
        
        // Format and add results to output sections
        this.formatAndAddExecutionResults(result, `Library: ${activeLibrary.name || activeLibrary.id}`);
      },
      error: (error) => {
        console.error('Library execution failed:', error);
        this.ideStateService.setExecuting(false);
        this.ideStateService.setExecutionStatus('');
        
        // Add error to output sections
        this.addErrorToOutput(`Library: ${activeLibrary.name || activeLibrary.id}`, error);
      }
    });
  }

  onReloadLibrary(): void {
    const activeLibraryId = this.ideStateService.activeLibraryId();
    if (!activeLibraryId) {
      console.warn('No active library to reload');
      return;
    }

    console.log('Reloading library:', activeLibraryId);
    this.ideStateService.setExecutionStatus('Reloading library...');

    this.libraryService.get(activeLibraryId).subscribe({
      next: (library: any) => {
        console.log('Library reloaded from server:', library);
        const libraryResource = this.ideStateService.getActiveLibraryResource();
        if (!libraryResource) {
          console.error('No active library resource found for reload');
          this.ideStateService.setExecutionStatus('');
          return;
        }

        const cqlAttachment = library.content?.find((c: any) => c.contentType === 'text/cql');
        const fromUrl = !!(cqlAttachment?.url && !cqlAttachment?.data);
        if (fromUrl) {
          this.ideStateService.updateLibraryResource(activeLibraryId, {
            contentLoading: true,
            contentLoadError: undefined
          });
        }

        this.libraryService.getCqlContent(library).subscribe({
          next: ({ cqlContent }) => {
            this.ideStateService.updateLibraryResource(activeLibraryId, {
              cqlContent,
              originalContent: cqlContent,
              isDirty: false,
              library,
              contentLoading: false,
              contentLoadError: undefined
            });
            this.ideStateService.triggerReload(activeLibraryId);
            const libraryName = libraryResource.name || libraryResource.id || 'Library';
            this.ideStateService.addTextOutput(
              `Library Reloaded: ${libraryName}`,
              `Successfully reloaded library "${libraryName}" from server.\n\nContent length: ${cqlContent.length} characters`,
              'success'
            );
            this.ideStateService.setExecutionStatus('Library reloaded successfully');
            setTimeout(() => this.ideStateService.setExecutionStatus(''), 2000);
          },
          error: (err) => {
            const libraryName = libraryResource.name || libraryResource.id || 'Library';
            const message = err?.message ?? String(err);
            const errorMessage = `Could not load CQL from URL for library "${libraryName}". ${message}`;
            this.ideStateService.updateLibraryResource(activeLibraryId, {
              contentLoading: false,
              contentLoadError: errorMessage
            });
            this.ideStateService.addTextOutput(
              `Library Reload Failed: ${libraryName}`,
              errorMessage,
              'error'
            );
            this.ideStateService.setExecutionStatus('Failed to reload library');
            setTimeout(() => this.ideStateService.setExecutionStatus(''), 3000);
          }
        });
      },
      error: (error) => {
        console.error('Failed to reload library:', error);
        this.ideStateService.setExecutionStatus('Failed to reload library');
        const libraryName = this.ideStateService.getActiveLibraryResource()?.name ||
          this.ideStateService.getActiveLibraryResource()?.id || 'Library';
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.ideStateService.addTextOutput(
          `Library Reload Failed: ${libraryName}`,
          `Failed to reload library "${libraryName}" from server.\n\nError: ${errorMessage}`,
          'error'
        );
        setTimeout(() => this.ideStateService.setExecutionStatus(''), 3000);
      }
    });
  }

  onFormatCql(): void {
    // Formatting is handled by the CqlEditorComponent
    // This method is called when the format button is clicked in the IDE toolbar
  }

  onValidateCql(): void {
    console.log('Validate CQL');
    // TODO: Implement CQL validation
  }

  // Library save helper methods
  private updateExistingLibrary(library: any, cqlContent: string, elmXml: string): void {
    // Get the current library resource to get the latest metadata
    const activeLibrary = this.ideStateService.getActiveLibraryResource();
    
    // Update the library's CQL content and metadata
    const updatedLibrary = {
      ...library,
      id: activeLibrary?.id || library.id, // Use the current ID (which might have changed)
      name: activeLibrary?.name || library.name,
      title: activeLibrary?.title || library.title,
      version: activeLibrary?.version || library.version || '1.0.0',
      description: activeLibrary?.description || library.description,
      url: activeLibrary?.url || library.url || this.libraryService.urlFor(activeLibrary?.id || library.id),
      content: [
        {
          contentType: 'text/cql',
          data: btoa(cqlContent)
        },
        {
          contentType: 'application/elm+xml',
          data: btoa(elmXml)
        }
      ]
    };

    this.libraryService.put(updatedLibrary).subscribe({
      next: (savedLibrary) => {
        console.log('Library updated successfully:', savedLibrary);
        this.ideStateService.setExecutionStatus('Library saved successfully');
        
        // Update the library resource with the saved library
        // Also update originalContent to reflect the saved content
        // Refresh URL to ensure it's up to date
        const currentId = this.ideStateService.activeLibraryId()!;
        const refreshedUrl = this.libraryService.urlFor(currentId);
        
        this.ideStateService.updateLibraryResource(currentId, {
          url: refreshedUrl,
          library: savedLibrary,
          originalContent: cqlContent,
          isDirty: false
        });
        
        // Add success message to Console pane
        const libraryName = activeLibrary?.name || activeLibrary?.id || 'Library';
        this.ideStateService.addTextOutput(
          `Library Saved: ${libraryName}`,
          `Successfully saved library "${libraryName}" to server.\n\nLibrary ID: ${currentId}\nContent length: ${cqlContent.length} characters`,
          'success'
        );
        
        // Force content refresh to update the cache
        
        // Clear status after a short delay
        setTimeout(() => {
          this.ideStateService.setExecutionStatus('');
        }, 2000);
      },
      error: (error) => {
        console.error('Failed to update library:', error);
        this.ideStateService.setExecutionStatus('Failed to save library');
        
        // Add error message to Console pane
        const libraryName = activeLibrary?.name || activeLibrary?.id || 'Library';
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.ideStateService.addTextOutput(
          `Save Failed: ${libraryName}`,
          `Failed to save library "${libraryName}" to server.\n\nError: ${errorMessage}`,
          'error'
        );
        
        // Mark as dirty again since save failed
        this.ideStateService.updateLibraryResource(this.ideStateService.activeLibraryId()!, {
          isDirty: true
        });
        
        // Clear error status after a short delay
        setTimeout(() => {
          this.ideStateService.setExecutionStatus('');
        }, 3000);
      }
    });
  }

  private createNewLibrary(libraryResource: any, cqlContent: string, elmXml: string): void {
    // Create a new FHIR Library resource
    const newLibrary: Library = {
      resourceType: 'Library' as const,
      name: libraryResource.name || libraryResource.id,
      title: libraryResource.title || libraryResource.name || libraryResource.id,
      version: libraryResource.version || '1.0.0',
      status: 'active' as const,
      url: libraryResource.url || this.libraryService.urlFor(libraryResource.id),
      type: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/library-type',
            code: 'logic-library',
            display: 'Logic Library'
          }
        ]
      },
      content: [
        {
          contentType: 'text/cql',
          data: btoa(cqlContent)
        },
        {
          contentType: 'application/elm+xml',
          data: btoa(elmXml)
        }
      ],
      description: libraryResource.description || `Library ${libraryResource.name || libraryResource.id}`
    };

    this.libraryService.post(newLibrary).subscribe({
      next: (savedLibrary) => {
        console.log('Library created successfully:', savedLibrary);
        this.ideStateService.setExecutionStatus('Updating library with server-assigned ID...');
        
        // Get the server-assigned ID
        const serverAssignedId = savedLibrary.id;
        if (serverAssignedId && serverAssignedId !== libraryResource.id) {
          // Update the library with the server-assigned ID and correct URL
          const updatedLibrary = {
            ...savedLibrary,
            url: this.libraryService.urlFor(serverAssignedId)
          };
          
          // Save again with the corrected URL
          this.libraryService.put(updatedLibrary).subscribe({
            next: (finalLibrary) => {
              console.log('Library updated with correct URL:', finalLibrary);
              this.ideStateService.setExecutionStatus('Library saved successfully');
              
              // Update the library resource with the final library data
              this.ideStateService.updateLibraryResource(libraryResource.id, {
                id: serverAssignedId,
                url: this.libraryService.urlFor(serverAssignedId),
                library: finalLibrary,
                originalContent: cqlContent,
                isDirty: false
              });
              
              // Update the active library ID to point to the server-assigned ID
              this.ideStateService.selectLibraryResource(serverAssignedId);
              
              // Add success message to Console pane
              const libraryName = libraryResource.name || libraryResource.id || 'Library';
              this.ideStateService.addTextOutput(
                `Library Created: ${libraryName}`,
                `Successfully created and saved library "${libraryName}" to server.\n\nLibrary ID: ${serverAssignedId}\nContent length: ${cqlContent.length} characters`,
                'success'
              );
              
              // Force content refresh to update the cache
              
              // Clear status after a short delay
              setTimeout(() => {
                this.ideStateService.setExecutionStatus('');
              }, 2000);
            },
            error: (error) => {
              console.error('Failed to update library with correct URL:', error);
              this.ideStateService.setExecutionStatus('Failed to update library URL');
              
              // Still update with the server-assigned ID even if URL update failed
              this.ideStateService.updateLibraryResource(libraryResource.id, {
                id: serverAssignedId,
                url: this.libraryService.urlFor(serverAssignedId),
                library: savedLibrary,
                originalContent: cqlContent,
                isDirty: false
              });
              
              this.ideStateService.selectLibraryResource(serverAssignedId);
              
              // Add warning message to Console pane (library created but URL update failed)
              const libraryName = libraryResource.name || libraryResource.id || 'Library';
              const errorMessage = error instanceof Error ? error.message : String(error);
              this.ideStateService.addTextOutput(
                `Library Created (URL Update Failed): ${libraryName}`,
                `Library "${libraryName}" was created with ID ${serverAssignedId}, but failed to update URL.\n\nError: ${errorMessage}`,
                'error'
              );
              
              setTimeout(() => {
                this.ideStateService.setExecutionStatus('');
              }, 3000);
            }
          });
        } else {
          // No server-assigned ID change, just update normally
          this.ideStateService.setExecutionStatus('Library saved successfully');
          
          this.ideStateService.updateLibraryResource(libraryResource.id, {
            url: this.libraryService.urlFor(libraryResource.id),
            library: savedLibrary,
            originalContent: cqlContent,
            isDirty: false
          });
          
          // Force content refresh to update the cache
          
          // Clear status after a short delay
          setTimeout(() => {
            this.ideStateService.setExecutionStatus('');
          }, 2000);
        }
      },
      error: (error) => {
        console.error('Failed to create library:', error);
        this.ideStateService.setExecutionStatus('Failed to save library');
        
        // Mark as dirty again since save failed
        this.ideStateService.updateLibraryResource(libraryResource.id, {
          isDirty: true
        });
        
        // Clear error status after a short delay
        setTimeout(() => {
          this.ideStateService.setExecutionStatus('');
        }, 3000);
      }
    });
  }

  // Helper methods for output formatting
  private formatAndAddExecutionResults(results: any[], title: string): void {
    const content = this.formatExecutionResults(results);
    const status = results.some(r => r.error) ? 'error' : 'success';
    const executionTime = results.reduce((total, r) => total + (r.executionTime || 0), 0);
    
    this.ideStateService.addOutputSection({
      id: `output_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      title: title,
      content: content,
      type: 'json',
      status: status,
      executionTime: executionTime,
      expanded: true,
      timestamp: new Date()
    });
  }

  private addErrorToOutput(title: string, error: any): void {
    const content = `Execution failed:\n${JSON.stringify(error, null, 2)}`;
    
    this.ideStateService.addOutputSection({
      id: `output_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      title: title,
      content: content,
      type: 'error',
      status: 'error',
      executionTime: 0,
      expanded: true,
      timestamp: new Date()
    });
  }

  private formatExecutionResults(results: any[]): string {
    let output = '';
    
    if (results.length === 0) {
      output += 'No execution results.\n';
      return output;
    }

    // Check if we have patient-specific results
    const hasPatientResults = results.some(r => r.patientId);
    
    if (hasPatientResults) {
      // Multiple patients
      results.forEach((result, index) => {
        output += `--- Patient ${index + 1}: ${result.patientName || result.patientId} (${result.patientId}) ---\n`;
        
        if (result.error) {
          output += `${JSON.stringify(result.error, null, 2)}\n\n`;
        } else {
          output += `${JSON.stringify(result.result, null, 2)}\n\n`;
        }
      });
    } else {
      // Single execution without patient
      results.forEach((result, index) => {
        if (result.error) {
          output += `${JSON.stringify(result.error, null, 2)}\n\n`;
        } else {
          output += `${JSON.stringify(result.result, null, 2)}\n\n`;
        }
      });
    }
    
    return output;
  }

  // Platform detection utility
  private isMacPlatform(): boolean {
    return navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  }

  // Keyboard shortcuts for the welcome message
  getAllShortcuts(): KeyboardShortcut[] {
    const isMac = this.isMacPlatform();
    
    return [
      // Core CQL IDE shortcuts - Platform-specific
      { key: 'F5', description: 'Execute Active Library' },
      { 
        key: 'F6', 
        description: 'Execute All Open Libraries' 
      },
      { 
        key: isMac ? '⌘+⌥+W' : 'Ctrl+W', 
        description: 'Close Active Editor' 
      },
      {
        key: 'Ctrl+Space',
        description: 'Autocomplete'
      }
    ];
  }

  // Keyboard shortcut handler
  @HostListener('document:keydown', ['$event'])
  handleKeyboardShortcuts(event: KeyboardEvent): void {

    // Prevent default behavior for our shortcuts
    const isMac = this.isMacPlatform();
    const isCmdKey = isMac ? event.metaKey : event.ctrlKey;
    
    // Debug logging for troubleshooting
    if (event.key === 'w' || event.key === 'W') {
      console.log('W key detected:', {
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        isMac: isMac,
        isCmdKey: isCmdKey
      });
    }
    
    // F5 - Execute Active Library
    if (event.key === 'F5' && !isCmdKey) {
      event.preventDefault();
      this.onExecuteLibrary();
      return;
    }
    
    // F6 - Execute All Libraries
    if (event.key === 'F6') {
      event.preventDefault();
      this.onExecuteAll();
      return;
    }
    
    // Cmd+Option+W (Mac) or Ctrl+W (PC) - Close Active Editor
    if (isMac) {
      // Mac: Cmd+Option+W - check for the key that produces ∑ in Dvorak (Comma key)
      if (event.metaKey && event.altKey && event.code === 'Comma') {
        event.preventDefault();
        console.log('Mac: Cmd+Option+W detected - closing active editor');
        this.onCloseActiveEditor();
        return;
      }
    } else {
      // PC: Ctrl+W - use physical key position (KeyW) regardless of layout
      if (event.code === 'KeyW' && event.ctrlKey) {
        event.preventDefault();
        console.log('PC: Ctrl+W detected - closing active editor');
        this.onCloseActiveEditor();
        return;
      }
    }
  }

  // Close active editor method
  private onCloseActiveEditor(): void {
    const activeLibraryId = this.ideStateService.activeLibraryId();
    if (activeLibraryId) {
      this.onDeleteLibrary(activeLibraryId);
    }
  }

}