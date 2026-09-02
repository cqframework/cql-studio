// Author: Preston Lee

import { CqlDefinition, CqlDefinitionIndex, CqlSourceSpan } from './elm-locator.lib';
import {
  findCqlNameTokenSpanOnLine,
  isValidCqlIdentifier,
  quoteCqlIdentifier
} from './cql-identifier.lib';

export { isValidCqlIdentifier } from './cql-identifier.lib';

/**
 * Find the identifier/name token span for a define or function on its declaration line.
 * Uses the ELM-known name and only scans that locator line (no whole-file patterns).
 */
export function findDefineNameTokenSpan(
  source: string,
  definition: CqlDefinition
): CqlSourceSpan | null {
  if (definition.kind !== 'expression' && definition.kind !== 'function') {
    return null;
  }

  const lines = source.split('\n');
  const lineText = lines[definition.span.startLine - 1];
  if (!lineText) {
    return null;
  }
  return findCqlNameTokenSpanOnLine(lineText, definition.span.startLine, definition.name);
}

export interface RenameEdit {
  fromLine: number;
  fromColumn: number;
  toLine: number;
  toColumn: number;
  insert: string;
}

/**
 * Collect rename edits for a local define/function: name token + local refs.
 * Ref spans are refined against source so ELM locators with leading spaces don't corrupt edits.
 */
export function collectLocalRenameSpans(
  source: string,
  index: CqlDefinitionIndex,
  name: string,
  kind?: CqlDefinition['kind']
): CqlSourceSpan[] {
  const defs = index.definitions.get(name) ?? [];
  const matching = kind ? defs.filter(d => d.kind === kind) : defs;
  const spans: CqlSourceSpan[] = [];
  const lines = source.split('\n');

  for (const def of matching) {
    if (def.kind !== 'expression' && def.kind !== 'function') {
      continue;
    }
    const nameSpan = findDefineNameTokenSpan(source, def);
    if (nameSpan) {
      spans.push(nameSpan);
    }
  }

  for (const ref of index.references) {
    if (ref.libraryName) {
      continue;
    }
    if (ref.name !== name) {
      continue;
    }
    if (kind === 'function' && ref.kind !== 'functionRef') {
      continue;
    }
    if (kind === 'expression' && ref.kind !== 'expressionRef') {
      continue;
    }
    if (ref.kind !== 'expressionRef' && ref.kind !== 'functionRef') {
      continue;
    }
    const lineText = lines[ref.span.startLine - 1];
    const refined =
      lineText && ref.name
        ? findCqlNameTokenSpanOnLine(lineText, ref.span.startLine, ref.name)
        : null;
    spans.push(refined ?? ref.span);
  }

  return dedupeSpans(spans);
}

function dedupeSpans(spans: CqlSourceSpan[]): CqlSourceSpan[] {
  const seen = new Set<string>();
  const out: CqlSourceSpan[] = [];
  for (const span of spans) {
    const key = `${span.startLine}:${span.startColumn}-${span.endLine}:${span.endColumn}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(span);
  }
  return out;
}

export function formatRenameReplacement(oldName: string, newName: string, sourceSlice: string): string {
  const trimmedNew = normalizeRenameTarget(newName);
  if (!trimmedNew) {
    return sourceSlice;
  }
  const leadingWs = /^\s*/.exec(sourceSlice)?.[0] ?? '';
  const trailingWs = /\s*$/.exec(sourceSlice)?.[0] ?? '';
  const core =
    leadingWs.length + trailingWs.length >= sourceSlice.length
      ? ''
      : sourceSlice.slice(leadingWs.length, sourceSlice.length - trailingWs.length);
  const needsQuotes =
    !isValidCqlIdentifier(trimmedNew) || (core.startsWith('"') && core.endsWith('"'));
  const replacement = needsQuotes ? quoteCqlIdentifier(trimmedNew) : trimmedNew;
  return `${leadingWs}${replacement}${trailingWs}`;
}

/** Accepts bare identifiers or quoted CQL names (with optional surrounding quotes in input). */
export function isValidRenameTarget(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) {
    return false;
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 3) ||
    (!trimmed.includes('"') && (trimmed.includes(' ') || trimmed.includes('-')))
  ) {
    const inner = trimmed.startsWith('"') ? trimmed.slice(1, -1) : trimmed;
    return inner.length > 0 && !inner.includes('"');
  }
  return isValidCqlIdentifier(trimmed);
}

export function normalizeRenameTarget(name: string): string {
  const trimmed = name.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 3) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
