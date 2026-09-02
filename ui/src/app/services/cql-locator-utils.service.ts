// Author: Preston Lee

import { Injectable } from '@angular/core';
import { CqlCompilerException } from '@cqframework/cql/cql-to-elm';

export interface LocatorInfo {
  line: number | null;
  column: number | null;
  endLine: number | null;
  endColumn: number | null;
}

/**
 * Utility service for extracting line/column information from CQL compiler locators.
 * Kotlin/JS TrackBack field names are mangled and change between builds, so prefer
 * unmangled property names and TrackBack.toString() before falling back to heuristics.
 *
 * Returned positions are normalized to 1-based lines/columns (CQL/ELM convention):
 * - Semantic/include TrackBacks already use 1-based startChar (Cql2ElmVisitor).
 * - CqlSyntaxException TrackBacks use ANTLR's 0-based charPositionInLine; those are
 *   converted to 1-based here so callers can treat all columns uniformly.
 * For CodeMirror: start column → offset `column - 1`; inclusive end column → exclusive
 * offset `endColumn` (same numeric value when 1-based inclusive).
 */
@Injectable({
  providedIn: 'root'
})
export class CqlLocatorUtilsService {
  extractLocatorInfo(exception: CqlCompilerException): LocatorInfo {
    const locator = exception.locator;

    if (!locator) {
      return { line: null, column: null, endLine: null, endColumn: null };
    }

    const locatorAny = locator as Record<string, unknown>;
    let raw = this.readLocatorFields(locatorAny, locator);

    if (!raw) {
      return { line: null, column: null, endLine: null, endColumn: null };
    }

    // ANTLR syntax errors store 0-based columns; normalize to 1-based for callers.
    if (this.isAntlrZeroBasedSyntaxException(exception)) {
      raw = {
        line: raw.line,
        column: raw.column != null ? raw.column + 1 : null,
        endLine: raw.endLine,
        endColumn: raw.endColumn != null ? raw.endColumn + 1 : null
      };
    }

    return {
      line: this.normalizeLineNumber(raw.line),
      column: raw.column != null && raw.column >= 0 ? raw.column : null,
      endLine: this.normalizeLineNumber(raw.endLine),
      endColumn: raw.endColumn != null && raw.endColumn >= 0 ? raw.endColumn : null
    };
  }

  private readLocatorFields(
    locatorAny: Record<string, unknown>,
    locator: object
  ): {
    line: number | null;
    column: number | null;
    endLine: number | null;
    endColumn: number | null;
  } | null {
    // Prefer unmangled property names when present (fixtures / future Kotlin exports).
    if (typeof locatorAny['startLine'] === 'number') {
      return {
        line: locatorAny['startLine'],
        column: typeof locatorAny['startChar'] === 'number' ? locatorAny['startChar'] : null,
        endLine: typeof locatorAny['endLine'] === 'number' ? locatorAny['endLine'] : null,
        endColumn: typeof locatorAny['endChar'] === 'number' ? locatorAny['endChar'] : null
      };
    }

    // TrackBack.toString() embeds positions stably across name mangling, e.g.
    // TrackBack{library='...', startLine=5, startChar=13, endLine=5, endChar=15}
    const fromToString = this.parseTrackBackToString(String(locator));
    if (fromToString) {
      return fromToString;
    }

    // Last resort: TrackBack own fields are library, startLine, startChar, endLine, endChar.
    // Read numeric properties in insertion order (not sorted by value).
    const numericInOrder: number[] = [];
    for (const key of Object.keys(locator)) {
      const value = locatorAny[key];
      if (typeof value === 'number' && value >= 0) {
        numericInOrder.push(value);
      }
    }

    if (numericInOrder.length >= 2) {
      return {
        line: numericInOrder[0],
        column: numericInOrder[1],
        endLine: numericInOrder.length >= 3 ? numericInOrder[2] : null,
        endColumn: numericInOrder.length >= 4 ? numericInOrder[3] : null
      };
    }

    if (numericInOrder.length === 1) {
      return { line: numericInOrder[0], column: null, endLine: null, endColumn: null };
    }

    return null;
  }

  private isAntlrZeroBasedSyntaxException(exception: CqlCompilerException): boolean {
    return (
      exception.constructor?.name === 'CqlSyntaxException' ||
      exception.name === 'CqlSyntaxException'
    );
  }

  private parseTrackBackToString(text: string): {
    line: number | null;
    column: number | null;
    endLine: number | null;
    endColumn: number | null;
  } | null {
    const match =
      /startLine=(\d+)\s*,\s*startChar=(\d+)\s*,\s*endLine=(\d+)\s*,\s*endChar=(\d+)/.exec(text);
    if (!match) {
      return null;
    }
    return {
      line: Number(match[1]),
      column: Number(match[2]),
      endLine: Number(match[3]),
      endColumn: Number(match[4])
    };
  }

  private normalizeLineNumber(lineNumber: number | null): number | null {
    if (lineNumber == null) {
      return null;
    }

    if (lineNumber === 0) {
      return 1;
    }

    return lineNumber > 0 ? lineNumber : null;
  }

  formatLocator(locatorInfo: LocatorInfo): string {
    if (locatorInfo.line != null) {
      const column = locatorInfo.column != null ? locatorInfo.column : '?';
      return `(line ${locatorInfo.line}, column ${column})`;
    }
    return '';
  }
}
