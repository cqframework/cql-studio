import { Injectable, signal } from '@angular/core';
import { OpenCodeEditorContext } from '../models/opencode.model';

export interface OpenCodeEditorDocument {
  libraryId: string;
  content: string;
  userRevision: number;
}

@Injectable({ providedIn: 'root' })
export class OpenCodeEditorBridgeService {
  readonly document = signal<OpenCodeEditorDocument | null>(null);
  readonly selection = signal<OpenCodeEditorContext | null>(null);
  readonly inlineRequest = signal<{ id: number; context: OpenCodeEditorContext } | null>(null);
  private inlineSequence = 0;

  recordDocument(libraryId: string, content: string, userRevision: number): void {
    this.document.set({ libraryId, content, userRevision });
    const selection = this.selection();
    if (selection && selection.libraryId === libraryId && selection.documentRevision !== userRevision) {
      this.selection.set(null);
    }
  }

  recordSelection(context: OpenCodeEditorContext | null): void {
    this.selection.set(context?.selectedText ? context : null);
  }

  requestInlineEdit(context: OpenCodeEditorContext): void {
    this.selection.set(context);
    this.inlineRequest.set({ id: ++this.inlineSequence, context: { ...context, mode: 'inline' } });
  }
}
