// Author: Preston Lee

import { Component, input, AfterViewInit, effect, ElementRef, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';

// Import PrismJS dynamically to avoid CommonJS issues
declare const Prism: any;

@Component({
  selector: 'app-syntax-highlighter',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './syntax-highlighter.component.html',
  styleUrls: ['./syntax-highlighter.component.scss']
})
export class SyntaxHighlighterComponent implements AfterViewInit {
  code = input<string>('');
  language = input<string>('json');
  showLineNumbers = input<boolean>(true);
  codeElement = viewChild<ElementRef>('codeElement');
  preElement = viewChild<ElementRef>('preElement');

  constructor() {
    // Reactively highlight code when inputs change
    effect(() => {
      const code = this.code();
      const language = this.language();
      if (code || language) {
        this.highlightCode();
      }
    });
  }

  ngAfterViewInit(): void {
    this.highlightCode();
  }

  private highlightCode(): void {
    if (this.preElement() && this.code()) {
      if (typeof Prism !== 'undefined') {
        // Auto-detect language if not specified
        const detectedLanguage = this.detectLanguage();
        const languageClass = `language-${detectedLanguage}`;
        
        // Set the language class on the code element
        if (this.codeElement()) {
          this.codeElement()!.nativeElement.className = languageClass;
        }
        
        // Use PrismJS to highlight and apply line numbers
        Prism.highlightAllUnder(this.preElement()!.nativeElement);
      } else {
        // PrismJS not loaded yet, retry after a short delay
        setTimeout(() => {
          this.highlightCode();
        }, 100);
      }
    }
  }

  private detectLanguage(): string {
    const lang = this.language();
    if (lang && lang !== 'auto') {
      return lang;
    }

    // Auto-detect based on content
    const trimmedCode = this.code().trim();
    
    // Check for JSON
    if (trimmedCode.startsWith('{') || trimmedCode.startsWith('[')) {
      try {
        JSON.parse(trimmedCode);
        return 'json';
      } catch {
        // Not valid JSON, continue detection
      }
    }
    
    // Check for XML
    if (trimmedCode.startsWith('<')) {
      return 'xml-doc';
    }
    
    // Check for JavaScript
    if (trimmedCode.includes('function') || trimmedCode.includes('=>')) {
      return 'javascript';
    }
    
    // Default to JSON for most cases
    return 'json';
  }
}
