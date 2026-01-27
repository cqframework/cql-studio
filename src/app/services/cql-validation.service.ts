// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { TranslationService } from './translation.service';
import { CqlCompilerException } from '@cqframework/cql/cql-to-elm';
import { CqlLocatorUtilsService } from './cql-locator-utils.service';

export interface ValidationError {
  message: string;
  from: number;
  to: number;
  severity: 'error' | 'warning' | 'info';
  line: number | null;
  column: number | null;
}

export interface StructuredError {
  message: string;
  line: number | null;
  column: number | null;
  severity: 'error' | 'warning' | 'info';
  formattedMessage: string;
}

export interface ValidationResult {
  errors: ValidationError[];
  warnings: ValidationError[];
  messages: ValidationError[];
  hasErrors: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class CqlValidationService {
  private translationService = inject(TranslationService);
  private locatorUtils = inject(CqlLocatorUtilsService);

  /**
   * Validate CQL syntax and semantics using the @cqframework/cql translator
   * @param cql The CQL code to validate
   * @param doc The CodeMirror document (optional, for position calculation)
   * @returns ValidationResult with errors, warnings, and messages
   */
  validate(cql: string, doc?: { line: (lineNumber: number) => { from: number; length: number; to: number } }): ValidationResult {
    if (!cql || !cql.trim()) {
      return {
        errors: [],
        warnings: [],
        messages: [],
        hasErrors: false
      };
    }

    // Use translation service to get raw validation results with locator info
    const rawResult = this.translationService.translateCqlToElmRaw(cql);
    
    // Convert raw exceptions to ValidationError format with proper positions
    const errors = this.convertExceptionsToValidationErrors(
      rawResult.errors,
      'error',
      doc
    );
    
    const warnings = this.convertExceptionsToValidationErrors(
      rawResult.warnings,
      'warning',
      doc
    );
    
    const messages = this.convertExceptionsToValidationErrors(
      rawResult.messages,
      'info',
      doc
    );

    return {
      errors,
      warnings,
      messages,
      hasErrors: rawResult.hasErrors
    };
  }

  /**
   * Convert CqlCompilerException objects to ValidationError format with positions
   * Uses shared locator utility to extract line/column information
   */
  private convertExceptionsToValidationErrors(
    exceptions: CqlCompilerException[],
    severity: 'error' | 'warning' | 'info',
    doc?: { line: (lineNumber: number) => { from: number; length: number; to: number } }
  ): ValidationError[] {
    return exceptions.map(exception => {
      const message = exception.message || 'Unknown error';
      
      // Extract line/column using shared utility
      const locatorInfo = this.locatorUtils.extractLocatorInfo(exception);
      const lineNumber = locatorInfo.line;
      const columnNumber = locatorInfo.column;
      
      let from = 0;
      let to = 0;
      
      // Calculate CodeMirror positions if we have line/column and document
      if (lineNumber != null && doc) {
        try {
          // Get line info using 1-based line number (CodeMirror uses 1-based)
          const startLine = doc.line(lineNumber);
          
          // Calculate position: line start + column offset
          // Column numbers from TrackBack appear to be 0-based (matches CodeMirror)
          // If columnNumber is null, default to 0 (start of line)
          const columnOffset = columnNumber != null 
            ? Math.max(0, Math.min(columnNumber, startLine.length))
            : 0;
          from = startLine.from + columnOffset;
          
          // Since we don't have endLine/endChar, highlight to end of line
          // This provides better visibility than highlighting just one character
          to = startLine.to;
          
          // Ensure to is at least from (should always be true, but safety check)
          if (to < from) {
            to = from + 1;
          }
        } catch (e) {
          // If line doesn't exist (e.g., line number out of range), use start of document
          from = 0;
          to = 0;
        }
      }
      
      return {
        message,
        from,
        to,
        severity,
        line: lineNumber,
        column: columnNumber
      };
    });
  }

  /**
   * Get structured errors with line/column information
   */
  getStructuredErrors(cql: string): StructuredError[] {
    if (!cql || !cql.trim()) {
      return [];
    }

    const rawResult = this.translationService.translateCqlToElmRaw(cql);
    return rawResult.errors.map(e => {
      const locatorInfo = this.locatorUtils.extractLocatorInfo(e);
      const formattedMessage = this.locatorUtils.formatLocator(locatorInfo);
      return {
        message: e.message || 'Unknown error',
        line: locatorInfo.line,
        column: locatorInfo.column,
        severity: 'error' as const,
        formattedMessage: `${e.message || 'Unknown error'} ${formattedMessage}`.trim()
      };
    });
  }

  /**
   * Get structured warnings with line/column information
   */
  getStructuredWarnings(cql: string): StructuredError[] {
    if (!cql || !cql.trim()) {
      return [];
    }

    const rawResult = this.translationService.translateCqlToElmRaw(cql);
    return rawResult.warnings.map(e => {
      const locatorInfo = this.locatorUtils.extractLocatorInfo(e);
      const formattedMessage = this.locatorUtils.formatLocator(locatorInfo);
      return {
        message: e.message || 'Unknown warning',
        line: locatorInfo.line,
        column: locatorInfo.column,
        severity: 'warning' as const,
        formattedMessage: `${e.message || 'Unknown warning'} ${formattedMessage}`.trim()
      };
    });
  }

  /**
   * Get formatted error messages (for display in Problems panel)
   * @deprecated Use getStructuredErrors() instead for better structure
   */
  getFormattedErrors(cql: string): string[] {
    return this.getStructuredErrors(cql).map(e => e.formattedMessage);
  }

  /**
   * Get formatted warning messages (for display in Problems panel)
   * @deprecated Use getStructuredWarnings() instead for better structure
   */
  getFormattedWarnings(cql: string): string[] {
    return this.getStructuredWarnings(cql).map(e => e.formattedMessage);
  }
}
