// Author: Preston Lee

import { describe, expect, it } from 'vitest';
import { buildOpenCodeProblemsContext } from './opencode-problems-context.lib';

describe('OpenCode Problems context', () => {
  it('converts the visible Problems panel messages into located diagnostics', () => {
    expect(buildOpenCodeProblemsContext({
      libraryId: 'HelloWorld',
      file: 'libraries/HelloWorld.cql',
      documentRevision: 9,
      problems: [
        'Error: Syntax error at define (line 14)',
        'Error: Syntax error at : (line 14)',
        'Error: Could not resolve context name HelloWorld in model FHIR. (line 13)',
      ],
    })).toEqual({
      libraryId: 'HelloWorld',
      documentRevision: 9,
      diagnostics: [
        { severity: 'error', message: 'Syntax error at define', file: 'libraries/HelloWorld.cql', line: 14 },
        { severity: 'error', message: 'Syntax error at :', file: 'libraries/HelloWorld.cql', line: 14 },
        { severity: 'error', message: 'Could not resolve context name HelloWorld in model FHIR.', file: 'libraries/HelloWorld.cql', line: 13 },
      ],
    });
  });

  it('omits an empty Problems panel', () => {
    expect(buildOpenCodeProblemsContext({
      libraryId: 'Example', file: 'libraries/Example.cql', documentRevision: 1, problems: [],
    })).toBeUndefined();
  });
});
