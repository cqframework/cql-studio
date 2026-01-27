// Author: Preston Lee

import { Component, input, output, effect, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SettingsService } from '../../../../services/settings.service';
import { TranslationService } from '../../../../services/translation.service';
import { IdeStateService } from '../../../../services/ide-state.service';
import { SyntaxHighlighterComponent } from '../../../shared/syntax-highlighter/syntax-highlighter.component';

@Component({
  selector: 'app-elm-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, SyntaxHighlighterComponent],
  templateUrl: './elm-tab.component.html',
  styleUrls: ['./elm-tab.component.scss']
})
export class ElmTabComponent {
  // Use signal-based inputs (preferred in Angular 21)
  cqlContent = input<string>('');
  isTranslating = input<boolean>(false);
  elmTranslationResults = input<string | null>(null);
  
  // Use signal-based outputs (preferred in Angular 21)
  translateCqlToElm = output<void>();
  clearElmTranslation = output<void>();

  private previousLibraryId: string | null = null;

  // Computed property that formats the ELM XML results
  // This ensures the syntax highlighter always gets the latest formatted XML
  // Since elmTranslationResults is now a signal input, it's automatically reactive
  formattedElmXml = computed(() => {
    const xml = this.elmTranslationResults() || '';
    if (!xml) {
      return '';
    }
    // Format XML using browser-native APIs before passing to Prism
    return this.formatXml(xml);
  });

  constructor(
    public settingsService: SettingsService,
    public translationService: TranslationService,
    public ideStateService: IdeStateService
  ) {
    // Watch for active editor/library changes and reset translation data
    effect(() => {
      const currentLibraryId = this.ideStateService.activeLibraryId();
      
      // If library ID changed (and it's not the initial load), clear all cached translation data
      if (this.previousLibraryId !== null && this.previousLibraryId !== currentLibraryId) {
        this.ideStateService.clearElmTranslationResults();
        this.clearElmTranslation.emit();
      }
      
      // Update previous library ID
      this.previousLibraryId = currentLibraryId;
    });
  }

  get translationErrors(): string[] {
    return this.ideStateService.translationErrors();
  }

  get translationWarnings(): string[] {
    return this.ideStateService.translationWarnings();
  }

  get translationMessages(): string[] {
    return this.ideStateService.translationMessages();
  }

  get hasErrors(): boolean {
    return this.translationErrors.length > 0;
  }

  get hasWarnings(): boolean {
    return this.translationWarnings.length > 0;
  }

  onTranslateCqlToElm(): void {
    this.translateCqlToElm.emit();
  }

  onClearElmTranslation(): void {
    this.clearElmTranslation.emit();
  }

  onDownloadElmXml(): void {
    const xml = this.elmTranslationResults();
    if (!xml) {
      return;
    }
    
    // Get the formatted XML
    const formattedXml = this.formattedElmXml();
    
    // Generate filename from library name if available, otherwise use timestamp
    const activeLibrary = this.ideStateService.getActiveLibraryResource();
    const libraryName = activeLibrary?.name || activeLibrary?.id || 'library';
    const filename = `${libraryName}-elm.xml`;
    
    // Create blob and download
    const blob = new Blob([formattedXml], { type: 'application/xml' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }


  /**
   * Pretty format XML using browser-native APIs (no dependencies required)
   * This formats the XML before Prism highlights it
   */
  private formatXml(xmlString: string): string {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
      
      // Check for parsing errors
      const parseError = xmlDoc.querySelector('parsererror');
      if (parseError) {
        // If parsing fails, return original string
        return xmlString;
      }
      
      // Format with indentation
      return this.formatXmlNode(xmlDoc.documentElement, 0);
    } catch (e) {
      // If formatting fails, return original string
      console.warn('Failed to format XML:', e);
      return xmlString;
    }
  }

  /**
   * Recursively format XML nodes with indentation
   */
  private formatXmlNode(node: Node, indent: number): string {
    const indentStr = '  '.repeat(indent);
    let result = '';
    
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element;
      const tagName = element.tagName;
      
      // Build opening tag with attributes
      let attrs = '';
      for (let i = 0; i < element.attributes.length; i++) {
        const attr = element.attributes[i];
        attrs += ` ${attr.name}="${this.escapeXml(attr.value)}"`;
      }
      
      // Check if element has child nodes
      const hasChildren = element.childNodes.length > 0 && 
        Array.from(element.childNodes).some(n => 
          n.nodeType === Node.ELEMENT_NODE || 
          (n.nodeType === Node.TEXT_NODE && n.textContent && n.textContent.trim().length > 0)
        );
      
      if (!hasChildren) {
        // Self-closing tag
        result += `${indentStr}<${tagName}${attrs} />\n`;
      } else {
        // Opening tag
        result += `${indentStr}<${tagName}${attrs}>\n`;
        
        // Process child nodes
        for (const child of Array.from(element.childNodes)) {
          if (child.nodeType === Node.ELEMENT_NODE) {
            result += this.formatXmlNode(child, indent + 1);
          } else if (child.nodeType === Node.TEXT_NODE && child.textContent) {
            const text = child.textContent.trim();
            if (text.length > 0) {
              result += `${'  '.repeat(indent + 1)}${this.escapeXml(text)}\n`;
            }
          }
        }
        
        // Closing tag
        result += `${indentStr}</${tagName}>\n`;
      }
    }
    
    return result;
  }

  /**
   * Escape XML special characters
   */
  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
