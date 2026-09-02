// Author: Preston Lee

import type { CqlValidationDoc } from '../models/cql-validation-doc.model';

/** Lint shape compatible with CodeMirror Diagnostic; kept local to avoid pulling @codemirror/lint into unit tests. */
export interface CqlCharacterDiagnostic {
  from: number;
  to: number;
  severity: 'warning';
  message: string;
}

/** Code points that are invalid CQL punctuation outside string literals (Word/smart typography). */
const INVALID_CQL_CHAR = new RegExp(
  '[\\u2013\\u2014\\u2018-\\u201F\\u2026\\u2212\\u2264\\u2265]',
  'gu',
);

const INVALID_CHAR_NAMES: Record<number, string> = {
  0x2013: 'en dash',
  0x2014: 'em dash',
  0x2018: 'left single quotation mark',
  0x2019: 'right single quotation mark',
  0x201a: 'single low-9 quotation mark',
  0x201b: 'single high-reversed-9 quotation mark',
  0x201c: 'left double quotation mark',
  0x201d: 'right double quotation mark',
  0x201e: 'double low-9 quotation mark',
  0x201f: 'double high-reversed-9 quotation mark',
  0x2026: 'ellipsis',
  0x2212: 'minus sign',
  0x2264: 'less-than or equal to',
  0x2265: 'greater-than or equal to',
};

function describeCodePoint(code: number): string {
  return INVALID_CHAR_NAMES[code] ?? `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
}

/**
 * Returns whether `index` is inside a single-quoted CQL string (respects backslash escapes).
 */
export function isInsideCqlString(source: string, index: number): boolean {
  let inString = false;
  for (let i = 0; i < index; i++) {
    const ch = source[i];
    if (ch === '\\' && inString) {
      i++;
      continue;
    }
    if (ch === "'") {
      inString = !inString;
    }
  }
  return inString;
}

/**
 * Synchronous diagnostics for characters that are not valid CQL outside string literals.
 * CodeMirror holds UTF-16 text; this does not validate UTF-8 bytes (see utf8-encoding.lib on save).
 */
export function scanInvalidCqlCharacters(code: string, doc?: CqlValidationDoc): CqlCharacterDiagnostic[] {
  const diagnostics: CqlCharacterDiagnostic[] = [];
  let match: RegExpExecArray | null;
  INVALID_CQL_CHAR.lastIndex = 0;
  while ((match = INVALID_CQL_CHAR.exec(code)) !== null) {
    const index = match.index;
    const lastIndex = INVALID_CQL_CHAR.lastIndex;
    if (isInsideCqlString(code, index)) {
      if (INVALID_CQL_CHAR.lastIndex <= lastIndex) {
        INVALID_CQL_CHAR.lastIndex = lastIndex + 1;
      }
      continue;
    }
    const codePoint = match[0].codePointAt(0) ?? 0;
    const from = index;
    const to = index + match[0].length;
    let message = `Character not valid in CQL (${describeCodePoint(codePoint)}). Use ASCII punctuation.`;

    if (doc?.lineAt) {
      try {
        const lineNumber = doc.lineAt(from).number;
        message = `Line ${lineNumber}: ${message}`;
      } catch {
        // keep generic message
      }
    }

    diagnostics.push({
      from,
      to,
      severity: 'warning',
      message,
    });
  }
  return diagnostics;
}
