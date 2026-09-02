// Author: Preston Lee

export type CqlProblemSeverity = 'error' | 'warning' | 'info';

export interface ParsedProblemMessage {
  severity: CqlProblemSeverity;
  message: string;
  line: number | null;
  column: number | null;
  raw: string;
}

export interface CqlProblemParts {
  severity: CqlProblemSeverity;
  message: string;
  line?: number | null;
  column?: number | null;
}

const SEVERITY_PREFIXES: ReadonlyArray<{ label: string; severity: CqlProblemSeverity }> = [
  { label: 'Warning: ', severity: 'warning' },
  { label: 'Info: ', severity: 'info' },
  { label: 'Error: ', severity: 'error' }
];

/** Serialize a problem for the Problems panel (and related string channels). */
export function formatProblemMessage(parts: CqlProblemParts): string {
  const severityLabel =
    SEVERITY_PREFIXES.find(p => p.severity === parts.severity)?.label ?? 'Error: ';
  const location = formatLocationSuffix(parts.line ?? null, parts.column ?? null);
  return `${severityLabel}${parts.message.trim()}${location}`;
}

export function parseProblemMessage(raw: string): ParsedProblemMessage {
  const trimmed = raw.trim();
  const { severity, body } = splitSeverityPrefix(trimmed);
  const withLeadingLine = splitLeadingLinePrefix(body);
  const withTrailingLocation = splitTrailingLocation(withLeadingLine.message);

  return {
    severity,
    message: withTrailingLocation.message,
    line: withTrailingLocation.line ?? withLeadingLine.line,
    column: withTrailingLocation.column,
    raw
  };
}

export function problemsIndicateValidSyntax(messages: string[]): boolean {
  return !messages.some(m => parseProblemMessage(m).severity === 'error');
}

export function formatCharacterDiagnosticsForProblems(
  diagnostics: Array<{ message: string; from: number }>,
  doc: {
    lineAt: (pos: number) => { number: number; from?: number };
  }
): string[] {
  return diagnostics.map(d => {
    let line: number | null = null;
    let column: number | null = null;
    try {
      const lineInfo = doc.lineAt(d.from);
      line = lineInfo.number;
      if (typeof lineInfo.from === 'number') {
        column = d.from - lineInfo.from + 1;
      }
    } catch {
      line = null;
      column = null;
    }

    return formatProblemMessage({
      severity: 'warning',
      message: stripLeadingLinePrefix(d.message),
      line,
      column
    });
  });
}

function splitSeverityPrefix(text: string): { severity: CqlProblemSeverity; body: string } {
  const lower = text.toLowerCase();
  for (const { label, severity } of SEVERITY_PREFIXES) {
    if (lower.startsWith(label.toLowerCase())) {
      return {
        severity,
        body: text.slice(label.length).trimStart()
      };
    }
  }
  return { severity: 'error', body: text };
}

/**
 * Handles character-lint style prefixes: `Line 12: message`.
 */
function splitLeadingLinePrefix(body: string): { message: string; line: number | null } {
  if (!body.toLowerCase().startsWith('line ')) {
    return { message: body, line: null };
  }

  let i = 5; // after "line "
  while (i < body.length && body[i] === ' ') {
    i++;
  }

  const lineStart = i;
  while (i < body.length && isDigit(body[i]!)) {
    i++;
  }
  if (i === lineStart || body[i] !== ':') {
    return { message: body, line: null };
  }

  const line = Number(body.slice(lineStart, i));
  const message = body.slice(i + 1).trimStart();
  return { message, line: Number.isFinite(line) ? line : null };
}

function stripLeadingLinePrefix(message: string): string {
  return splitLeadingLinePrefix(message.trim()).message;
}

/**
 * Handles trailing locator suffixes produced with the Problems panel:
 * `message (line 12)` or `message (line 12, column 4)`.
 */
function splitTrailingLocation(body: string): {
  message: string;
  line: number | null;
  column: number | null;
} {
  if (!body.endsWith(')')) {
    return { message: body.trim(), line: null, column: null };
  }

  const open = body.toLowerCase().lastIndexOf('(line ');
  if (open < 0) {
    return { message: body.trim(), line: null, column: null };
  }

  const before = body.slice(0, open).trimEnd();
  let i = open + '(line '.length;
  while (i < body.length && body[i] === ' ') {
    i++;
  }

  const lineStart = i;
  while (i < body.length && isDigit(body[i]!)) {
    i++;
  }
  if (i === lineStart) {
    return { message: body.trim(), line: null, column: null };
  }
  const line = Number(body.slice(lineStart, i));

  let column: number | null = null;
  while (i < body.length && body[i] === ' ') {
    i++;
  }
  if (body.toLowerCase().startsWith(', column ', i)) {
    i += ', column '.length;
    while (i < body.length && body[i] === ' ') {
      i++;
    }
    const columnStart = i;
    while (i < body.length && isDigit(body[i]!)) {
      i++;
    }
    if (i > columnStart) {
      column = Number(body.slice(columnStart, i));
    }
  }

  while (i < body.length && body[i] === ' ') {
    i++;
  }
  if (body[i] !== ')' || i !== body.length - 1) {
    return { message: body.trim(), line: null, column: null };
  }

  return {
    message: before.trim(),
    line: Number.isFinite(line) ? line : null,
    column: column != null && Number.isFinite(column) ? column : null
  };
}

function formatLocationSuffix(line: number | null, column: number | null): string {
  if (line == null) {
    return '';
  }
  if (column == null) {
    return ` (line ${line})`;
  }
  return ` (line ${line}, column ${column})`;
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}
