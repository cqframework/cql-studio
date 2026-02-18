// Author: Preston Lee

import { BaseBrowserTool } from './base-browser-tool';

export class ReplaceCodeTool extends BaseBrowserTool {
  static readonly id = 'replace_code';
  static override statusMessage = 'Updating code...';
  readonly name = ReplaceCodeTool.id;
  readonly description = 'Replace selected code or code at specified position';
  readonly parameters = {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'Code to insert' },
      startLine: { type: 'number', description: 'Start line number (optional)' },
      startCol: { type: 'number', description: 'Start column number (optional)' },
      endLine: { type: 'number', description: 'End line number (optional)' },
      endCol: { type: 'number', description: 'End column number (optional)' }
    },
    required: ['code']
  };

  execute(params: Record<string, unknown>): unknown {
    const code = typeof params?.['code'] === 'string' ? params['code'] : '';
    if (!code.trim()) {
      throw new Error('replace_code requires a non-empty "code" string.');
    }

    return {
      accepted: true,
      mode: 'ui_event_chain',
      message: 'Replace request accepted and dispatched to the editor handler.',
      codeLength: code.length,
      range: {
        startLine: params['startLine'] ?? null,
        startCol: params['startCol'] ?? null,
        endLine: params['endLine'] ?? null,
        endCol: params['endCol'] ?? null
      }
    };
  }
}
