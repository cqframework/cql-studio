// Author: Preston Lee

import { Component, input, output, viewChild, ElementRef, AfterViewInit, OnDestroy, signal, computed, effect, inject } from '@angular/core';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { defaultKeymap, historyKeymap } from '@codemirror/commands';
import { searchKeymap } from '@codemirror/search';
import { highlightSpecialChars } from '@codemirror/view';
import { bracketMatching } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { linter, lintGutter, Diagnostic } from '@codemirror/lint';
import { CqlGrammarManager } from '../../../../services/cql-grammar-manager.service';
import { IdeEditor, EditorState as IdeEditorState } from '../base-editor.interface';
import { IdeStateService } from '../../../../services/ide-state.service';
import { CqlFormatterService } from '../../../../services/cql-formatter.service';
import { CqlValidationService } from '../../../../services/cql-validation.service';

@Component({
  selector: 'app-cql-editor',
  standalone: true,
  imports: [],
  templateUrl: './cql-editor.component.html',
  styleUrls: ['./cql-editor.component.scss']
})
export class CqlEditorComponent implements AfterViewInit, OnDestroy, IdeEditor {
  editorContainer = viewChild<ElementRef<HTMLDivElement>>('editorContainer');
  
  libraryId = input<string>('');
  editorState = input<any>();
  placeholder = input<string>('Enter CQL code here...');
  height = input<string>('500px');
  readonly = input<boolean>(false);
  isNewLibrary = input<boolean>(false);
  
  contentChange = output<{ cursorPosition: { line: number; column: number }, wordCount: number, content: string }>();
  cursorChange = output<{ line: number; column: number }>();
  editorStateChange = output<IdeEditorState>();
  syntaxErrors = output<string[]>();
  executeLibrary = output<void>();
  reloadLibrary = output<void>();
  formatCql = output<void>();
  validateCql = output<void>();
  saveLibrary = output<void>();

  private editor?: EditorView;
  private grammarManager: CqlGrammarManager;
  private _value: string = '';
  private isInitializing: boolean = false;
  private initializationRetries: number = 0;
  private maxRetries: number = 10;
  private resizeObserver?: ResizeObserver;

  // Toolbar properties
  isExecuting: boolean = false;
  
  // Signal for canExecute state
  private _canExecuteSignal = signal(false);
  
  // Computed signal for canExecute
  canExecute = computed(() => this._canExecuteSignal());
  
  // Signal for form validity state
  private _isFormValidSignal = signal(false);
  
  // Computed signal for form validity
  isFormValid = computed(() => this._isFormValidSignal());

  private ideStateService = inject(IdeStateService);
  private cqlFormatterService = inject(CqlFormatterService);
  private cqlValidationService = inject(CqlValidationService);

  // Debouncing for validation
  private validationTimeout?: ReturnType<typeof setTimeout>;
  private readonly VALIDATION_DEBOUNCE_MS = 250;
  private currentValidationErrors: string[] = [];
  private pendingLintResolvers: Array<(diagnostics: Diagnostic[]) => void> = [];
  
  // Flag to prevent contentChange events during programmatic updates
  private isUpdatingFromReload: boolean = false;

  constructor() {
    this.grammarManager = new CqlGrammarManager();
    
    // Watch for libraryId changes
    effect(() => {
      const libraryId = this.libraryId();
      if (libraryId && this.editor) {
        console.log('Library ID changed, reinitializing editor for:', libraryId);
        this.reinitializeEditor();
        this.updateCanExecute();
      }
    });
    
    // Watch for reload trigger signal
    effect(() => {
      const reloadTrigger = this.ideStateService.reloadTrigger();
      const libraryId = this.libraryId();
      
      if (!reloadTrigger || !libraryId || !this.editor) {
        return;
      }
      
      // Only act if this reload is for the current library
      if (reloadTrigger.libraryId !== libraryId) {
        return;
      }
      
      // Get the library resource
      const library = this.ideStateService.libraryResources().find(lib => lib.id === libraryId);
      if (!library) {
        return;
      }
      
      console.log('Reload trigger detected, updating editor', {
        libraryId,
        libraryContentLength: library.cqlContent.length,
        editorContentLength: this.getValue().length
      });
      
      // Set flag to prevent contentChange event from triggering parent updates
      this.isUpdatingFromReload = true;
      try {
        this.setValue(library.cqlContent);
        this.updateCanExecute();
      } finally {
        // Reset flag after a microtask to allow the editor update to complete
        setTimeout(() => {
          this.isUpdatingFromReload = false;
        }, 0);
      }
    });
  }

  // Get content for this specific library
  private getLibraryContent(): string {
    if (!this.libraryId()) return '';
    const library = this.ideStateService.libraryResources().find(lib => lib.id === this.libraryId());
    return library?.cqlContent || '';
  }

  ngAfterViewInit(): void {
    console.log('Editor ngAfterViewInit called');
    if (!this.isInitializing && !this.editor) {
      // Try immediate initialization first
      this.initializeEditor();
      
      // Also set up ResizeObserver as a fallback
      this.setupResizeObserver();
    } else {
      console.log('Skipping initialization - already initializing or editor exists');
    }
  }

  ngOnDestroy(): void {
    if (this.validationTimeout) {
      clearTimeout(this.validationTimeout);
    }
    this.editor?.destroy();
    this.resizeObserver?.disconnect();
  }

  private initializeEditor(): void {
    console.log('initializeEditor called', {
      editorContainer: !!this.editorContainer()?.nativeElement,
      currentValue: this._value.substring(0, 100) + '...',
      editorExists: !!this.editor,
      isInitializing: this.isInitializing
    });
    
    if (this.isInitializing) {
      console.log('Already initializing, skipping');
      return;
    }
    
    if (!this.editorContainer()?.nativeElement) {
      console.log('Editor container not ready, returning');
      return;
    }
    
    if (this.editor) {
      console.log('Editor already exists, updating content');
      return;
    }
    
    this.isInitializing = true;
    
    const container = this.editorContainer()!.nativeElement;
    if (container.offsetWidth === 0 || container.offsetHeight === 0) {
      this.initializationRetries++;
      console.log(`Container has no dimensions, retry ${this.initializationRetries}/${this.maxRetries}`);
      
      if (this.initializationRetries >= this.maxRetries) {
        console.error('Max initialization retries reached, forcing initialization with fallback dimensions');
        // Force initialization with fallback dimensions
        container.style.minHeight = '200px';
        container.style.minWidth = '300px';
        // Continue with initialization
      } else {
        this.isInitializing = false;
        // Use ResizeObserver to detect when container becomes available
        this.setupResizeObserver();
        return;
      }
    }
    
    try {
      // Get content for this specific library
      const initialContent = this.getLibraryContent();
      this._value = initialContent; // Sync _value with the actual content
      const startState = EditorState.create({
        doc: initialContent,
        extensions: [
          basicSetup,
          ...this.grammarManager.createExtensions(),
          highlightSpecialChars(),
          bracketMatching(),
          lintGutter(),
          linter(this.createLintSource()),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            {
              key: 'Tab',
              run: (view) => {
                // Insert tab character at cursor position
                const selection = view.state.selection.main;
                view.dispatch({
                  changes: {
                    from: selection.from,
                    to: selection.to,
                    insert: '\t'
                  },
                  selection: { anchor: selection.from + 1 }
                });
                return true;
              }
            },
            {
              key: 'Ctrl-Shift-f',
              run: () => {
                this.formatCode();
                return true;
              }
            },
            {
              key: 'Ctrl-k',
              run: () => {
                this.clearCode();
                return true;
              }
            }
          ]),
          EditorView.theme({
            '&': {
              height: this.height(),
              fontSize: '14px',
              fontFamily: "'Courier New', Courier, monospace"
            },
            '.cm-content': {
              padding: '12px',
              minHeight: this.height(),
              color: '#ffffff'
            },
            '.cm-focused': {
              outline: 'none'
            },
            '.cm-editor': {
              border: 'none',
              borderRadius: '0.375rem',
              backgroundColor: '#1e1e1e'
            },
            '.cm-editor.cm-focused': {
              borderColor: '#0d6efd',
              boxShadow: '0 0 0 0.2rem rgba(13, 110, 253, 0.25)'
            },
            '.cm-placeholder': {
              color: '#6c757d',
              fontStyle: 'italic'
            }
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const newValue = update.state.doc.toString();
              this._value = newValue;
              
              // Update form validity signal
              this._isFormValidSignal.set(newValue.trim().length > 0);
              
              // Only emit contentChange if this is not a programmatic update from reload
              if (!this.isUpdatingFromReload) {
                const cursor = this.getCursorPosition();
                const wordCount = this.getWordCount();
                this.contentChange.emit({ 
                  cursorPosition: cursor || { line: 1, column: 1 }, 
                  wordCount: wordCount || 0,
                  content: newValue
                });
                
                // Update canExecute state after content change
                this.updateCanExecute();
              }
              
              // Library resource update will be handled by parent component
              // to avoid change detection issues
            }
            
            if (update.selectionSet) {
              const selection = update.state.selection.main;
              const line = update.state.doc.lineAt(selection.from).number;
              const column = selection.from - update.state.doc.lineAt(selection.from).from;
              this.cursorChange.emit({ line, column });
            }
            
            // Update word count
            const text = update.state.doc.toString();
            const wordCount = text.trim().split(/\s+/).filter(word => word.length > 0).length;
            
            // Note: Validation is handled automatically by CodeMirror's lint extension
            // The lint source function will be called automatically when the document changes
            
            // Emit editor state change
            this.editorStateChange.emit({
              cursorPosition: this.getCursorPosition(),
              wordCount: wordCount,
              syntaxErrors: this.getSyntaxErrors(),
              isValidSyntax: this.getIsValidSyntax()
            });
          }),
          EditorView.domEventHandlers({
            focus: () => {}
          })
        ]
      });
      
      this.editor = new EditorView({
        state: startState,
        parent: this.editorContainer()!.nativeElement
      });
      
      this.isInitializing = false;
      this.initializationRetries = 0; // Reset retry counter on success
      console.log('Editor initialization completed');
      
      // Update form validity signal after initialization
      this._isFormValidSignal.set(initialContent.trim().length > 0);
      
      // Update canExecute state after initialization
      this.updateCanExecute();
      
    } catch (error) {
      console.error('Failed to initialize CQL editor:', error);
      this.isInitializing = false;
    }
  }

  // IdeEditor interface implementation
  getValue(): string {
    return this.editor?.state.doc.toString() || '';
  }
  
  setValue(value: string): void {
    console.log('setValue called:', {
      value: value.substring(0, 50) + '...',
      isInitializing: this.isInitializing,
      editorExists: !!this.editor,
      currentValue: this._value.substring(0, 50) + '...'
    });
    
    if (this.isInitializing) {
      console.log('Skipping setValue - already initializing');
      return;
    }
    
    this._value = value;
    
    // Update form validity signal
    this._isFormValidSignal.set(value.trim().length > 0);
    
    if (this.editor) {
      this.editor.dispatch({
        changes: {
          from: 0,
          to: this.editor.state.doc.length,
          insert: this._value
        }
      });
      console.log('setValue completed, _value updated to:', this._value.substring(0, 50) + '...');
    } else {
      console.log('Editor not available for setValue');
    }
  }
  
  focus(): void {
    this.editor?.focus();
  }
  
  blur(): void {
    this.editor?.contentDOM.blur();
  }
  
  insertText(text: string): void {
    if (this.editor) {
      const selection = this.editor.state.selection.main;
      this.editor.dispatch({
        changes: {
          from: selection.from,
          to: selection.to,
          insert: text
        }
      });
    }
  }
  
  getSelection(): string {
    if (this.editor) {
      const selection = this.editor.state.selection.main;
      return this.editor.state.doc.sliceString(selection.from, selection.to);
    }
    return '';
  }
  
  replaceSelection(text: string): void {
    if (this.editor) {
      const selection = this.editor.state.selection.main;
      this.editor.dispatch({
        changes: {
          from: selection.from,
          to: selection.to,
          insert: text
        }
      });
    }
  }
  
  formatCode(): void {
    if (!this.editor) {
      return;
    }

    const code = this.getValue();
    if (!code || !code.trim()) {
      return;
    }

    // Save cursor position before formatting
    const cursorPosition = this.getCursorPosition();
    const selection = this.editor.state.selection.main;
    const cursorOffset = selection.from;
    
    // Get the line and column for cursor position tracking
    const cursorLine = cursorPosition?.line || 1;
    const cursorColumn = cursorPosition?.column || 1;

    // Format using the service (simple, reliable formatting)
    const result = this.cqlFormatterService.format(code, {
      indentSize: 2
    });

    if (!result.success) {
      // Show error to user
      console.error('Formatting failed:', result.errors);
      
      // Prepare user-friendly error messages
      const errorMessages = result.errors || [];
      
      if (errorMessages.length > 0) {
        // Emit syntax errors for display in problems panel
        this.syntaxErrors.emit(errorMessages.map(e => `Error: ${e}`));
        
        // Also update editor state
        this.editorStateChange.emit({
          cursorPosition: cursorPosition || { line: 1, column: 1 },
          wordCount: this.getWordCount() || 0,
          syntaxErrors: errorMessages.map(e => `Error: ${e}`),
          isValidSyntax: false
        });
      }
      
      // Don't format if formatting itself failed
      return;
    }

    // Calculate new cursor position
    const newCursorPosition = this.calculateNewCursorPosition(
      code,
      result.formatted,
      cursorLine,
      cursorColumn
    );

    // Set formatted code
    try {
      this.setValue(result.formatted);
      
      // Clear any previous syntax errors since formatting succeeded
      this.syntaxErrors.emit([]);
      
      // Update editor state to reflect successful formatting
      this.editorStateChange.emit({
        cursorPosition: newCursorPosition || cursorPosition || { line: 1, column: 1 },
        wordCount: this.getWordCount() || 0,
        syntaxErrors: [],
        isValidSyntax: true
      });

      // Restore cursor position after a brief delay to allow editor to update
      setTimeout(() => {
        if (this.editor && newCursorPosition) {
          try {
            const line = this.editor.state.doc.line(newCursorPosition.line);
            const position = Math.min(
              line.from + newCursorPosition.column - 1,
              line.to
            );
            
            this.editor.dispatch({
              selection: { anchor: position, head: position },
              scrollIntoView: true
            });
            
            this.editor.focus();
          } catch (error) {
            console.warn('Failed to restore cursor position:', error);
            // Fallback: just focus the editor
            this.editor.focus();
          }
        }
      }, 0);
    } catch (error) {
      console.error('Error applying formatted code:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.syntaxErrors.emit([`Failed to apply formatting: ${errorMessage}`]);
    }
  }

  clearCode(): void {
    this.setValue('');
    // setValue already updates the form validity signal
  }

  validateSyntax(code: string): void {
    // Validation is now handled by the lint extension and debounced validation
    // This method is kept for backward compatibility but triggers immediate validation
    this.performValidation(code);
  }

  /**
   * Create lint source function for CodeMirror
   * Uses debouncing to avoid validating on every keystroke
   */
  private createLintSource() {
    return (view: EditorView): Promise<Diagnostic[]> => {
      const code = view.state.doc.toString();
      if (!code || !code.trim()) {
        this.currentValidationErrors = [];
        this.syntaxErrors.emit([]);
        return Promise.resolve([]);
      }

      return new Promise((resolve) => {
        // Add this resolver to pending list
        this.pendingLintResolvers.push(resolve);

        // Clear any existing timeout
        if (this.validationTimeout) {
          clearTimeout(this.validationTimeout);
        }

        // Debounce validation - only the last call will execute
        // Use the current editor state when timeout executes to get latest code
        this.validationTimeout = setTimeout(() => {
          try {
            // Get the latest code from the editor state (in case it changed during debounce)
            const latestCode = this.editor?.state.doc.toString() || code;
            const latestDoc = this.editor?.state.doc;
            
            if (!latestDoc) {
              // Editor was destroyed, resolve with empty diagnostics
              const resolvers = this.pendingLintResolvers;
              this.pendingLintResolvers = [];
              resolvers.forEach(r => r([]));
              return;
            }

            // Use validation service to get errors with positions
            const validationResult = this.cqlValidationService.validate(latestCode, latestDoc);
            
            // Convert ValidationError[] to Diagnostic[]
            const diagnostics: Diagnostic[] = [
              ...validationResult.errors.map(err => ({
                from: err.from,
                to: err.to,
                severity: 'error' as const,
                message: err.message
              })),
              ...validationResult.warnings.map(warn => ({
                from: warn.from,
                to: warn.to,
                severity: 'warning' as const,
                message: warn.message
              }))
            ];

            // Update current validation errors for Problems panel
            // Use structured errors for better line/column information
            const structuredErrors = this.cqlValidationService.getStructuredErrors(latestCode);
            const structuredWarnings = this.cqlValidationService.getStructuredWarnings(latestCode);
            
            // Format for Problems panel (backward compatible with string format)
            this.currentValidationErrors = [
              ...structuredErrors.map(e => `Error: ${e.formattedMessage}`),
              ...structuredWarnings.map(w => `Warning: ${w.formattedMessage}`)
            ];

            // Emit syntax errors for Problems panel
            this.syntaxErrors.emit(this.currentValidationErrors);

            // Update editor state
            if (this.editor) {
              this.editorStateChange.emit({
                cursorPosition: this.getCursorPosition(),
                wordCount: this.getWordCount(),
                syntaxErrors: this.currentValidationErrors,
                isValidSyntax: validationResult.errors.length === 0
              });
            }

            // Resolve all pending lint requests with the same result
            const resolvers = this.pendingLintResolvers;
            this.pendingLintResolvers = [];
            resolvers.forEach(r => r(diagnostics));
          } catch (error) {
            console.error('Validation error:', error);
            const resolvers = this.pendingLintResolvers;
            this.pendingLintResolvers = [];
            resolvers.forEach(r => r([]));
          }
        }, this.VALIDATION_DEBOUNCE_MS);
      });
    };
  }


  /**
   * Perform immediate validation (for manual validation button)
   */
  private performValidation(code: string): void {
    if (!this.editor) {
      return;
    }

    // Clear debounce and validate immediately
    if (this.validationTimeout) {
      clearTimeout(this.validationTimeout);
    }

    // Get structured errors for Problems panel
    const structuredErrors = this.cqlValidationService.getStructuredErrors(code);
    const structuredWarnings = this.cqlValidationService.getStructuredWarnings(code);
    
    // Format for Problems panel (backward compatible with string format)
    this.currentValidationErrors = [
      ...structuredErrors.map(e => `Error: ${e.formattedMessage}`),
      ...structuredWarnings.map(w => `Warning: ${w.formattedMessage}`)
    ];

    // Emit syntax errors
    this.syntaxErrors.emit(this.currentValidationErrors);

    // Update editor state
    this.editorStateChange.emit({
      cursorPosition: this.getCursorPosition(),
      wordCount: this.getWordCount(),
      syntaxErrors: this.currentValidationErrors,
      isValidSyntax: structuredErrors.length === 0
    });

    // Force lint update by dispatching a transaction
    this.editor.dispatch({
      effects: []
    });
  }

  navigateToLine(lineNumber: number): void {
    if (!this.editor) {
      console.warn('Editor not available for navigation');
      return;
    }

    try {
      const line = this.editor.state.doc.line(lineNumber);
      const position = line.from;
      
      this.editor.dispatch({
        selection: { anchor: position, head: position },
        scrollIntoView: true
      });
      
      this.editor.focus();
    } catch (error) {
      console.error(`Failed to navigate to line ${lineNumber}:`, error);
    }
  }

  // Private helper methods

  private reinitializeEditor(): void {
    if (this.editor && !this.isInitializing) {
      console.log('Reinitializing editor');
      const currentValue = this.getValue();
      this.editor.destroy();
      this.editor = undefined;
      this.isInitializing = false; // Reset flag
      this.initializeEditor();
      // Set value immediately after initialization
      if (this.editor) {
        this.setValue(currentValue);
      }
    }
  }

  /**
   * Calculate new cursor position after formatting
   * Attempts to preserve cursor position relative to the content
   */
  private calculateNewCursorPosition(
    originalCode: string,
    formattedCode: string,
    originalLine: number,
    originalColumn: number
  ): { line: number; column: number } | null {
    try {
      const originalLines = originalCode.split('\n');
      const formattedLines = formattedCode.split('\n');

      // If cursor is beyond the document, place at end
      if (originalLine > originalLines.length) {
        const lastLine = formattedLines[formattedLines.length - 1] || '';
        return {
          line: formattedLines.length,
          column: lastLine.length + 1
        };
      }

      // Get the original line content up to the cursor
      const originalLineContent = originalLines[originalLine - 1] || '';
      const textBeforeCursor = originalLineContent.substring(0, originalColumn - 1);

      // Try to find the same text in the formatted code
      // First, try to find the same line number
      if (originalLine <= formattedLines.length) {
        const formattedLineContent = formattedLines[originalLine - 1];
        
        // Try to find the position in the formatted line
        // Simple approach: find the same text pattern
        const searchText = textBeforeCursor.trim();
        if (searchText) {
          const index = formattedLineContent.indexOf(searchText);
          if (index >= 0) {
            return {
              line: originalLine,
              column: index + searchText.length + 1
            };
          }
        }

        // Fallback: use the same column if line exists
        return {
          line: originalLine,
          column: Math.min(originalColumn, formattedLineContent.length + 1)
        };
      }

      // If line doesn't exist in formatted code, place at end
      const lastLine = formattedLines[formattedLines.length - 1] || '';
      return {
        line: formattedLines.length,
        column: lastLine.length + 1
      };
    } catch (error) {
      console.warn('Error calculating cursor position:', error);
      return null;
    }
  }

  private setupResizeObserver(): void {
    if (!this.editorContainer()?.nativeElement || this.editor) {
      return;
    }

    this.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0 && !this.editor && !this.isInitializing) {
          console.log('ResizeObserver detected container dimensions, initializing editor');
          this.initializeEditor();
          this.resizeObserver?.disconnect();
        }
      }
    });

    this.resizeObserver.observe(this.editorContainer()!.nativeElement);
  }

  private getCursorPosition(): { line: number; column: number } | undefined {
    if (!this.editor) return undefined;
    
    const selection = this.editor.state.selection.main;
    const line = this.editor.state.doc.lineAt(selection.from).number;
    const column = selection.from - this.editor.state.doc.lineAt(selection.from).from;
    return { line, column };
  }

  private getWordCount(): number | undefined {
    if (!this.editor) return undefined;
    
    const text = this.editor.state.doc.toString();
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
  }

  private getSyntaxErrors(): string[] {
    return this.currentValidationErrors;
  }

  private getIsValidSyntax(): boolean {
    // Check if there are any errors (warnings don't count as invalid)
    return !this.currentValidationErrors.some(err => err.startsWith('Error:'));
  }

  // Toolbar methods
  
  // Update the canExecute signal
  private updateCanExecute(): void {
    // Get content for this specific library
    const currentContent = this.getLibraryContent();
    const hasContent = currentContent.trim().length > 0;
    if (!hasContent) {
      this._canExecuteSignal.set(false);
      return;
    }
    
    // Get the library resource for this editor
    const library = this.ideStateService.libraryResources().find(lib => lib.id === this.libraryId());
    if (!library) {
      this._canExecuteSignal.set(false);
      return;
    }
    
    // More robust dirty check - normalize whitespace and line endings
    const normalizedCurrent = this.normalizeContent(currentContent);
    const normalizedOriginal = this.normalizeContent(library.originalContent);
    const isDirty = normalizedCurrent !== normalizedOriginal;
    const canExecute = !isDirty;
    
    this._canExecuteSignal.set(canExecute);
    
    // Debug logging
    console.log('canExecute updated:', {
      hasContent,
      libraryId: library.id,
      hasLibrary: !!library.library,
      currentContent: currentContent.substring(0, 50) + '...',
      originalContent: library.originalContent.substring(0, 50) + '...',
      isDirty,
      canExecute
    });
  }



  onExecuteLibrary(): void {
    this.executeLibrary.emit();
  }

  onReloadLibrary(): void {
    this.reloadLibrary.emit();
  }

  onFormatCql(): void {
    this.formatCode();
  }

  onValidateCql(): void {
    // Trigger immediate validation
    const code = this.getValue();
    if (code) {
      this.performValidation(code);
    }
    this.validateCql.emit();
  }

  onSaveLibrary(): void {
    this.saveLibrary.emit();
  }


  // Method to manually update the canExecute signal
  invalidateCanExecuteCache(): void {
    this.updateCanExecute();
  }

  // Method to normalize content for comparison (handles whitespace, line endings, etc.)
  private normalizeContent(content: string): string {
    if (!content) return '';
    
    return content
      .replace(/\r\n/g, '\n')  // Normalize line endings to LF
      .replace(/\r/g, '\n')    // Handle old Mac line endings
      .replace(/\n\s*\n/g, '\n') // Remove empty lines
      .trim(); // Remove leading/trailing whitespace
  }
}
