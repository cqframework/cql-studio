// Author: Preston Lee

import { Injectable, computed, signal } from '@angular/core';
import { OpenCodeEditorContext } from '../models/opencode.model';

export interface OpenCodeEditorDocument {
  libraryId: string;
  content: string;
  userRevision: number;
}

export interface OpenCodeInlineEditOptions {
  prompt?: string;
  autoSend?: boolean;
}

@Injectable({ providedIn: 'root' })
export class OpenCodeEditorBridgeService {
  readonly documents = signal<Record<string, OpenCodeEditorDocument>>({});
  readonly document = computed(() => {
    const docs = this.documents();
    const ids = Object.keys(docs);
    return ids.length ? docs[ids[ids.length - 1]] : null;
  });
  readonly selection = signal<OpenCodeEditorContext | null>(null);
  readonly inlineRequest = signal<{
    id: number;
    context: OpenCodeEditorContext;
    prompt?: string;
    autoSend: boolean;
  } | null>(null);
  private inlineSequence = 0;

  recordDocument(libraryId: string, content: string, userRevision: number): void {
    this.documents.update(current => ({
      ...current,
      [libraryId]: { libraryId, content, userRevision },
    }));
    const selection = this.selection();
    if (selection && selection.libraryId === libraryId && selection.documentRevision !== userRevision) {
      this.selection.set(null);
    }
  }

  clearDocument(libraryId: string): void {
    this.documents.update(current => {
      if (!(libraryId in current)) return current;
      const next = { ...current };
      delete next[libraryId];
      return next;
    });
  }

  documentFor(libraryId: string): OpenCodeEditorDocument | null {
    return this.documents()[libraryId] ?? null;
  }

  recordSelection(context: OpenCodeEditorContext | null): void {
    this.selection.set(context?.selectedText ? context : null);
  }

  requestInlineEdit(context: OpenCodeEditorContext, options: OpenCodeInlineEditOptions = {}): void {
    this.selection.set(context);
    this.inlineRequest.set({
      id: ++this.inlineSequence,
      context: { ...context, mode: 'inline' },
      prompt: options.prompt,
      autoSend: Boolean(options.autoSend),
    });
  }
}
