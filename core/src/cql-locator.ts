// Author: Preston Lee

export interface LocatorInfo {
  line: number | null;
  column: number | null;
  endLine: number | null;
  endColumn: number | null;
}

/**
 * Minimal duck type for CQL compiler exceptions from `@cqframework/cql`.
 * Avoids a hard dependency on that package from `@cql-studio/core`.
 */
export interface CqlCompilerExceptionLike {
  message?: string | null;
  name?: string;
  locator?: unknown;
  constructor?: { name?: string };
}

type RawLocatorFields = {
  line: number | null;
  column: number | null;
  endLine: number | null;
  endColumn: number | null;
};

/**
 * Extract line/column from CQL compiler locators.
 * Kotlin/JS TrackBack field names are mangled and change between builds, so prefer
 * unmangled property names and TrackBack.toString() before falling back to heuristics.
 *
 * Returned positions are normalized to 1-based lines/columns (CQL/ELM convention):
 * - Semantic/include TrackBacks already use 1-based startChar (Cql2ElmVisitor).
 * - CqlSyntaxException TrackBacks use ANTLR's 0-based charPositionInLine; those are
 *   converted to 1-based here so callers can treat all columns uniformly.
 */
export function extractLocatorInfo(exception: CqlCompilerExceptionLike): LocatorInfo {
  const locator = exception.locator;

  if (!locator || typeof locator !== 'object') {
    return { line: null, column: null, endLine: null, endColumn: null };
  }

  const locatorAny = locator as Record<string, unknown>;
  let raw = readLocatorFields(locatorAny, locator);

  if (!raw) {
    return { line: null, column: null, endLine: null, endColumn: null };
  }

  if (isAntlrZeroBasedSyntaxException(exception)) {
    raw = {
      line: raw.line,
      column: raw.column != null ? raw.column + 1 : null,
      endLine: raw.endLine,
      endColumn: raw.endColumn != null ? raw.endColumn + 1 : null
    };
  }

  return {
    line: normalizeLineNumber(raw.line),
    column: raw.column != null && raw.column >= 0 ? raw.column : null,
    endLine: normalizeLineNumber(raw.endLine),
    endColumn: raw.endColumn != null && raw.endColumn >= 0 ? raw.endColumn : null
  };
}

export function formatLocator(locatorInfo: LocatorInfo): string {
  if (locatorInfo.line != null) {
    const column = locatorInfo.column != null ? locatorInfo.column : '?';
    return `(line ${locatorInfo.line}, column ${column})`;
  }
  return '';
}

function readLocatorFields(
  locatorAny: Record<string, unknown>,
  locator: object
): RawLocatorFields | null {
  if (typeof locatorAny['startLine'] === 'number') {
    return {
      line: locatorAny['startLine'],
      column: typeof locatorAny['startChar'] === 'number' ? locatorAny['startChar'] : null,
      endLine: typeof locatorAny['endLine'] === 'number' ? locatorAny['endLine'] : null,
      endColumn: typeof locatorAny['endChar'] === 'number' ? locatorAny['endChar'] : null
    };
  }

  const fromToString = parseTrackBackToString(String(locator));
  if (fromToString) {
    return fromToString;
  }

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

function isAntlrZeroBasedSyntaxException(exception: CqlCompilerExceptionLike): boolean {
  return (
    exception.constructor?.name === 'CqlSyntaxException' ||
    exception.name === 'CqlSyntaxException'
  );
}

function parseTrackBackToString(text: string): RawLocatorFields | null {
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

function normalizeLineNumber(lineNumber: number | null): number | null {
  if (lineNumber == null) {
    return null;
  }

  if (lineNumber === 0) {
    return 1;
  }

  return lineNumber > 0 ? lineNumber : null;
}
