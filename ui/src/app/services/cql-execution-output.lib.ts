// Author: Preston Lee

import { OutputSection } from '../components/cql-ide/shared/ide-types';
import { IdeExecutionSubject } from '../models/ide-context.model';

export interface ExecutionResultLike {
  libraryId?: string;
  libraryName?: string;
  subjectReference?: string;
  subjectId?: string;
  subjectDisplay?: string;
  /** @deprecated use subjectId */
  patientId?: string;
  /** @deprecated use subjectDisplay */
  patientName?: string;
  functionName?: string;
  executionTime?: number;
  error?: unknown;
  result?: unknown;
}

export function normalizeExecutionResults(results: unknown): ExecutionResultLike[] {
  if (!results) {
    return [];
  }
  if (Array.isArray(results)) {
    return results.flat() as ExecutionResultLike[];
  }
  return [results as ExecutionResultLike];
}

export function shouldRenderExecutionResultsSeparately(
  results: ExecutionResultLike[],
  subjects: IdeExecutionSubject[]
): boolean {
  return subjects.length > 0 || results.some(r => r.subjectId || r.patientId);
}

export function buildSeparateExecutionOutputSections(
  results: ExecutionResultLike[],
  title: string,
  subjects: IdeExecutionSubject[],
  subjectDisplayById: ReadonlyMap<string, string>,
  createSectionId: (index: number) => string
): OutputSection[] {
  return results.map((r, index) => {
    const subject = subjects[index];
    const subjectId = r.subjectId ?? r.patientId ?? subject?.id ?? subjects[index]?.id;
    const subjectReference = r.subjectReference ?? subject?.reference;
    const subjectLabel = r.subjectDisplay
      ?? r.patientName
      ?? (subjectId ? subjectDisplayById.get(subjectId) : undefined)
      ?? subject?.display
      ?? subjectReference
      ?? `Subject ${index + 1}`;
    const status = r.error ? 'error' : 'success';
    const executionTime = r.executionTime || 0;
    const librarySuffix = r.libraryName && !title.includes(r.libraryName) ? ` (${r.libraryName})` : '';

    return {
      id: createSectionId(index),
      title: `${title}${librarySuffix} - ${subjectLabel}`,
      content: JSON.stringify({
        libraryId: r.libraryId,
        libraryName: r.libraryName,
        subjectReference,
        subjectId,
        subjectDisplay: r.subjectDisplay ?? r.patientName ?? subjectDisplayById.get(subjectId ?? ''),
        functionName: r.functionName,
        executionTime: r.executionTime,
        error: r.error ?? undefined,
        result: r.result ?? undefined
      }),
      type: 'json' as const,
      status,
      executionTime,
      expanded: true,
      timestamp: new Date()
    };
  });
}
