// Author: Preston Lee

import { BaseBrowserTool } from './base-browser-tool';

export class FormatCodeTool extends BaseBrowserTool {
  readonly name = 'format_code';
  readonly description = 'Format the current CQL code in the editor';
  readonly parameters = {
    type: 'object',
    properties: {}
  };

  execute(): unknown {
    this.ctx.ideStateService.requestFormatCode();
    return { message: 'Code formatting requested' };
  }
}
