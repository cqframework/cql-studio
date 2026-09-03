// Author: Preston Lee

import { Text } from '@codemirror/state';
import { buildCqlAiDiagnosticFixRequest } from './cql-ai-diagnostic-fix.lib';

describe('buildCqlAiDiagnosticFixRequest', () => {
  it('includes the diagnostic, exact range, and bounded nearby CQL', () => {
    const doc = Text.of([
      "library Example version '1.0.0'",
      "using FHIR version '4.0.1'",
      'context Patient',
      'define Broken: 1 +',
      'define Healthy: 42',
      'define Unrelated: true',
    ]);
    const from = doc.line(4).from + 'define Broken: '.length;
    const to = doc.line(4).to;

    const request = buildCqlAiDiagnosticFixRequest({
      doc,
      libraryId: 'Example',
      userRevision: 7,
      message: "Syntax error at '+'",
      from,
      to,
    });

    expect(request.context).toEqual(expect.objectContaining({
      libraryId: 'Example',
      selectedText: '1 +',
      startLine: 4,
      documentRevision: 7,
      mode: 'inline',
    }));
    expect(request.prompt).toContain("Compiler diagnostic: Syntax error at '+'");
    expect(request.prompt).toContain('context Patient');
    expect(request.prompt).toContain('define Broken: 1 +');
    expect(request.prompt).toContain('define Healthy: 42');
    expect(request.prompt).not.toContain('define Unrelated: true');
    expect(request.prompt).toContain('Run cql_validate after editing');
  });
});
