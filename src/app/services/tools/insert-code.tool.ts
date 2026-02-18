// Author: Preston Lee

import { BaseBrowserTool } from './base-browser-tool';

export class InsertCodeTool extends BaseBrowserTool {
  static readonly id = 'insert_code';
  static override statusMessage = 'Inserting code...';
  readonly name = InsertCodeTool.id;
  readonly description = 'Insert code at the current cursor position in the editor';
  readonly parameters = {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'Code to insert' }
    },
    required: ['code']
  };

  execute(params: Record<string, unknown>): unknown {
    const code = typeof params?.['code'] === 'string' ? params['code'] : '';
    if (!code.trim()) {
      throw new Error('insert_code requires a non-empty "code" string.');
    }

    return {
      accepted: true,
      mode: 'ui_event_chain',
      message: 'Insert request accepted and dispatched to the editor handler.',
      codeLength: code.length
    };
  }
}
