// Author: Preston Lee

import { Injectable } from '@angular/core';

export interface FormatOptions {
  indentSize?: number;
}

export interface FormatResult {
  formatted: string;
  success: boolean;
  errors?: string[];
}

@Injectable({
  providedIn: 'root'
})
export class CqlFormatterService {
  private indentSize = 2;

  /**
   * Format CQL code - simple, reliable formatting similar to reference project approach
   */
  format(cql: string, options: FormatOptions = {}): FormatResult {
    const indentSize = options.indentSize ?? 2;
    this.indentSize = indentSize;

    try {
      const formatted = this.formatCode(cql);
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
   * Simple, reliable formatting logic
   * Based on CodeMirror's indent/dedent pattern: { regex: /[\{\[\(]/, indent: true }, { regex: /[\}\]\)]/, dedent: true }
   */
  private formatCode(cql: string): string {
    if (!cql || !cql.trim()) {
      return cql;
    }

    const lines = cql.split('\n');
    const formatted: string[] = [];
    let indentLevel = 0;
    let inMultiLineComment = false;
    let previousWasEmpty = false;
    let previousSection: string | null = null;

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

      // Handle empty lines - preserve one between sections
      if (!trimmed) {
        if (!previousWasEmpty && formatted.length > 0) {
          formatted.push('');
          previousWasEmpty = true;
        }
        continue;
      }
      previousWasEmpty = false;

      // Preserve comments as-is (with their original indentation preserved)
      if (trimmed.startsWith('//') || inMultiLineComment || trimmed.includes('/*') || trimmed.includes('*/')) {
        // Preserve comment indentation relative to current indent level
        const commentIndent = ' '.repeat(indentLevel * this.indentSize);
        formatted.push(commentIndent + trimmed);
        continue;
      }

      // Detect section starts (reset indent for top-level declarations)
      let sectionType: string | null = null;
      let isTopLevelDeclaration = false;
      if (trimmed.match(/^library\s+/i)) {
        sectionType = 'library';
        isTopLevelDeclaration = true;
        indentLevel = 0;
      } else if (trimmed.match(/^using\s+/i)) {
        sectionType = 'using';
        isTopLevelDeclaration = true;
        indentLevel = 0;
      } else if (trimmed.match(/^context\s+/i)) {
        sectionType = 'context';
        isTopLevelDeclaration = true;
        indentLevel = 0;
      } else if (trimmed.match(/^parameter\s+/i)) {
        sectionType = 'parameter';
        isTopLevelDeclaration = true;
        indentLevel = 0;
      } else if (trimmed.match(/^function\s+/i)) {
        sectionType = 'function';
        isTopLevelDeclaration = true;
        indentLevel = 0;
      } else if (trimmed.match(/^define\s+/i)) {
        sectionType = 'define';
        isTopLevelDeclaration = true;
        indentLevel = 0;
      }

      // Add blank line between major sections
      if (sectionType && previousSection && previousSection !== sectionType) {
        if (formatted.length > 0 && formatted[formatted.length - 1].trim()) {
          formatted.push('');
        }
      }
      if (sectionType) {
        previousSection = sectionType;
      }

      // Calculate indentation for THIS line
      // First, check if line starts with closing brace/bracket (dedent before the line)
      let currentIndent = indentLevel;
      if (trimmed.match(/^[}\]\)]/)) {
        currentIndent = Math.max(0, indentLevel - 1);
      }

      // Format the line with current indent
      const indent = ' '.repeat(currentIndent * this.indentSize);
      const formattedLine = this.formatLine(trimmed);
      formatted.push(indent + formattedLine);

      // Update indent level for NEXT line based on THIS line's content
      // Count opening and closing braces/brackets/parentheses
      const openBraces = (trimmed.match(/[{\[\(]/g) || []).length;
      const closeBraces = (trimmed.match(/[}\]\)]/g) || []).length;
      const netBraces = openBraces - closeBraces;
      
      // Adjust indent level: opening braces increase, closing braces decrease
      indentLevel += netBraces;
      indentLevel = Math.max(0, indentLevel);

      // Special case: colon at end of define/function/parameter declaration increases indent
      // This handles CQL's pattern: "define X:" followed by indented body
      if (trimmed.match(/:\s*$/) && (sectionType === 'define' || sectionType === 'function' || sectionType === 'parameter')) {
        indentLevel++;
      }
    }

    // Remove trailing empty lines
    while (formatted.length > 0 && !formatted[formatted.length - 1].trim()) {
      formatted.pop();
    }

    const result = formatted.join('\n');
    return result + (cql.endsWith('\n') ? '\n' : '');
  }

  /**
   * Format a single line - minimal formatting like reference project
   * Uses word boundaries for text operators to avoid matching inside function names (e.g., "Floor" contains "or")
   * Preserves operator integrity (e.g., "<=" stays as "<=", never becomes "< =")
   */
  private formatLine(line: string): string {
    // Preserve strings by replacing with placeholders
    const stringPlaceholders: string[] = [];
    let placeholderIndex = 0;
    const placeholderPrefix = `__STR_${Date.now()}_`;

    // Replace strings (both single and double quotes)
    let processed = line.replace(/"([^"\\]*(\\.[^"\\]*)*)"|'([^'\\]*(\\.[^'\\]*)*)'/g, (match) => {
      const placeholder = `${placeholderPrefix}${placeholderIndex++}__`;
      stringPlaceholders.push(match);
      return placeholder;
    });

    // First, fix compound operators that might have spaces incorrectly inserted
    // This ensures "< = " becomes "<=" (no space inside operator)
    processed = processed
      .replace(/\s*<\s*=\s*/g, '<=')  // Fix "< = " to "<="
      .replace(/\s*>\s*=\s*/g, '>=')  // Fix "> = " to ">="
      .replace(/\s*<\s*>\s*/g, '<>')  // Fix "< > " to "<>"
      .replace(/\s*!\s*=\s*/g, '!=')  // Fix "! = " to "!="
      .replace(/\s*=\s*=\s*/g, '=='); // Fix "= = " to "==" (if used)

    // Normalize whitespace (multiple spaces to single space)
    processed = processed.replace(/\s+/g, ' ').trim();

    // Separate operators into text operators (need word boundaries) and symbol operators
    const textOperators = ['and', 'or', 'not', 'xor', 'implies'];
    const symbolOperators = ['<=', '>=', '<>', '!=', '+', '-', '*', '/', '=', '<', '>'];
    
    // Process text operators with word boundaries (like reference project: \b...\b)
    // This ensures "or" doesn't match inside "Floor" or "Before"
    // Sort by length to match longer operators first
    const sortedTextOps = textOperators.sort((a, b) => b.length - a.length);
    for (const op of sortedTextOps) {
      const escapedOp = op.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Use word boundaries - only match when operator is a standalone word
      processed = processed.replace(
        new RegExp(`\\b${escapedOp}\\b`, 'gi'),
        (match, offset, string) => {
          // Check if spaces are needed around the operator
          const beforeChar = offset > 0 ? string[offset - 1] : '';
          const afterChar = offset + match.length < string.length ? string[offset + match.length] : '';
          const needsSpaceBefore = beforeChar && !/\s/.test(beforeChar);
          const needsSpaceAfter = afterChar && !/\s/.test(afterChar);
          return (needsSpaceBefore ? ' ' : '') + op.toLowerCase() + (needsSpaceAfter ? ' ' : '');
        }
      );
    }

    // Process symbol operators - must process longer operators first to avoid splitting compound operators
    // Sort by length descending so "<=" is processed before "<"
    const sortedSymbolOps = symbolOperators.sort((a, b) => b.length - a.length);
    for (const op of sortedSymbolOps) {
      const escapedOp = op.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      
      // For compound operators (2+ chars), ensure they have spaces around them (but not inside)
      if (op.length >= 2) {
        // Match the operator and ensure it has spaces before and after (but keep operator intact)
        processed = processed.replace(
          new RegExp(`([^\\s])${escapedOp}([^\\s])`, 'g'),
          `$1 ${op} $2`
        );
        // Also handle cases where operator is at start/end
        processed = processed.replace(
          new RegExp(`^${escapedOp}([^\\s])`, 'g'),
          `${op} $1`
        );
        processed = processed.replace(
          new RegExp(`([^\\s])${escapedOp}$`, 'g'),
          `$1 ${op}`
        );
      } else {
        // For single-char operators, add space around if not already present
        // But be careful not to break compound operators - check that adjacent chars aren't part of compound ops
        processed = processed.replace(
          new RegExp(`([^\\s<=>!])${escapedOp}([^\\s<=>!=])`, 'g'),
          `$1 ${op} $2`
        );
        // Handle at start/end
        processed = processed.replace(
          new RegExp(`^${escapedOp}([^\\s<=>!=])`, 'g'),
          `${op} $1`
        );
        processed = processed.replace(
          new RegExp(`([^\\s<=>!])${escapedOp}$`, 'g'),
          `$1 ${op}`
        );
      }
    }

    // Normalize punctuation spacing
    processed = processed
      .replace(/\s*,\s*/g, ', ')  // Comma: space after
      .replace(/\s*;\s*/g, '; ')   // Semicolon: space after
      .replace(/\s*:\s*/g, ' : ') // Colon: space around
      .replace(/\s*\(\s*/g, '(')   // Opening paren: no space inside
      .replace(/\s*\)\s*/g, ')')  // Closing paren: no space inside
      .replace(/\s+/g, ' ')         // Clean up multiple spaces
      .trim();

    // Restore strings
    stringPlaceholders.forEach((originalString, index) => {
      const placeholder = `${placeholderPrefix}${index}__`;
      processed = processed.replace(placeholder, originalString);
    });

    return processed;
  }
}
