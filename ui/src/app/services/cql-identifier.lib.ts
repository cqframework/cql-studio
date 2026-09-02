// Author: Preston Lee

import { CqlSourceSpan } from './elm-locator.lib';

/**
 * CQL unquoted identifiers are ASCII letter/underscore + alphanumerics.
 * Prefer ELM for structural navigation; these helpers are only for token shape
 * (rename validation, bare-name span refine, include completion).
 */

const CQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CQL_IDENT_PART = /[A-Za-z0-9_]/;
/** Partial library name while typing an `include` target (FHIR ids often use . and -). */
const CQL_LIBRARY_NAME_CHAR = /[A-Za-z0-9_.-]/;
/** `include` at EOL, or `include <term>` — requires boundary before the keyword. */
const INCLUDE_COMPLETION_PREFIX =
  /(?:^|[^A-Za-z0-9_])include(?:\s+([A-Za-z0-9_.-]*))?$/i;

export function isValidCqlIdentifier(name: string): boolean {
  return CQL_IDENTIFIER.test(name.trim());
}

export function isCqlIdentPart(ch: string | undefined): boolean {
  return !!ch && CQL_IDENT_PART.test(ch);
}

export function isCqlLibraryNameChar(ch: string | undefined): boolean {
  return !!ch && CQL_LIBRARY_NAME_CHAR.test(ch);
}

/**
 * True when `pos` sits inside a line comment or quoted string on this single line.
 */
export function isInsideCqlLineCommentOrString(text: string, pos: number): boolean {
  let inDouble = false;
  let inSingle = false;
  for (let i = 0; i < text.length && i < pos; i++) {
    const ch = text[i];
    const prev = i > 0 ? text[i - 1] : '';
    if (!inSingle && ch === '"' && prev !== '\\') {
      inDouble = !inDouble;
      continue;
    }
    if (!inDouble && ch === "'" && prev !== '\\') {
      inSingle = !inSingle;
      continue;
    }
    if (!inDouble && !inSingle && ch === '/' && text[i + 1] === '/') {
      return true;
    }
  }
  return inDouble || inSingle;
}

/** Match `include <term>` at end of the text before the cursor. */
export function matchIncludeCompletionPrefix(
  textBeforeCursor: string
): { term: string; termStart: number } | null {
  const match = INCLUDE_COMPLETION_PREFIX.exec(textBeforeCursor);
  if (!match) {
    return null;
  }

  const includeLocal = match[0].toLowerCase().lastIndexOf('include');
  if (includeLocal < 0) {
    return null;
  }
  const includeAbs = match.index + includeLocal;
  if (isInsideCqlLineCommentOrString(textBeforeCursor, includeAbs)) {
    return null;
  }

  const term = match[1] ?? '';
  // When only `include` matched (no `\s+term`), completion replaces from end of keyword.
  const termStart =
    match[1] != null ? match.index + match[0].length - term.length : includeAbs + 'include'.length;
  return { term, termStart };
}

/**
 * Find `name` as a bare identifier (not embedded in a longer ident).
 * Prefer quoted form at the call site when the source uses quotes.
 */
export function findBareCqlIdentifierSpan(
  lineText: string,
  name: string
): { start: number; end: number } | null {
  if (!name || !isValidCqlIdentifier(name)) {
    return null;
  }
  let from = 0;
  while (from < lineText.length) {
    const idx = lineText.indexOf(name, from);
    if (idx < 0) {
      return null;
    }
    const before = idx === 0 ? undefined : lineText[idx - 1];
    const after = lineText[idx + name.length];
    if (!isCqlIdentPart(before) && !isCqlIdentPart(after)) {
      return { start: idx, end: idx + name.length };
    }
    from = idx + 1;
  }
  return null;
}

/**
 * Locate the exact name token on a line. Prefer this over raw ELM ref locators,
 * which often include surrounding whitespace/operators.
 */
export function findCqlNameTokenSpanOnLine(
  lineText: string,
  lineNumber: number,
  name: string
): CqlSourceSpan | null {
  const quoted = quoteCqlIdentifier(name);
  const quotedIdx = lineText.indexOf(quoted);
  if (quotedIdx >= 0) {
    return {
      startLine: lineNumber,
      startColumn: quotedIdx + 1,
      endLine: lineNumber,
      endColumn: quotedIdx + quoted.length
    };
  }

  const bare = findBareCqlIdentifierSpan(lineText, name);
  if (!bare) {
    return null;
  }
  return {
    startLine: lineNumber,
    startColumn: bare.start + 1,
    endLine: lineNumber,
    endColumn: bare.end
  };
}

export function quoteCqlIdentifier(name: string): string {
  return `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function quoteCqlSingleString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export function toCqlCalledIdentifier(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, '_');
  if (!cleaned) {
    return 'Lib';
  }
  if (/^[0-9]/.test(cleaned)) {
    return `_${cleaned}`;
  }
  return cleaned;
}

export function formatCqlIncludeLibraryName(name: string): string {
  return isValidCqlIdentifier(name) ? name : quoteCqlIdentifier(name);
}
