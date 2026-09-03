// Author: Preston Lee

import type { Text } from '@codemirror/state';
import type { OpenCodeEditorContext } from '../models/opencode.model';

export interface CqlAiDiagnosticFixRequest {
  context: OpenCodeEditorContext;
  prompt: string;
}

export function buildCqlAiDiagnosticFixRequest(input: {
  doc: Text;
  libraryId: string;
  userRevision: number;
  message: string;
  from: number;
  to: number;
}): CqlAiDiagnosticFixRequest {
  const from = Math.max(0, Math.min(input.from, input.doc.length));
  const to = Math.max(from, Math.min(input.to, input.doc.length));
  const diagnosticLine = input.doc.lineAt(from);
  const selectionFrom = to > from ? from : diagnosticLine.from;
  const selectionTo = to > from ? to : diagnosticLine.to;
  const selectionStart = input.doc.lineAt(selectionFrom);
  const selectionEnd = input.doc.lineAt(selectionTo);
  const nearbyStartLine = Math.max(1, selectionStart.number - 1);
  const nearbyEndLine = Math.min(input.doc.lines, selectionEnd.number + 1);
  const nearbyStart = input.doc.line(nearbyStartLine);
  const nearbyEnd = input.doc.line(nearbyEndLine);
  const nearbyCql = input.doc.sliceString(nearbyStart.from, nearbyEnd.to);

  return {
    context: {
      libraryId: input.libraryId,
      file: '',
      selectedText: input.doc.sliceString(selectionFrom, selectionTo),
      startLine: selectionStart.number,
      startColumn: selectionFrom - selectionStart.from,
      endLine: selectionEnd.number,
      endColumn: selectionTo - selectionEnd.from,
      documentRevision: input.userRevision,
      mode: 'inline',
    },
    prompt: [
      'Fix this CQL syntax error in the active library.',
      `Compiler diagnostic: ${input.message}`,
      `Location: line ${diagnosticLine.number}, column ${from - diagnosticLine.from + 1}.`,
      'Nearby CQL:',
      '```cql',
      nearbyCql,
      '```',
      'Make the smallest edit that resolves this diagnostic while preserving the author’s intent.',
      'Do not change unrelated code. Run cql_validate after editing and correct any syntax errors caused by the change.',
    ].join('\n'),
  };
}
