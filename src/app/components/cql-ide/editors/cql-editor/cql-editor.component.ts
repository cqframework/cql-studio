// Author: Preston Lee

import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, AfterViewInit, OnDestroy, OnChanges, SimpleChanges, ChangeDetectorRef, signal, computed } from '@angular/core';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { defaultKeymap, historyKeymap } from '@codemirror/commands';
import { searchKeymap } from '@codemirror/search';
import { highlightSpecialChars } from '@codemirror/view';
import { bracketMatching } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { CqlGrammarManager, CqlVersion } from '../../../../services/cql-grammar-manager.service';
import { IdeEditor, EditorState as IdeEditorState } from '../base-editor.interface';
import { IdeStateService } from '../../../../services/ide-state.service';

// Custom highlight style for dark theme
const darkHighlightStyle = {
  define: [
    { tag: tags.keyword, color: '#569cd6' },
    { tag: tags.string, color: '#ce9178' },
    { tag: tags.comment, color: '#6a9955' },
    { tag: tags.number, color: '#b5cea8' },
    { tag: tags.variableName, color: '#9cdcfe' },
    { tag: tags.typeName, color: '#4ec9b0' },
    { tag: tags.operator, color: '#ffffff' },
    { tag: tags.punctuation, color: '#ffffff' },
    { tag: tags.propertyName, color: '#9cdcfe' },
    { tag: tags.attributeName, color: '#92c5f8' },
    { tag: tags.tagName, color: '#569cd6' },
    { tag: tags.name, color: '#dcdcaa' },
    { tag: tags.literal, color: '#4fc1ff' },
    { tag: tags.meta, color: '#569cd6' },
    { tag: tags.heading, color: '#569cd6' },
    { tag: tags.quote, color: '#6a9955' },
    { tag: tags.link, color: '#569cd6' },
    { tag: tags.url, color: '#ce9178' },
    { tag: tags.strong, color: '#ffffff', fontWeight: 'bold' },
    { tag: tags.emphasis, color: '#ffffff', fontStyle: 'italic' },
    { tag: tags.strikethrough, color: '#ffffff', textDecoration: 'line-through' }
  ]
};

@Component({
  selector: 'app-cql-editor',
  standalone: true,
  imports: [],
  templateUrl: './cql-editor.component.html',
  styleUrls: ['./cql-editor.component.scss']
})
export class CqlEditorComponent implements AfterViewInit, OnDestroy, OnChanges, IdeEditor {
  @ViewChild('editorContainer', { static: false }) editorContainer?: ElementRef<HTMLDivElement>;
  
  @Input() libraryId: string = '';
  @Input() editorState: any;
  @Input() placeholder: string = 'Enter CQL code here...';
  @Input() height: string = '500px';
  @Input() readonly: boolean = false;
  @Input() cqlVersion: CqlVersion = '1.5.3';
  @Input() isNewLibrary: boolean = false;
  
  @Output() contentChange = new EventEmitter<{ cursorPosition: { line: number; column: number }, wordCount: number, content: string }>();
  @Output() cursorChange = new EventEmitter<{ line: number; column: number }>();
  @Output() editorStateChange = new EventEmitter<IdeEditorState>();
  @Output() syntaxErrors = new EventEmitter<string[]>();
  @Output() executeLibrary = new EventEmitter<void>();
  @Output() reloadLibrary = new EventEmitter<void>();
  @Output() cqlVersionChange = new EventEmitter<string>();
  @Output() formatCql = new EventEmitter<void>();
  @Output() validateCql = new EventEmitter<void>();
  @Output() saveLibrary = new EventEmitter<void>();

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

  constructor(private cdr: ChangeDetectorRef, private ideStateService: IdeStateService) {
    this.grammarManager = new CqlGrammarManager(this.cqlVersion);
  }

  // Get content for this specific library
  private getLibraryContent(): string {
    if (!this.libraryId) return '';
    const library = this.ideStateService.libraryResources().find(lib => lib.id === this.libraryId);
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

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['cqlVersion'] && !changes['cqlVersion'].firstChange) {
      this.grammarManager.setVersion(this.cqlVersion);
      this.reinitializeEditor();
    }
    
    if (changes['libraryId'] && !changes['libraryId'].firstChange) {
      console.log('Library ID changed, reinitializing editor for:', this.libraryId);
      // When library ID changes, reinitialize the editor with the new library's content
      if (this.editor) {
        this.reinitializeEditor();
      }
      // Update canExecute state for new library
      this.updateCanExecute();
    }
  }
  
  ngOnDestroy(): void {
    this.editor?.destroy();
    this.resizeObserver?.disconnect();
  }

  private initializeEditor(): void {
    console.log('initializeEditor called', {
      editorContainer: !!this.editorContainer?.nativeElement,
      currentValue: this._value.substring(0, 100) + '...',
      editorExists: !!this.editor,
      isInitializing: this.isInitializing
    });
    
    if (this.isInitializing) {
      console.log('Already initializing, skipping');
      return;
    }
    
    if (!this.editorContainer?.nativeElement) {
      console.log('Editor container not ready, returning');
      return;
    }
    
    if (this.editor) {
      console.log('Editor already exists, updating content');
      return;
    }
    
    this.isInitializing = true;
    
    const container = this.editorContainer.nativeElement;
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
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
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
              height: this.height,
              fontSize: '14px',
              fontFamily: "'Courier New', Courier, monospace"
            },
            '.cm-content': {
              padding: '12px',
              minHeight: this.height,
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
              
              const cursor = this.getCursorPosition();
              const wordCount = this.getWordCount();
              this.contentChange.emit({ 
                cursorPosition: cursor || { line: 1, column: 1 }, 
                wordCount: wordCount || 0,
                content: newValue
              });
              
              // Update canExecute state after content change
              this.updateCanExecute();
              
              // Library resource update will be handled by parent component
              // to avoid change detection issues
            }
            
            if (update.selectionSet) {
              const selection = update.state.selection.main;
              const line = update.state.doc.lineAt(selection.from).number;
              const column = selection.from - update.state.doc.lineAt(selection.from).from;
              this.cursorChange.emit({ line, column });
            }
            
            // Update word count and validate syntax
            const text = update.state.doc.toString();
            const wordCount = text.trim().split(/\s+/).filter(word => word.length > 0).length;
            this.validateSyntax(text);
            
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
        parent: this.editorContainer.nativeElement
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
    if (this.editor) {
      const code = this.getValue();
      const formatted = this.formatCqlCode(code);
      this.setValue(formatted);
    }
  }

  clearCode(): void {
    this.setValue('');
    // setValue already updates the form validity signal
  }

  validateSyntax(code: string): void {
    // This would be implemented with the grammar manager
    // For now, just emit the validation result
    this.editorStateChange.emit({
      cursorPosition: this.getCursorPosition(),
      wordCount: this.getWordCount(),
      syntaxErrors: this.getSyntaxErrors(),
      isValidSyntax: this.getIsValidSyntax()
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

  private formatCqlCode(code: string): string {
    // Enhanced CQL formatting logic would go here
    return code;
  }

  private setupResizeObserver(): void {
    if (!this.editorContainer?.nativeElement || this.editor) {
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

    this.resizeObserver.observe(this.editorContainer.nativeElement);
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
    // This would be implemented with the grammar manager
    return [];
  }

  private getIsValidSyntax(): boolean {
    // This would be implemented with the grammar manager
    return true;
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
    const library = this.ideStateService.libraryResources().find(lib => lib.id === this.libraryId);
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

  onCqlVersionChange(event: Event): void {
    const target = event.target as HTMLSelectElement;
    if (target && target.value) {
      this.cqlVersionChange.emit(target.value);
    }
  }

  onFormatCql(): void {
    this.formatCql.emit();
  }

  onValidateCql(): void {
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
