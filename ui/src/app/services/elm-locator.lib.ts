// Author: Preston Lee

import { ElmIncludeParser, ElmIncludeRef } from './elm-include.lib';

export interface CqlSourceSpan {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export type CqlDefinitionKind = 'expression' | 'function' | 'context' | 'valueset' | 'codesystem';

export interface CqlDefinition {
  name: string;
  kind: CqlDefinitionKind;
  span: CqlSourceSpan;
  /** Canonical URL/id for valueset/codesystem defs from ELM. */
  url?: string;
  accessLevel?: 'Public' | 'Private';
}

export interface CqlExpressionDefinition {
  name: string;
  modifiers: string[];
}

export type CqlReferenceKind =
  | 'expressionRef'
  | 'functionRef'
  | 'includeStatement'
  | 'valueSetRef'
  | 'codeSystemRef';

export interface CqlReference {
  kind: CqlReferenceKind;
  name: string | null;
  libraryName: string | null;
  span: CqlSourceSpan;
  includeRef?: ElmIncludeRef;
}

export interface CqlDefinitionIndex {
  definitions: Map<string, CqlDefinition[]>;
  references: CqlReference[];
  includeStatements: CqlReference[];
  includes: Map<string, ElmIncludeRef>;
  libraryHeaderSpan: CqlSourceSpan | null;
}

export interface CqlReferenceMatch {
  reference: CqlReference;
}

export interface CqlDefinitionTarget {
  span: CqlSourceSpan;
  crossLibrary: boolean;
  includeRef?: ElmIncludeRef;
}

export interface CqlValidationDocLine {
  from: number;
  to: number;
  length: number;
}

export interface CqlValidationDoc {
  line: (lineNumber: number) => CqlValidationDocLine;
}

const LOCATOR_PATTERN = /^(\d+):(\d+)-(\d+):(\d+)$/;

export function parseLocator(locator: string | null | undefined): CqlSourceSpan | null {
  if (!locator?.trim()) {
    return null;
  }
  const match = LOCATOR_PATTERN.exec(locator.trim());
  if (!match) {
    return null;
  }
  return {
    startLine: Number(match[1]),
    startColumn: Number(match[2]),
    endLine: Number(match[3]),
    endColumn: Number(match[4])
  };
}

export function spanSize(span: CqlSourceSpan): number {
  const lineSpan = span.endLine - span.startLine;
  const colSpan = span.endColumn - span.startColumn;
  return lineSpan * 10_000 + colSpan;
}

export function positionContains(span: CqlSourceSpan, line: number, column: number): boolean {
  if (line < span.startLine || line > span.endLine) {
    return false;
  }
  const column1Based = column + 1;
  if (line === span.startLine && column1Based < span.startColumn) {
    return false;
  }
  if (line === span.endLine && column1Based > span.endColumn) {
    return false;
  }
  return true;
}

export function spanToDocPosition(span: CqlSourceSpan, doc: CqlValidationDoc): number {
  const lineInfo = doc.line(span.startLine);
  const columnOffset = Math.max(0, span.startColumn - 1);
  return lineInfo.from + Math.min(columnOffset, lineInfo.length);
}

export function elmColumnToCodeMirror(elmColumn: number): number {
  return Math.max(0, elmColumn - 1);
}

function parseAccessLevel(value: string | null): 'Public' | 'Private' | undefined {
  return value === 'Public' || value === 'Private' ? value : undefined;
}

function notableExpressionModifiers(def: CqlDefinition): string[] {
  return def.accessLevel === 'Private' ? ['private'] : [];
}

export function buildDefinitionIndex(elmXml: string, includeParser: ElmIncludeParser): CqlDefinitionIndex | null {
  if (!elmXml?.trim()) {
    return null;
  }

  const doc = new DOMParser().parseFromString(elmXml, 'application/xml');
  if (doc.querySelector('parsererror')) {
    return null;
  }

  const definitions = new Map<string, CqlDefinition[]>();
  const references: CqlReference[] = [];
  const includeStatements: CqlReference[] = [];
  const includes = new Map<string, ElmIncludeRef>();

  const addDefinition = (
    name: string,
    kind: CqlDefinitionKind,
    span: CqlSourceSpan,
    extras?: { url?: string; accessLevel?: 'Public' | 'Private' }
  ): void => {
    const existing = definitions.get(name) ?? [];
    existing.push({ name, kind, span, ...extras });
    definitions.set(name, existing);
  };

  for (const def of doc.querySelectorAll('statements > def')) {
    const name = def.getAttribute('name');
    const locator = def.getAttribute('locator');
    const span = parseLocator(locator);
    if (!name || !span) {
      continue;
    }
    const typeAttr =
      def.getAttribute('xsi:type') ??
      def.getAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'type') ??
      '';
    const kind: CqlDefinitionKind = typeAttr.includes('FunctionDef') ? 'function' : 'expression';
    const accessLevel = parseAccessLevel(def.getAttribute('accessLevel'));
    addDefinition(name, kind, span, accessLevel ? { accessLevel } : undefined);
  }

  for (const def of doc.querySelectorAll('contexts > def')) {
    const name = def.getAttribute('name');
    const locator = def.getAttribute('locator');
    const span = parseLocator(locator);
    if (!name || !span) {
      continue;
    }
    addDefinition(name, 'context', span);
  }

  for (const def of doc.querySelectorAll('valueSets > def')) {
    const name = def.getAttribute('name');
    const locator = def.getAttribute('locator');
    const url = def.getAttribute('id');
    const span = parseLocator(locator);
    if (!name || !span) {
      continue;
    }
    addDefinition(name, 'valueset', span, url ? { url } : undefined);
  }

  for (const def of doc.querySelectorAll('codeSystems > def')) {
    const name = def.getAttribute('name');
    const locator = def.getAttribute('locator');
    const url = def.getAttribute('id');
    const span = parseLocator(locator);
    if (!name || !span) {
      continue;
    }
    addDefinition(name, 'codesystem', span, url ? { url } : undefined);
  }

  for (const element of doc.querySelectorAll('[locator]')) {
    const locator = element.getAttribute('locator');
    const span = parseLocator(locator);
    if (!span) {
      continue;
    }

    const typeAttr =
      element.getAttribute('xsi:type') ??
      element.getAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'type') ??
      '';

    if (typeAttr.includes('ExpressionRef')) {
      references.push({
        kind: 'expressionRef',
        name: element.getAttribute('name'),
        libraryName: element.getAttribute('libraryName'),
        span
      });
      continue;
    }

    if (typeAttr.includes('FunctionRef')) {
      references.push({
        kind: 'functionRef',
        name: element.getAttribute('name'),
        libraryName: element.getAttribute('libraryName'),
        span
      });
      continue;
    }

    if (typeAttr.includes('ValueSetRef')) {
      references.push({
        kind: 'valueSetRef',
        name: element.getAttribute('name'),
        libraryName: element.getAttribute('libraryName'),
        span
      });
      continue;
    }

    if (typeAttr.includes('CodeSystemRef')) {
      references.push({
        kind: 'codeSystemRef',
        name: element.getAttribute('name'),
        libraryName: element.getAttribute('libraryName'),
        span
      });
    }
  }

  for (const def of doc.querySelectorAll('includes > def')) {
    const path = def.getAttribute('path');
    const version = def.getAttribute('version');
    const localIdentifier = def.getAttribute('localIdentifier');
    const system = def.getAttribute('system');
    const locator = def.getAttribute('locator');
    const span = parseLocator(locator);

    if (!path || !localIdentifier) {
      continue;
    }

    const ref: ElmIncludeRef = {
      path,
      version: version || null,
      localIdentifier,
      system: system || null
    };

    if (includeParser.isFhirResolvable(ref) && span) {
      includes.set(localIdentifier, ref);
      includeStatements.push({
        kind: 'includeStatement',
        name: path,
        libraryName: localIdentifier,
        span,
        includeRef: ref
      });
    }
  }

  let libraryHeaderSpan: CqlSourceSpan | null = null;
  for (const annotation of doc.querySelectorAll('annotation')) {
    const typeAttr =
      annotation.getAttribute('xsi:type') ??
      annotation.getAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'type') ??
      '';
    if (!typeAttr.endsWith(':Annotation') && typeAttr !== 'a:Annotation') {
      continue;
    }
    const text = annotation.textContent?.trim() ?? '';
    if (text.startsWith('library ')) {
      libraryHeaderSpan = { startLine: 1, startColumn: 1, endLine: 1, endColumn: Math.max(1, text.length) };
      break;
    }
  }

  return {
    definitions,
    references,
    includeStatements,
    includes,
    libraryHeaderSpan
  };
}

export function findReferenceAt(
  index: CqlDefinitionIndex,
  line: number,
  column: number
): CqlReferenceMatch | null {
  const candidates: CqlReference[] = [];

  for (const reference of index.references) {
    if (positionContains(reference.span, line, column)) {
      candidates.push(reference);
    }
  }

  for (const includeStatement of index.includeStatements) {
    if (positionContains(includeStatement.span, line, column)) {
      candidates.push(includeStatement);
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => spanSize(a.span) - spanSize(b.span));
  return { reference: candidates[0] };
}

export function findDefinition(
  index: CqlDefinitionIndex,
  name: string,
  kind?: CqlDefinitionKind
): CqlDefinition | null {
  const defs = index.definitions.get(name);
  if (!defs?.length) {
    return null;
  }
  if (kind) {
    return defs.find(d => d.kind === kind) ?? null;
  }
  return defs[0];
}

/** Expression defs from the translated ELM index, excluding functions and context aliases. */
export function expressionDefinitions(index: CqlDefinitionIndex): CqlExpressionDefinition[] {
  const expressions: CqlExpressionDefinition[] = [];
  const seen = new Set<string>();
  for (const defs of index.definitions.values()) {
    if (defs.some(def => def.kind === 'context')) {
      continue;
    }
    for (const def of defs) {
      if (def.kind !== 'expression' || seen.has(def.name)) {
        continue;
      }
      seen.add(def.name);
      expressions.push({ name: def.name, modifiers: notableExpressionModifiers(def) });
    }
  }
  return expressions;
}

export function resolveDefinitionTarget(
  match: CqlReferenceMatch,
  index: CqlDefinitionIndex
): CqlDefinitionTarget | null {
  const { reference } = match;

  if (reference.kind === 'includeStatement') {
    if (!reference.includeRef) {
      return null;
    }
    return {
      span: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
      crossLibrary: true,
      includeRef: reference.includeRef
    };
  }

  if (reference.kind === 'expressionRef') {
    if (reference.libraryName) {
      const includeRef = index.includes.get(reference.libraryName);
      if (!includeRef || !reference.name) {
        return null;
      }
      return {
        span: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
        crossLibrary: true,
        includeRef
      };
    }
    if (!reference.name) {
      return null;
    }
    const defs = index.definitions.get(reference.name) ?? [];
    const def =
      defs.find(d => d.kind === 'expression' || d.kind === 'function' || d.kind === 'context') ?? null;
    if (!def) {
      return null;
    }
    return { span: def.span, crossLibrary: false };
  }

  if (reference.kind === 'functionRef') {
    if (reference.libraryName) {
      const includeRef = index.includes.get(reference.libraryName);
      if (!includeRef || !reference.name) {
        return null;
      }
      return {
        span: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
        crossLibrary: true,
        includeRef
      };
    }
    if (!reference.name) {
      return null;
    }
    const def = findDefinition(index, reference.name, 'function');
    if (!def) {
      return null;
    }
    return { span: def.span, crossLibrary: false };
  }

  if (reference.kind === 'valueSetRef') {
    if (!reference.name) {
      return null;
    }
    const def = findDefinition(index, reference.name, 'valueset');
    if (!def) {
      return null;
    }
    return { span: def.span, crossLibrary: false };
  }

  if (reference.kind === 'codeSystemRef') {
    if (!reference.name) {
      return null;
    }
    const def = findDefinition(index, reference.name, 'codesystem');
    if (!def) {
      return null;
    }
    return { span: def.span, crossLibrary: false };
  }

  return null;
}

export function isReferenceResolvableSync(
  match: CqlReferenceMatch,
  index: CqlDefinitionIndex
): boolean {
  return resolveDefinitionTarget(match, index) !== null;
}
