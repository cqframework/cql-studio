// Author: Preston Lee

import { Component, input, AfterViewInit, effect, ElementRef, viewChild } from '@angular/core';

// Import PrismJS dynamically to avoid CommonJS issues
declare const Prism: any;

@Component({
  selector: 'app-syntax-highlighter',
  imports: [],
  templateUrl: './syntax-highlighter.component.html',

  styleUrls: ['./syntax-highlighter.component.scss']
})
export class SyntaxHighlighterComponent implements AfterViewInit {
  code = input<string>('');
  language = input<string>('json');
  showLineNumbers = input<boolean>(true);
  codeElement = viewChild<ElementRef>('codeElement');
  preElement = viewChild<ElementRef>('preElement');

  private highlightSeq = 0;
  private prismRetryFrames = 0;
  private static readonly MAX_PRISM_RETRY_FRAMES = 10;

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
    if (this.preElement() && this.codeElement()) {
      const codeElement = this.codeElement()!.nativeElement;
      const code = this.code() || '';
      
      // Always update the text content first to ensure Prism has fresh content to highlight
      // This is critical when the code changes - Prism modifies the DOM, so we need to reset it
      codeElement.textContent = code;
      
      if (code && typeof Prism !== 'undefined') {
        this.prismRetryFrames = 0;
        // Auto-detect language if not specified
        const detectedLanguage = this.detectLanguage();
        const languageClass = `language-${detectedLanguage}`;
        
        // Set language on both elements so Prism theme and line-number gutter padding apply to <pre>
        codeElement.className = languageClass;
        this.preElement()!.nativeElement.className = `syntax-highlighter ${languageClass}${this.showLineNumbers() ? ' line-numbers' : ''}`;

        // Defer heavy work (pretty JSON + Prism highlighting) until the browser is idle,
        // so the UI can remain responsive while the console card is being added.
        this.highlightSeq++;
        const scheduledSeq = this.highlightSeq;
        const run = () => {
          if (scheduledSeq !== this.highlightSeq) return;

          // Pretty-print JSON for display (only when the configured language is json).
          let prettyCode = code;
          if (detectedLanguage === 'json') {
            try {
              prettyCode = JSON.stringify(JSON.parse(code), null, 2);
            } catch {
              // If it's not valid JSON, keep the original text.
              prettyCode = code;
            }
          }

          codeElement.textContent = prettyCode;

          // Highlight only this element (avoid highlightAllUnder scanning).
          Prism.highlightElement(codeElement);

          // Open the first few folded nodes to keep the UX usable without massive DOM expansion.
          let opened = 0;
          codeElement.querySelectorAll('details').forEach((el: Element) => {
            if (opened >= 25) return;
            el.setAttribute('open', '');
            opened++;
          });
        };

        const w = window as any;
        if (typeof w.requestIdleCallback === 'function') {
          w.requestIdleCallback(run, { timeout: 1000 });
        } else {
          // Fallback: next frame keeps it off the current call stack.
          requestAnimationFrame(run);
        }
      } else if (!code) {
        // Clear the element if there's no code
        codeElement.textContent = '';
        codeElement.className = '';
        this.preElement()!.nativeElement.className = `syntax-highlighter${this.showLineNumbers() ? ' line-numbers' : ''}`;
      } else {
        if (this.prismRetryFrames < SyntaxHighlighterComponent.MAX_PRISM_RETRY_FRAMES) {
          this.prismRetryFrames++;
          requestAnimationFrame(() => this.highlightCode());
        } else {
          this.prismRetryFrames = 0;
        }
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
