// Author: Preston Lee

import type { OpenCodeIdeDiagnostics } from '../models/opencode.model';
import { parseProblemMessage } from './cql-problems-message.lib';

export function buildOpenCodeProblemsContext(input: {
  libraryId: string;
  file: string;
  documentRevision: number;
  problems: string[];
}): OpenCodeIdeDiagnostics | undefined {
  const diagnostics = input.problems.slice(0, 100).map(raw => {
    const parsed = parseProblemMessage(raw);
    return {
      severity: parsed.severity,
      message: parsed.message.slice(0, 2_000),
      file: input.file,
      ...(parsed.line == null ? {} : { line: parsed.line }),
      ...(parsed.column == null ? {} : { column: parsed.column }),
    };
  });
  if (diagnostics.length === 0) return undefined;
  return {
    libraryId: input.libraryId,
    documentRevision: input.documentRevision,
    diagnostics,
  };
}
