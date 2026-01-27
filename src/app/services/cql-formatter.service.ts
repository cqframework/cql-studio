// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { TranslationService } from './translation.service';
import { CqlGrammarManager } from './cql-grammar-manager.service';

export interface FormatOptions {
  validateBeforeFormat?: boolean;
  indentSize?: number;
  preserveComments?: boolean;
}

export interface FormatResult {
  formatted: string;
  success: boolean;
  errors?: string[];
  warnings?: string[];
}

interface CqlSection {
  type: 'library' | 'using' | 'context' | 'parameter' | 'function' | 'define' | 'comment' | 'empty' | 'other';
  content: string;
  originalLines: number[];
  indentLevel: number;
}

@Injectable({
  providedIn: 'root'
})
export class CqlFormatterService {
  private translationService = inject(TranslationService);
  private indentSize = 2;

  /**
   * Format CQL code according to official CQL formatting conventions
   */
  format(cql: string, options: FormatOptions = {}): FormatResult {
    const opts: Required<FormatOptions> = {
      validateBeforeFormat: options.validateBeforeFormat ?? true,
      indentSize: options.indentSize ?? 2,
      preserveComments: options.preserveComments ?? true
    };

    this.indentSize = opts.indentSize;

    // Validate before formatting if requested
    if (opts.validateBeforeFormat) {
      const validation = this.validate(cql);
      if (validation.hasErrors) {
        return {
          formatted: cql,
          success: false,
          errors: validation.errors,
          warnings: validation.warnings
        };
      }
    }

    try {
      const formatted = this.formatCode(cql, opts);
      return {
        formatted,
        success: true
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        formatted: cql,
        success: false,
        errors: [`Formatting failed: ${errorMessage}`]
      };
    }
  }

  /**
   * Validate CQL code using the translation service
   */
  private validate(cql: string): { hasErrors: boolean; errors: string[]; warnings: string[] } {
    const result = this.translationService.translateCqlToElm(cql);
    return {
      hasErrors: result.hasErrors,
      errors: result.errors,
      warnings: result.warnings
    };
  }

  /**
   * Main formatting logic
   */
  private formatCode(cql: string, options: Required<FormatOptions>): string {
    if (!cql || !cql.trim()) {
      return cql;
    }

    const sections = this.parseSections(cql);
    const formattedSections: string[] = [];
    let previousSectionType: string = '';

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      
      // Add blank line between major sections
      if (section.type !== 'empty' && section.type !== 'comment' && 
          previousSectionType && previousSectionType !== section.type &&
          (previousSectionType === 'library' || previousSectionType === 'using' || 
           previousSectionType === 'context' || previousSectionType === 'parameter' ||
           previousSectionType === 'function' || previousSectionType === 'define')) {
        if (formattedSections.length > 0 && formattedSections[formattedSections.length - 1].trim()) {
          formattedSections.push('');
        }
      }

      const formatted = this.formatSection(section, options);
      if (formatted) {
        formattedSections.push(formatted);
      }

      if (section.type !== 'empty') {
        previousSectionType = section.type;
      }
    }

    // Remove trailing empty lines
    while (formattedSections.length > 0 && !formattedSections[formattedSections.length - 1].trim()) {
      formattedSections.pop();
    }

    const result = formattedSections.join('\n');
    return result + (cql.endsWith('\n') ? '\n' : '');
  }

  /**
   * Parse CQL into logical sections
   */
  private parseSections(cql: string): CqlSection[] {
    const lines = cql.split('\n');
    const sections: CqlSection[] = [];
    let currentSection: CqlSection | null = null;
    let indentLevel = 0;
    let inMultiLineComment = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Track multi-line comments
      if (trimmed.includes('/*')) {
        inMultiLineComment = true;
      }
      if (trimmed.includes('*/')) {
        inMultiLineComment = false;
      }

      // Empty lines
      if (!trimmed) {
        if (currentSection && currentSection.type !== 'empty') {
          sections.push(currentSection);
          currentSection = null;
        }
        sections.push({
          type: 'empty',
          content: '',
          originalLines: [i],
          indentLevel: 0
        });
        continue;
      }

      // Comments
      if (trimmed.startsWith('//') || inMultiLineComment || trimmed.includes('/*') || trimmed.includes('*/')) {
        if (currentSection && currentSection.type !== 'comment') {
          sections.push(currentSection);
          currentSection = null;
        }
        if (!currentSection) {
          currentSection = {
            type: 'comment',
            content: line,
            originalLines: [i],
            indentLevel: 0
          };
        } else {
          currentSection.content += '\n' + line;
          currentSection.originalLines.push(i);
        }
        continue;
      }

      // Detect section type
      let sectionType: CqlSection['type'] = 'other';
      if (trimmed.match(/^library\s+/i)) {
        sectionType = 'library';
        indentLevel = 0;
      } else if (trimmed.match(/^using\s+/i)) {
        sectionType = 'using';
        indentLevel = 0;
      } else if (trimmed.match(/^context\s+/i)) {
        sectionType = 'context';
        indentLevel = 0;
      } else if (trimmed.match(/^parameter\s+/i)) {
        sectionType = 'parameter';
        indentLevel = 0;
      } else if (trimmed.match(/^function\s+/i)) {
        sectionType = 'function';
        indentLevel = 0;
      } else if (trimmed.match(/^define\s+/i)) {
        sectionType = 'define';
        indentLevel = 0;
      }

      // Calculate indent level for non-section-start lines
      if (sectionType === 'other' && currentSection) {
        // Check if this line should be indented (part of a block)
        if (trimmed.match(/^[}\]\)]/)) {
          indentLevel = Math.max(0, indentLevel - 1);
        }
      }

      // Start new section or continue current
      if (sectionType !== 'other') {
        if (currentSection && currentSection.type !== sectionType) {
          sections.push(currentSection);
        }
        currentSection = {
          type: sectionType,
          content: line,
          originalLines: [i],
          indentLevel: 0
        };
      } else {
        if (!currentSection) {
          currentSection = {
            type: 'other',
            content: line,
            originalLines: [i],
            indentLevel: indentLevel
          };
        } else {
          currentSection.content += '\n' + line;
          currentSection.originalLines.push(i);
          currentSection.indentLevel = indentLevel;
        }
      }

      // Update indent level for next iteration
      if (trimmed.match(/[{\[\(]/) && !trimmed.match(/[}\]\)]/)) {
        indentLevel++;
      } else if (sectionType === 'define' || sectionType === 'function' || sectionType === 'parameter') {
        // Check if line ends with colon (CQL pattern for block start)
        if (trimmed.endsWith(':') || trimmed.match(/:\s*$/)) {
          indentLevel++;
        }
      }
    }

    if (currentSection) {
      sections.push(currentSection);
    }

    return sections;
  }

  /**
   * Format a single section
   */
  private formatSection(section: CqlSection, options: Required<FormatOptions>): string {
    if (section.type === 'empty') {
      return '';
    }

    if (section.type === 'comment') {
      return options.preserveComments ? section.content : section.content.trim();
    }

    const lines = section.content.split('\n');
    const formattedLines: string[] = [];
    let currentIndent = section.indentLevel;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) {
        formattedLines.push('');
        continue;
      }

      // Calculate indentation
      if (trimmed.match(/^[}\]\)]/)) {
        currentIndent = Math.max(0, currentIndent - 1);
      }

      const indent = ' '.repeat(currentIndent * this.indentSize);
      const formattedLine = this.formatLine(trimmed, section.type);

      formattedLines.push(indent + formattedLine);

      // Update indent for next line
      if (trimmed.match(/[{\[\(]/) && !trimmed.match(/[}\]\)]/)) {
        currentIndent++;
      } else if (trimmed.endsWith(':') || trimmed.match(/:\s*$/)) {
        if (section.type === 'define' || section.type === 'function' || section.type === 'parameter') {
          currentIndent++;
        }
      } else if (trimmed.match(/^\s*(if|then|where|let|with|return)\s+/i) && 
                 !trimmed.match(/^(define|function|parameter|library|using|context)\s+/i)) {
        // Check if this is a multi-line construct
        if (i < lines.length - 1) {
          const nextLine = lines[i + 1]?.trim() || '';
          if (nextLine && !nextLine.match(/^(define|function|parameter|library|using|context|if|then|else|end)\s+/i)) {
            if (!trimmed.match(/;\s*$/)) {
              currentIndent++;
            }
          }
        }
      }
    }

    return formattedLines.join('\n');
  }

  /**
   * Format a single line according to CQL conventions
   */
  private formatLine(line: string, sectionType: CqlSection['type']): string {
    // Preserve strings and comments
    const stringPlaceholders: string[] = [];
    let placeholderIndex = 0;
    const placeholderPrefix = `__CQL_STRING_${Date.now()}_`;

    // Replace strings with placeholders
    let processed = line.replace(/"([^"\\]*(\\.[^"\\]*)*)"|'([^'\\]*(\\.[^'\\]*)*)'/g, (match) => {
      const placeholder = `${placeholderPrefix}${placeholderIndex++}__`;
      stringPlaceholders.push(match);
      return placeholder;
    });

    // Normalize whitespace (but preserve structure)
    processed = processed.replace(/\s+/g, ' ').trim();

    // Format operators with proper spacing
    processed = this.formatOperators(processed);

    // Format keywords (ensure lowercase and proper spacing)
    processed = this.formatKeywords(processed);

    // Format punctuation
    processed = this.formatPunctuation(processed);

    // Restore strings
    stringPlaceholders.forEach((originalString, index) => {
      const placeholder = `${placeholderPrefix}${index}__`;
      processed = processed.replace(placeholder, originalString);
    });

    // Final cleanup
    processed = processed.replace(/\s+/g, ' ').trim();

    return processed;
  }

  /**
   * Format operators with proper spacing
   */
  private formatOperators(line: string): string {
    // Operators that need spaces around them
    const operators = ['+', '-', '*', '/', '=', '<>', '!=', '<', '>', '<=', '>=', 'and', 'or', 'not', 'xor', 'implies'];
    
    // Sort by length to match longer operators first
    const sortedOps = operators.sort((a, b) => b.length - a.length);

    for (const op of sortedOps) {
      if (op.length > 0) {
        const escapedOp = op.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        // Add space around operator (avoid double spaces)
        line = line.replace(
          new RegExp(`([^\\s])${escapedOp}([^\\s])`, 'g'),
          `$1 ${op} $2`
        );
        
        // Handle operators at start of line
        line = line.replace(
          new RegExp(`^${escapedOp}([^\\s])`, 'g'),
          `${op} $1`
        );
        
        // Handle operators at end of line
        line = line.replace(
          new RegExp(`([^\\s])${escapedOp}$`, 'g'),
          `$1 ${op}`
        );
      }
    }

    return line;
  }

  /**
   * Format keywords (ensure lowercase and proper spacing)
   */
  private formatKeywords(line: string): string {
    const keywords = [
      'library', 'using', 'context', 'parameter', 'function', 'define',
      'return', 'if', 'then', 'else', 'where', 'let', 'with', 'as',
      'from', 'and', 'or', 'not', 'null', 'true', 'false'
    ];

    // Sort by length (longest first) to avoid partial matches
    const sortedKeywords = keywords.sort((a, b) => b.length - a.length);

    for (const keyword of sortedKeywords) {
      // First, normalize case
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
      line = line.replace(regex, keyword.toLowerCase());
      
      // Then ensure space after keyword (but not if followed by parenthesis, colon, or already has space)
      line = line.replace(
        new RegExp(`\\b${keyword.toLowerCase()}(?!\\s*[(:\\s])(?=\\S)`, 'g'),
        keyword.toLowerCase() + ' '
      );
    }

    return line;
  }

  /**
   * Format punctuation with proper spacing
   */
  private formatPunctuation(line: string): string {
    // Colons: space around (for type annotations)
    line = line.replace(/\s*:\s*/g, ' : ');
    
    // Commas: space after
    line = line.replace(/\s*,\s*/g, ', ');
    
    // Semicolons: space after
    line = line.replace(/\s*;\s*/g, '; ');
    
    // Parentheses: no space inside
    line = line.replace(/\s*\(\s*/g, '(');
    line = line.replace(/\s*\)\s*/g, ')');
    
    // Clean up multiple spaces
    line = line.replace(/\s+/g, ' ').trim();

    return line;
  }
}
