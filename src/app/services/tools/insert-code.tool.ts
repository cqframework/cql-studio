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
    return {
      message: 'insert_code requires editor access via event chain',
      params
    };
  }
}
