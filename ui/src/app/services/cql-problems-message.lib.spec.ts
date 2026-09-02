// Author: Preston Lee

import { describe, expect, it } from 'vitest';
import {
  formatCharacterDiagnosticsForProblems,
  formatProblemMessage,
  parseProblemMessage,
  problemsIndicateValidSyntax
} from './cql-problems-message.lib';

describe('cql-problems-message.lib', () => {
  it('round-trips structured problem formatting', () => {
    const raw = formatProblemMessage({
      severity: 'error',
      message: 'Something broke',
      line: 12,
      column: 4
    });
    expect(raw).toBe('Error: Something broke (line 12, column 4)');
    expect(parseProblemMessage(raw)).toMatchObject({
      severity: 'error',
      message: 'Something broke',
      line: 12,
      column: 4
    });
  });

  it('parses error and warning prefixes with line locators', () => {
    const error = parseProblemMessage('Error: Something broke (line 12, column 4)');
    expect(error.severity).toBe('error');
    expect(error.line).toBe(12);
    expect(error.column).toBe(4);
    expect(error.message).toBe('Something broke');

    const warning = parseProblemMessage('Warning: Be careful (line 3)');
    expect(warning.severity).toBe('warning');
    expect(warning.line).toBe(3);
    expect(warning.message).toBe('Be careful');
  });

  it('parses leading Line N: prefixes from character lint', () => {
    const parsed = parseProblemMessage('Warning: Line 2: Character not valid in CQL');
    expect(parsed.severity).toBe('warning');
    expect(parsed.line).toBe(2);
    expect(parsed.message).toBe('Character not valid in CQL');
  });

  it('treats warnings-only as valid syntax', () => {
    expect(problemsIndicateValidSyntax(['Warning: x (line 1)'])).toBe(true);
    expect(problemsIndicateValidSyntax(['Error: x (line 1)', 'Warning: y (line 2)'])).toBe(false);
  });

  it('formats character diagnostics for Problems panel', () => {
    const messages = formatCharacterDiagnosticsForProblems(
      [{ message: 'Line 2: Character not valid in CQL', from: 10 }],
      { lineAt: () => ({ number: 2, from: 5 }) }
    );
    expect(messages[0]).toBe('Warning: Character not valid in CQL (line 2, column 6)');
  });
});
