// Author: Preston Lee

import { BaseBrowserTool } from './base-browser-tool';

export class ClearClipboardTool extends BaseBrowserTool {
  static readonly id = 'clear_clipboard';
  readonly name = ClearClipboardTool.id;
  readonly description = 'Clear all items from the FHIR clipboard.';
  readonly parameters = {
    type: 'object',
    properties: {}
  };

  execute(): unknown {
    this.ctx.clipboardService.clear();
    return { message: 'Clipboard cleared' };
  }
}
