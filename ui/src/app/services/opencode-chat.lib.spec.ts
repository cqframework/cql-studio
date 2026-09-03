// Author: Preston Lee

import { openCodeChatMessages } from './opencode-chat.lib';

describe('openCodeChatMessages', () => {
  it('extracts user and assistant text while hiding internal context', () => {
    expect(openCodeChatMessages([
      { info: { id: 'u1', role: 'user' }, parts: [{ type: 'text', text: 'Fix this CQL' }] },
      { info: { id: 'hidden', role: 'user' }, parts: [{ type: 'text', text: '<cql-studio-resume-context>secret</cql-studio-resume-context>' }] },
      { info: { id: 'a1', role: 'assistant' }, parts: [{ type: 'text', text: 'Done.' }, { type: 'tool', input: {} }] },
    ])).toEqual([
      { id: 'u1', role: 'user', text: 'Fix this CQL', order: 0 },
      { id: 'a1', role: 'assistant', text: 'Done.', order: 2 },
    ]);
  });
});
