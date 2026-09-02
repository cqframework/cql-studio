// Author: Preston Lee

import {
  CqlDefinitionIndex,
  CqlSourceSpan,
  positionContains,
  spanSize
} from './elm-locator.lib';
import { findBareCqlIdentifierSpan, findCqlNameTokenSpanOnLine, quoteCqlIdentifier } from './cql-identifier.lib';

export type CqlTerminologyResourceKind = 'ValueSet' | 'CodeSystem';

export interface CqlTerminologyDeclaration {
  kind: CqlTerminologyResourceKind;
  name: string;
  url: string;
  nameSpan: CqlSourceSpan;
  urlSpan: CqlSourceSpan;
  line: number;
}

export interface CqlTerminologyNameUse {
  kind: CqlTerminologyResourceKind;
  name: string;
  url: string;
  span: CqlSourceSpan;
}

export interface CqlTerminologySymbolIndex {
  declarations: CqlTerminologyDeclaration[];
  nameUses: CqlTerminologyNameUse[];
  byName: Map<string, CqlTerminologyDeclaration>;
}

export interface CqlTerminologySymbolMatch {
  declaration: CqlTerminologyDeclaration;
  hit: 'name' | 'url' | 'use';
  span: CqlSourceSpan;
}

function lineColumnSpan(
  lineNumber: number,
  startOffset: number,
  endOffset: number
): CqlSourceSpan {
  return {
    startLine: lineNumber,
    startColumn: startOffset + 1,
    endLine: lineNumber,
    endColumn: endOffset
  };
}

function findSubstringSpan(
  lineNumber: number,
  lineText: string,
  needle: string,
  fromIndex = 0
): CqlSourceSpan | null {
  const idx = lineText.indexOf(needle, fromIndex);
  if (idx < 0) {
    return null;
  }
  return lineColumnSpan(lineNumber, idx, idx + needle.length);
}

function readQuotedDouble(lineText: string, fromIndex: number): { value: string; start: number; end: number } | null {
  const start = lineText.indexOf('"', fromIndex);
  if (start < 0) {
    return null;
  }
  let i = start + 1;
  let value = '';
  while (i < lineText.length) {
    const ch = lineText[i];
    if (ch === '\\' && i + 1 < lineText.length) {
      value += lineText[i + 1];
      i += 2;
      continue;
    }
    if (ch === '"') {
      return { value, start, end: i + 1 };
    }
    value += ch;
    i += 1;
  }
  return null;
}

function readQuotedSingle(lineText: string, fromIndex: number): { value: string; start: number; end: number } | null {
  const start = lineText.indexOf("'", fromIndex);
  if (start < 0) {
    return null;
  }
  let i = start + 1;
  let value = '';
  while (i < lineText.length) {
    const ch = lineText[i];
    if (ch === '\\' && i + 1 < lineText.length) {
      value += lineText[i + 1];
      i += 2;
      continue;
    }
    if (ch === "'") {
      return { value, start, end: i + 1 };
    }
    value += ch;
    i += 1;
  }
  return null;
}

function parseTerminologyDeclarationLine(
  lineNumber: number,
  lineText: string
): CqlTerminologyDeclaration | null {
  let trimmedStart = 0;
  while (trimmedStart < lineText.length && (lineText[trimmedStart] === ' ' || lineText[trimmedStart] === '\t')) {
    trimmedStart += 1;
  }
  const rest = lineText.slice(trimmedStart).toLowerCase();
  let kind: CqlTerminologyResourceKind | null = null;
  let keywordLen = 0;
  if (rest.startsWith('valueset')) {
    kind = 'ValueSet';
    keywordLen = 'valueset'.length;
  } else if (rest.startsWith('codesystem')) {
    kind = 'CodeSystem';
    keywordLen = 'codesystem'.length;
  } else {
    return null;
  }

  const afterKeyword = trimmedStart + keywordLen;
  const afterKeywordChar = lineText[afterKeyword];
  if (afterKeywordChar !== ' ' && afterKeywordChar !== '\t') {
    return null;
  }
  const nameTok = readQuotedDouble(lineText, afterKeyword);
  if (!nameTok) {
    return null;
  }
  const colonIdx = lineText.indexOf(':', nameTok.end);
  if (colonIdx < 0) {
    return null;
  }
  const urlTok = readQuotedSingle(lineText, colonIdx + 1);
  if (!urlTok) {
    return null;
  }

  return {
    kind,
    name: nameTok.value,
    url: urlTok.value,
    nameSpan: lineColumnSpan(lineNumber, nameTok.start, nameTok.end),
    urlSpan: lineColumnSpan(lineNumber, urlTok.start, urlTok.end),
    line: lineNumber
  };
}

/**
 * Source-only index: declarations only. Name uses require ELM (ValueSetRef/CodeSystemRef).
 * Prefer {@link buildTerminologySymbolIndexFromElm} once validation produces ELM.
 */
export function buildTerminologySymbolIndex(source: string): CqlTerminologySymbolIndex {
  const declarations: CqlTerminologyDeclaration[] = [];
  const byName = new Map<string, CqlTerminologyDeclaration>();
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i] ?? '';
    const declaration = parseTerminologyDeclarationLine(i + 1, lineText);
    if (!declaration) {
      continue;
    }
    declarations.push(declaration);
    byName.set(declaration.name, declaration);
  }

  return { declarations, nameUses: [], byName };
}

function refineDeclarationSpansFromSource(
  source: string,
  name: string,
  url: string | undefined,
  kind: CqlTerminologyResourceKind,
  defSpan: CqlSourceSpan
): CqlTerminologyDeclaration {
  const lines = source.split('\n');
  const lineNumber = defSpan.startLine;
  const lineText = lines[lineNumber - 1];

  if (lineText) {
    const fromSource = parseTerminologyDeclarationLine(lineNumber, lineText);
    if (fromSource && fromSource.name === name) {
      return {
        ...fromSource,
        kind,
        url: url ?? fromSource.url
      };
    }

    const quotedName = quoteCqlIdentifier(name);
    const quotedNameSpan = findSubstringSpan(lineNumber, lineText, quotedName);
    const bare = quotedNameSpan ? null : findBareCqlIdentifierSpan(lineText, name);
    const nameSpan =
      quotedNameSpan ??
      (bare ? lineColumnSpan(lineNumber, bare.start, bare.end) : null);

    if (nameSpan) {
      const resolvedUrl = url ?? '';
      const quotedUrl = resolvedUrl ? `'${resolvedUrl}'` : '';
      const urlSpan =
        (quotedUrl ? findSubstringSpan(lineNumber, lineText, quotedUrl) : null) ??
        ({
          startLine: lineNumber,
          startColumn: nameSpan.endColumn,
          endLine: lineNumber,
          endColumn: nameSpan.endColumn
        } satisfies CqlSourceSpan);

      return {
        kind,
        name,
        url: resolvedUrl,
        nameSpan,
        urlSpan,
        line: lineNumber
      };
    }
  }

  // Locator line missing/mismatched: keep ELM def span so refs still resolve.
  return {
    kind,
    name,
    url: url ?? '',
    nameSpan: defSpan,
    urlSpan: defSpan,
    line: defSpan.startLine
  };
}

/**
 * Prefer ELM valueSets/codeSystems defs and ValueSetRef/CodeSystemRef locators.
 * Source is used only to refine declaration name/url token spans on the def line.
 */
export function buildTerminologySymbolIndexFromElm(
  index: CqlDefinitionIndex,
  source: string
): CqlTerminologySymbolIndex {
  const declarations: CqlTerminologyDeclaration[] = [];
  const byName = new Map<string, CqlTerminologyDeclaration>();

  for (const defs of index.definitions.values()) {
    for (const def of defs) {
      if (def.kind !== 'valueset' && def.kind !== 'codesystem') {
        continue;
      }
      const kind: CqlTerminologyResourceKind = def.kind === 'valueset' ? 'ValueSet' : 'CodeSystem';
      const declaration = refineDeclarationSpansFromSource(source, def.name, def.url, kind, def.span);
      declarations.push(declaration);
      byName.set(declaration.name, declaration);
    }
  }

  const nameUses: CqlTerminologyNameUse[] = [];
  const lines = source.split('\n');
  for (const ref of index.references) {
    if (ref.kind !== 'valueSetRef' && ref.kind !== 'codeSystemRef') {
      continue;
    }
    if (!ref.name || ref.libraryName) {
      continue;
    }
    const declaration = byName.get(ref.name);
    if (!declaration) {
      continue;
    }
    const lineText = lines[ref.span.startLine - 1];
    const refined =
      lineText != null
        ? findCqlNameTokenSpanOnLine(lineText, ref.span.startLine, ref.name)
        : null;
    nameUses.push({
      kind: declaration.kind,
      name: ref.name,
      url: declaration.url,
      span: refined ?? ref.span
    });
  }

  return { declarations, nameUses, byName };
}

export function findTerminologySymbolAt(
  index: CqlTerminologySymbolIndex,
  line: number,
  column: number
): CqlTerminologySymbolMatch | null {
  const candidates: CqlTerminologySymbolMatch[] = [];

  for (const declaration of index.declarations) {
    if (positionContains(declaration.nameSpan, line, column)) {
      candidates.push({ declaration, hit: 'name', span: declaration.nameSpan });
    }
    if (positionContains(declaration.urlSpan, line, column)) {
      candidates.push({ declaration, hit: 'url', span: declaration.urlSpan });
    }
  }

  for (const use of index.nameUses) {
    if (!positionContains(use.span, line, column)) {
      continue;
    }
    const declaration = index.byName.get(use.name);
    if (!declaration) {
      continue;
    }
    candidates.push({ declaration, hit: 'use', span: use.span });
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => spanSize(a.span) - spanSize(b.span));
  return candidates[0];
}

export function provisionalFhirIdFromUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    return '';
  }
  const withoutQuery = trimmed.split('?')[0] ?? trimmed;
  const segments = withoutQuery.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? trimmed;
}
