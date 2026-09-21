// Author: Preston Lee

import { parseLocator, type CqlDefinitionIndex, type CqlSourceSpan } from '../elm-locator.lib';

export interface CqlDebugExecutableLineMeta {
  locator: string;
  localId: string | null;
}

/**
 * Collects ELM locator start lines under ExpressionDef / FunctionDef statements.
 * These are the only lines the debug handler can pause on (start-line match).
 */
export function collectExecutableBreakpointLines(
  elmXml: string | null | undefined
): Map<number, CqlDebugExecutableLineMeta> {
  const out = new Map<number, CqlDebugExecutableLineMeta>();
  if (!elmXml?.trim()) {
    return out;
  }
  const doc = new DOMParser().parseFromString(elmXml, 'application/xml');
  if (doc.querySelector('parsererror')) {
    return out;
  }

  for (const def of doc.querySelectorAll('statements > def')) {
    const typeAttr =
      def.getAttribute('xsi:type') ??
      def.getAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'type') ??
      '';
    if (
      typeAttr &&
      !typeAttr.includes('ExpressionDef') &&
      !typeAttr.includes('FunctionDef')
    ) {
      continue;
    }
    collectLocatorsFromElement(def, out);
  }
  return out;
}

function collectLocatorsFromElement(
  element: Element,
  out: Map<number, CqlDebugExecutableLineMeta>
): void {
  const locator = element.getAttribute('locator');
  const span = parseLocator(locator);
  if (locator && span && !out.has(span.startLine)) {
    out.set(span.startLine, {
      locator,
      localId: element.getAttribute('localId'),
    });
  }
  for (const child of Array.from(element.children)) {
    collectLocatorsFromElement(child, out);
  }
}

/** Lines that are declaration-only (not ExpressionDef / FunctionDef bodies). */
export function collectDeclarationLines(
  index: CqlDefinitionIndex | null,
  elmXml?: string | null
): Set<number> {
  const lines = new Set<number>();
  if (index) {
    addSpanLines(index.libraryHeaderSpan, lines);
    for (const ref of index.includeStatements) {
      addSpanLines(ref.span, lines);
    }
    for (const defs of index.definitions.values()) {
      for (const def of defs) {
        if (
          def.kind === 'context' ||
          def.kind === 'valueset' ||
          def.kind === 'codesystem'
        ) {
          addSpanLines(def.span, lines);
        }
      }
    }
  }
  if (elmXml?.trim()) {
    addElmDeclarationLines(elmXml, lines);
  }
  return lines;
}

function addElmDeclarationLines(elmXml: string, lines: Set<number>): void {
  const doc = new DOMParser().parseFromString(elmXml, 'application/xml');
  if (doc.querySelector('parsererror')) {
    return;
  }
  for (const selector of [
    'usings > def',
    'includes > def',
    'parameters > def',
    'codeSystems > def',
    'valueSets > def',
    'codes > def',
    'concepts > def',
    'contexts > def',
  ]) {
    for (const def of doc.querySelectorAll(selector)) {
      addSpanLines(parseLocator(def.getAttribute('locator')), lines);
    }
  }
}

function addSpanLines(span: CqlSourceSpan | null | undefined, lines: Set<number>): void {
  if (!span) {
    return;
  }
  for (let line = span.startLine; line <= span.endLine; line++) {
    lines.add(line);
  }
}

export function breakpointRejectionReason(
  line: number,
  executable: Map<number, CqlDebugExecutableLineMeta> | null,
  declarationLines: Set<number> | null
): string {
  // null = never successfully translated; empty Map = translated but no expression starts.
  if (executable == null) {
    return 'Validate the library successfully before setting breakpoints.';
  }
  if (executable.has(line)) {
    return '';
  }
  if (declarationLines?.has(line)) {
    return `Line ${line} is a declaration, not an executable expression.`;
  }
  if (executable.size === 0) {
    return `No executable expressions in this library. Breakpoints bind to ELM expression starts.`;
  }
  return `No executable expression starts on line ${line}. Breakpoints bind to ELM expression starts.`;
}
