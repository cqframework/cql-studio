// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ElmIncludeParser, ElmIncludeRef } from './elm-include.lib';
import {
  buildDefinitionIndex,
  CqlDefinitionIndex,
  CqlDefinitionTarget,
  CqlReferenceMatch,
  CqlValidationDoc,
  findDefinition,
  findReferenceAt,
  isReferenceResolvableSync,
  resolveDefinitionTarget,
  spanToDocPosition
} from './elm-locator.lib';
import { CqlLibrarySourceService } from './cql-library-source.service';
import { LibraryService } from './library.service';
import { TranslationService } from './translation.service';

export type {
  CqlDefinitionIndex,
  CqlDefinitionTarget,
  CqlReferenceMatch,
  CqlSourceSpan,
  CqlValidationDoc
} from './elm-locator.lib';

export {
  elmColumnToCodeMirror,
  findReferenceAt,
  isReferenceResolvableSync,
  positionContains,
  spanToDocPosition
} from './elm-locator.lib';

@Injectable({
  providedIn: 'root'
})
export class CqlDefinitionIndexService {
  private readonly includeParser = inject(ElmIncludeParser);
  private readonly librarySourceService = inject(CqlLibrarySourceService);
  private readonly libraryService = inject(LibraryService);
  private readonly translationService = inject(TranslationService);

  private readonly includedIndexCache = new Map<string, CqlDefinitionIndex>();

  buildIndex(elmXml: string | null | undefined): CqlDefinitionIndex | null {
    if (!elmXml?.trim()) {
      return null;
    }
    return buildDefinitionIndex(elmXml, this.includeParser);
  }

  findReferenceAt(index: CqlDefinitionIndex, line: number, column: number): CqlReferenceMatch | null {
    return findReferenceAt(index, line, column);
  }

  resolveDefinitionTarget(match: CqlReferenceMatch, index: CqlDefinitionIndex): CqlDefinitionTarget | null {
    return resolveDefinitionTarget(match, index);
  }

  async resolveDefinitionTargetAsync(
    match: CqlReferenceMatch,
    index: CqlDefinitionIndex
  ): Promise<CqlDefinitionTarget | null> {
    const syncTarget = resolveDefinitionTarget(match, index);
    if (!syncTarget) {
      return null;
    }

    if (!syncTarget.crossLibrary || !syncTarget.includeRef) {
      return syncTarget;
    }

    const { reference } = match;

    if (reference.kind === 'includeStatement') {
      const includedIndex = await this.getIncludedLibraryIndex(syncTarget.includeRef);
      if (!includedIndex) {
        return null;
      }
      return {
        span: includedIndex.libraryHeaderSpan ?? { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
        crossLibrary: true,
        includeRef: syncTarget.includeRef
      };
    }

    const includedIndex = await this.getIncludedLibraryIndex(syncTarget.includeRef);
    if (!includedIndex) {
      return null;
    }

    if (reference.kind === 'functionRef' && reference.name) {
      const def = findDefinition(includedIndex, reference.name, 'function');
      if (!def) {
        return null;
      }
      return {
        span: def.span,
        crossLibrary: true,
        includeRef: syncTarget.includeRef
      };
    }

    if (reference.kind === 'expressionRef' && reference.name) {
      const def = findDefinition(includedIndex, reference.name);
      if (!def) {
        return null;
      }
      return {
        span: def.span,
        crossLibrary: true,
        includeRef: syncTarget.includeRef
      };
    }

    return {
      span: includedIndex.libraryHeaderSpan ?? { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
      crossLibrary: true,
      includeRef: syncTarget.includeRef
    };
  }

  async getIncludedLibraryIndex(ref: ElmIncludeRef): Promise<CqlDefinitionIndex | null> {
    const key = this.includeParser.cacheKey(ref.path, ref.system, ref.version);
    const cached = this.includedIndexCache.get(key);
    if (cached) {
      return cached;
    }

    let elmXml = this.librarySourceService.getCachedElm(ref.path, ref.system, ref.version);
    if (!elmXml?.trim()) {
      const library = await firstValueFrom(
        this.libraryService.findByNameAndVersion(ref.path, ref.version ?? undefined)
      );
      if (library) {
        try {
          elmXml = await firstValueFrom(this.libraryService.getElmXml(library));
          if (elmXml?.trim()) {
            this.librarySourceService.setCachedElm(ref.path, ref.system, ref.version, elmXml);
          }
        } catch {
          elmXml = null;
        }
      }
    }

    if (!elmXml?.trim()) {
      const cachedCql = this.librarySourceService.getCachedCql(ref.path, ref.system, ref.version);
      if (!cachedCql?.trim()) {
        return null;
      }
      const raw = this.translationService.translateCqlToElmRaw(cachedCql);
      elmXml = raw.elmXml;
    }

    const index = this.buildIndex(elmXml);
    if (index) {
      this.includedIndexCache.set(key, index);
    }
    return index;
  }

  clearIncludedIndexCache(): void {
    this.includedIndexCache.clear();
  }

  navigateTargetToPosition(target: CqlDefinitionTarget, doc: CqlValidationDoc): { line: number; column: number } {
    const position = spanToDocPosition(target.span, doc);
    const lineInfo = doc.line(target.span.startLine);
    return {
      line: target.span.startLine,
      column: position - lineInfo.from
    };
  }
}
