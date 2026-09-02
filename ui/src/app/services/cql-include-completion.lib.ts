// Author: Preston Lee

import { Completion, CompletionContext, CompletionResult, CompletionSource } from '@codemirror/autocomplete';
import { Bundle, Library } from 'fhir/r4';
import { Observable, firstValueFrom } from 'rxjs';
import {
  formatCqlIncludeLibraryName,
  matchIncludeCompletionPrefix,
  quoteCqlSingleString,
  toCqlCalledIdentifier
} from './cql-identifier.lib';

export interface IncludeLibraryCompletionSource {
  searchLibraries: (term: string) => Observable<Bundle>;
  listLibraries: () => Observable<Bundle>;
}

function librariesFromBundle(bundle: Bundle | null | undefined): Library[] {
  if (!bundle?.entry?.length) {
    return [];
  }
  return bundle.entry
    .map(e => e.resource)
    .filter((r): r is Library => !!r && r.resourceType === 'Library');
}

function libraryCompletion(
  lib: Library,
  options: { insertLeadingSpace: boolean }
): Completion | null {
  const name = lib.name?.trim() || lib.id?.trim();
  if (!name) {
    return null;
  }
  const version = lib.version?.trim() || '1.0.0';
  const called = toCqlCalledIdentifier(name);
  const label = version ? `${name} ${version}` : name;
  const body = `${formatCqlIncludeLibraryName(name)} version ${quoteCqlSingleString(version)} called ${called}`;
  return {
    label,
    type: 'class',
    detail: 'library',
    info: lib.title || lib.url || name,
    apply: options.insertLeadingSpace ? ` ${body}` : body,
    boost: 20
  };
}

/**
 * Mid-typing include completion has no ELM yet; detect `include <term>` via a
 * line-prefix pattern (safe: end-anchored, not whole-library structure).
 */
function isIncludeCompletionContext(
  context: CompletionContext
): { from: number; term: string; insertLeadingSpace: boolean } | null {
  const line = context.state.doc.lineAt(context.pos);
  const textBefore = line.text.slice(0, context.pos - line.from);
  const match = matchIncludeCompletionPrefix(textBefore);
  if (!match) {
    return null;
  }
  const insertLeadingSpace = match.term.length === 0 && !/\s$/.test(textBefore);
  return {
    from: line.from + match.termStart,
    term: match.term,
    insertLeadingSpace
  };
}

export function createIncludeLibraryCompletionSource(
  source: IncludeLibraryCompletionSource
): CompletionSource {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const includeCtx = isIncludeCompletionContext(context);
    if (!includeCtx) {
      return null;
    }
    if (!context.explicit && includeCtx.term.length < 1) {
      return null;
    }

    let bundle: Bundle;
    try {
      bundle = includeCtx.term
        ? await firstValueFrom(source.searchLibraries(includeCtx.term))
        : await firstValueFrom(source.listLibraries());
    } catch {
      return null;
    }

    const options = librariesFromBundle(bundle)
      .map(lib => libraryCompletion(lib, { insertLeadingSpace: includeCtx.insertLeadingSpace }))
      .filter((c): c is Completion => c != null)
      .slice(0, 50);

    if (options.length === 0) {
      return null;
    }

    return {
      from: includeCtx.from,
      options,
      validFor: /^[A-Za-z0-9_.-]*$/
    };
  };
}
