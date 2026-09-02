// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { TranslationService, RawTranslationResult, LibraryTranslationContext } from './translation.service';
import { CqlCompilerException } from '@cqframework/cql/cql-to-elm';
import { CqlLocatorUtilsService } from './cql-locator-utils.service';
import type { CqlValidationDoc } from '../models/cql-validation-doc.model';

export type { CqlValidationDoc } from '../models/cql-validation-doc.model';

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

export interface FullValidationResult {
  raw: RawTranslationResult;
  validation: ValidationResult;
  structuredErrors: StructuredError[];
  structuredWarnings: StructuredError[];
}

const EMPTY_RAW: RawTranslationResult = {
  elmXml: null,
  elmJson: null,
  errors: [],
  warnings: [],
  messages: [],
  hasErrors: false
};

const EMPTY_VALIDATION: ValidationResult = {
  errors: [],
  warnings: [],
  messages: [],
  hasErrors: false
};

@Injectable({
  providedIn: 'root'
})
export class CqlValidationService {
  private translationService = inject(TranslationService);
  private locatorUtils = inject(CqlLocatorUtilsService);

  validate(cql: string, doc?: CqlValidationDoc): ValidationResult {
    return this.runFullValidation(cql, doc).validation;
  }

  /** Single translator invocation; prefer this when you need errors and warnings together. */
  runFullValidation(cql: string, doc?: CqlValidationDoc): FullValidationResult {
    if (!cql?.trim()) {
      return this.emptyFullValidation();
    }
    const raw = this.translationService.translateCqlToElmRaw(cql);
    return this.buildFullValidation(raw, doc);
  }

  async runFullValidationAsync(
    cql: string,
    doc?: CqlValidationDoc,
    context?: LibraryTranslationContext
  ): Promise<FullValidationResult> {
    if (!cql?.trim()) {
      return this.emptyFullValidation();
    }
    const raw = await this.translationService.translateCqlToElmRawAsync(cql, context);
    return this.buildFullValidation(raw, doc);
  }

  private emptyFullValidation(): FullValidationResult {
    return {
      raw: EMPTY_RAW,
      validation: EMPTY_VALIDATION,
      structuredErrors: [],
      structuredWarnings: []
    };
  }

  private buildFullValidation(raw: RawTranslationResult, doc?: CqlValidationDoc): FullValidationResult {
    return {
      raw,
      validation: this.validateFromRaw(raw, doc),
      structuredErrors: this.getStructuredErrorsFromRaw(raw),
      structuredWarnings: this.getStructuredWarningsFromRaw(raw)
    };
  }

  formatProblemsPanelMessages(full: FullValidationResult): string[] {
    return [
      ...full.structuredErrors.map(e => `Error: ${e.formattedMessage}`),
      ...full.structuredWarnings.map(w => `Warning: ${w.formattedMessage}`)
    ];
  }

  validateFromRaw(rawResult: RawTranslationResult, doc?: CqlValidationDoc): ValidationResult {
    const errors = this.convertExceptionsToValidationErrors(rawResult.errors, 'error', doc);
    const warnings = this.convertExceptionsToValidationErrors(rawResult.warnings, 'warning', doc);
    const messages = this.convertExceptionsToValidationErrors(rawResult.messages, 'info', doc);

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
    doc?: CqlValidationDoc
  ): ValidationError[] {
    const validationErrors = exceptions.map(exception => {
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
          // CodeMirror line numbers are 1-based; offsets within a line are 0-based.
          const startLine = doc.line(lineNumber);

          // Locator columns are normalized to 1-based; convert to 0-based for CodeMirror.
          // If columnNumber is null, default to 0 (start of line).
          const lineLength = startLine.length ?? startLine.to - startLine.from;
          let columnOffset = columnNumber != null
            ? Math.max(0, Math.min(columnNumber - 1, lineLength))
            : 0;
          // EOF syntax errors can report a 1-based column past the line end; highlight the last character.
          if (columnNumber != null && columnNumber - 1 >= lineLength && lineLength > 0) {
            columnOffset = lineLength - 1;
          }
          from = startLine.from + columnOffset;

          const endLineNumber = locatorInfo.endLine ?? lineNumber;
          const endColumnNumber = locatorInfo.endColumn;
          if (endColumnNumber != null) {
            const endLine = endLineNumber === lineNumber ? startLine : doc.line(endLineNumber);
            const endLength = endLine.length ?? endLine.to - endLine.from;
            // endColumn is 1-based inclusive; CodeMirror `to` is exclusive.
            let endOffset = Math.max(0, Math.min(endColumnNumber, endLength));
            if (endColumnNumber - 1 >= endLength && endLength > 0) {
              endOffset = endLength;
            }
            to = endLine.from + endOffset;
          } else {
            // Fall back to end of the start line when end position is unavailable.
            to = startLine.to;
          }

          // Ensure to is at least from + 1 so the diagnostic is visible.
          if (to <= from) {
            to = Math.min(from + 1, startLine.to);
            if (to <= from && lineLength > 0) {
              from = Math.max(startLine.from, startLine.to - 1);
              to = startLine.to;
            }
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

    return this.dedupeValidationErrors(validationErrors);
  }

  private dedupeValidationErrors(validationErrors: ValidationError[]): ValidationError[] {
    const seen = new Set<string>();
    return validationErrors.filter(error => {
      const key = [
        error.severity,
        error.message,
        error.line ?? '',
        error.column ?? '',
        error.from,
        error.to
      ].join('|');

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }

  private dedupeStructuredErrors(structuredErrors: StructuredError[]): StructuredError[] {
    const seen = new Set<string>();
    return structuredErrors.filter(error => {
      const key = [
        error.severity,
        error.message,
        error.line ?? '',
        error.column ?? ''
      ].join('|');

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }

  /**
   * Get structured errors with line/column information
   */
  getStructuredErrors(cql: string): StructuredError[] {
    return this.runFullValidation(cql).structuredErrors;
  }

  getStructuredErrorsFromRaw(rawResult: RawTranslationResult): StructuredError[] {
    return this.dedupeStructuredErrors(rawResult.errors.map(e => {
      const locatorInfo = this.locatorUtils.extractLocatorInfo(e);
      const formattedMessage = this.locatorUtils.formatLocator(locatorInfo);
      return {
        message: e.message || 'Unknown error',
        line: locatorInfo.line,
        column: locatorInfo.column,
        severity: 'error' as const,
        formattedMessage: `${e.message || 'Unknown error'} ${formattedMessage}`.trim()
      };
    }));
  }

  getStructuredWarnings(cql: string): StructuredError[] {
    return this.runFullValidation(cql).structuredWarnings;
  }

  getStructuredWarningsFromRaw(rawResult: RawTranslationResult): StructuredError[] {
    return this.dedupeStructuredErrors(rawResult.warnings.map(e => {
      const locatorInfo = this.locatorUtils.extractLocatorInfo(e);
      const formattedMessage = this.locatorUtils.formatLocator(locatorInfo);
      return {
        message: e.message || 'Unknown warning',
        line: locatorInfo.line,
        column: locatorInfo.column,
        severity: 'warning' as const,
        formattedMessage: `${e.message || 'Unknown warning'} ${formattedMessage}`.trim()
      };
    }));
  }

}
