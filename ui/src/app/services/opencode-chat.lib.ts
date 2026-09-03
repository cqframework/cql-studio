// Author: Preston Lee

import type { OpenCodeUiMessage } from '../models/opencode.model';

/** Extract only human-readable chat text from OpenCode's SDK message shape. */
export function openCodeChatMessages(messages: unknown[]): OpenCodeUiMessage[] {
  const result: OpenCodeUiMessage[] = [];
  messages.forEach((raw, order) => {
    if (!raw || typeof raw !== 'object') return;
    const message = raw as {
      info?: { id?: unknown; role?: unknown };
      parts?: unknown[];
    };
    const role = message.info?.role === 'user' ? 'user'
      : message.info?.role === 'assistant' ? 'assistant' : null;
    if (!role || !Array.isArray(message.parts)) return;
    const text = message.parts
      .filter((part): part is { type: string; text: string } => Boolean(
        part && typeof part === 'object'
        && (part as { type?: unknown }).type === 'text'
        && typeof (part as { text?: unknown }).text === 'string'
      ))
      .map(part => part.text)
      .filter(value => !value.includes('<cql-studio-editor-context') && !value.includes('<cql-studio-resume-context'))
      .join('\n')
      .trim();
    if (!text) return;
    result.push({
      id: typeof message.info?.id === 'string' ? message.info.id : `saved-message-${order}`,
      role,
      text,
      order,
    });
  });
  return result;
}
