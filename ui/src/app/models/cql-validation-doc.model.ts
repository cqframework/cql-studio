// Author: Preston Lee

/** CodeMirror document shape for mapping compiler/character diagnostics to positions. */
export type CqlValidationDoc = {
  line: (lineNumber: number) => { from: number; to: number; length?: number };
  lineAt?: (pos: number) => { number: number };
};
