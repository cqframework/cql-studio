// Author: Preston Lee

export interface IdeEditor {
  getValue(): string;
  setValue(value: string): void;
  focus(): void;
  blur(): void;
  insertText(text: string): void;
  getSelection(): string;
  replaceSelection(text: string): void;
  formatCode(): void;
  clearCode(): void;
  validateSyntax(code: string): void;
  navigateToLine(lineNumber: number): void;
  navigateToPosition(line: number, column?: number): void;
}

export interface EditorState {
  cursorPosition?: { line: number; column: number };
  wordCount?: number;
  syntaxErrors: string[];
  isValidSyntax: boolean;
}
