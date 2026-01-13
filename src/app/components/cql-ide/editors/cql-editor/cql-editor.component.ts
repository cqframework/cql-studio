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
    if (!code || !code.trim()) {
      return code;
    }

    const grammar = this.grammarManager.getCurrentGrammar();
    const keywords = grammar.keywords;
    const operators = grammar.operators;
    const functions = grammar.functions;
    
    // Build regex patterns for grammar-aware tokenization
    const keywordPattern = new RegExp(`\\b(${keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');
    const functionPattern = new RegExp(`\\b(${functions.map(f => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');
    
    const lines = code.split('\n');
    const formatted: string[] = [];
    let indentLevel = 0;
    const indentSize = 2;
    let previousSection: string = '';
    let inMultiLineComment = false;

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      const trimmed = line.trim();

      // Track multi-line comments
      if (trimmed.includes('/*')) {
        inMultiLineComment = true;
      }
      if (trimmed.includes('*/')) {
        inMultiLineComment = false;
      }

      // Skip empty lines but preserve one between sections
      if (!trimmed) {
        if (formatted.length > 0 && formatted[formatted.length - 1].trim()) {
          formatted.push('');
        }
        continue;
      }

      // Detect section type using grammar keywords
      let sectionType = '';
      if (trimmed.match(/^library\s+/i)) sectionType = 'library';
      else if (trimmed.match(/^using\s+/i)) sectionType = 'using';
      else if (trimmed.match(/^context\s+/i)) sectionType = 'context';
      else if (trimmed.match(/^parameter\s+/i)) sectionType = 'parameter';
      else if (trimmed.match(/^function\s+/i)) sectionType = 'function';
      else if (trimmed.match(/^define\s+/i)) sectionType = 'define';

      // Add blank line between major sections
      if (sectionType && previousSection && previousSection !== sectionType) {
        if (formatted.length > 0 && formatted[formatted.length - 1].trim()) {
          formatted.push('');
        }
      }
      if (sectionType) {
        previousSection = sectionType;
      }

      // Calculate indentation - decrease for closing braces
      if (trimmed.match(/^[}\]\)]/) && !inMultiLineComment) {
        indentLevel = Math.max(0, indentLevel - 1);
      }

      // Format line with proper indentation
      const indent = ' '.repeat(indentLevel * indentSize);
      let formattedLine = trimmed;

      // Enhanced formatting: grammar-aware spacing (but preserve strings and comments)
      if (!inMultiLineComment && !trimmed.match(/^\/\//) && !trimmed.match(/\/\*/)) {
        // Preserve strings by temporarily replacing them
        const stringPlaceholders: string[] = [];
        let placeholderIndex = 0;
        const placeholderPrefix = `__CQL_STRING_PLACEHOLDER_${Date.now()}_`;
        
        // Replace strings with placeholders (handle both single and double quotes)
        formattedLine = formattedLine.replace(/"([^"\\]*(\\.[^"\\]*)*)"|'([^'\\]*(\\.[^'\\]*)*)'/g, (match) => {
          const placeholder = `${placeholderPrefix}${placeholderIndex++}__`;
          stringPlaceholders.push(match);
          return placeholder;
        });

        // Normalize whitespace
        formattedLine = formattedLine.replace(/\s+/g, ' ').trim();

        // Add spaces around operators (sorted by length to match longer operators first)
        const operatorsNeedingSpace = operators.sort((a, b) => b.length - a.length);
        operatorsNeedingSpace.forEach(op => {
          if (op.length > 0) {
            const escapedOp = op.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // Add space around operator, avoiding double spaces
            formattedLine = formattedLine.replace(
              new RegExp(`([^\\s])${escapedOp}([^\\s])`, 'g'),
              `$1 ${op} $2`
            );
            // Handle operators at start/end of line
            formattedLine = formattedLine.replace(
              new RegExp(`^${escapedOp}([^\\s])`, 'g'),
              `${op} $1`
            );
            formattedLine = formattedLine.replace(
              new RegExp(`([^\\s])${escapedOp}$`, 'g'),
              `$1 ${op}`
            );
          }
        });

        // Normalize spaces around punctuation
        formattedLine = formattedLine
          .replace(/\s*:\s*/g, ' : ')  // Colons: space around
          .replace(/\s*,\s*/g, ', ')   // Commas: space after
          .replace(/\s*;\s*/g, '; ')   // Semicolons: space after
          // Normalize spaces around parentheses (will be cleaned up by final normalize)
          .replace(/\s*\(\s*/g, '(')   // Opening paren: remove surrounding spaces
          .replace(/\s*\)\s*/g, ')')   // Closing paren: remove surrounding spaces
          .replace(/\s+/g, ' ')
          .trim();

        // Ensure space after keywords (but not for keywords that are part of larger constructs)
        const keywordsNeedingSpace = ['library', 'using', 'context', 'parameter', 'function', 'define', 'return', 'if', 'then', 'else', 'where', 'let', 'with', 'as'];
        keywordsNeedingSpace.forEach(keyword => {
          // Add space after keyword if not already followed by space, parenthesis, or colon
          // Use word boundary and negative lookahead to avoid matching inside other words
          formattedLine = formattedLine.replace(
            new RegExp(`\\b${keyword}\\b(?!\\s*[(:])(?=\\S)`, 'gi'),
            (match) => {
              // Only add space if not already present
              return match + ' ';
            }
          );
        });
        // Clean up any double spaces created
        formattedLine = formattedLine.replace(/\s+/g, ' ').trim();

        // Restore strings
        stringPlaceholders.forEach((originalString, index) => {
          const placeholder = `${placeholderPrefix}${index}__`;
          formattedLine = formattedLine.replace(placeholder, originalString);
        });

        // Final cleanup: normalize multiple spaces
        formattedLine = formattedLine.replace(/\s+/g, ' ').trim();
      }

      formatted.push(indent + formattedLine);

      // Increase indent after opening braces or for define/function/parameter bodies
      if (!inMultiLineComment) {
        const hasOpenBrace = trimmed.includes('{') || trimmed.includes('[') || trimmed.includes('(');
        const hasCloseBrace = trimmed.includes('}') || trimmed.includes(']') || trimmed.includes(')');
        
        if (hasOpenBrace && !hasCloseBrace) {
          indentLevel++;
        } else if (sectionType && (sectionType === 'define' || sectionType === 'function' || sectionType === 'parameter')) {
          // Check if next line is part of the body (not a new declaration)
          if (i < lines.length - 1) {
            const nextLine = lines[i + 1]?.trim() || '';
            if (nextLine && !nextLine.match(/^(define|function|parameter|library|using|context)\s+/i)) {
              // Also check if current line ends with colon (CQL pattern)
              if (trimmed.endsWith(':') || trimmed.match(/:\s*$/)) {
                indentLevel++;
              }
            }
          }
        }
        
        // Increase indent for control flow keywords (but be conservative)
        // Only indent for 'if', 'then', 'where', 'let', 'with' that start a block
        if (trimmed.match(/^\s*(if|then|where|let|with)\s+/i) && 
            !trimmed.match(/^(define|function|parameter)\s+/i)) {
          // Check if this is a multi-line construct
          if (i < lines.length - 1) {
            const nextLine = lines[i + 1]?.trim() || '';
            if (nextLine && !nextLine.match(/^(define|function|parameter|library|using|context|if|then|else|end)\s+/i)) {
              // Only indent if current line doesn't have a complete expression ending with semicolon
              if (!trimmed.match(/;\s*$/)) {
                indentLevel++;
              }
            }
          }
        }
      }
    }

    // Remove trailing empty lines
    while (formatted.length > 0 && !formatted[formatted.length - 1].trim()) {
      formatted.pop();
    }

    return formatted.join('\n') + (code.endsWith('\n') ? '\n' : '');
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
    this.formatCode();
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
