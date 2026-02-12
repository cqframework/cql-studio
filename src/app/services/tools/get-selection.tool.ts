// Author: Preston Lee

import { BaseBrowserTool } from './base-browser-tool';

export class GetSelectionTool extends BaseBrowserTool {
  static readonly id = 'get_selection';
  static override planModeAllowed = true;
  static override statusMessage = 'Getting selection...';
  readonly name = GetSelectionTool.id;
  readonly description = 'Get the currently selected code in the editor';
  readonly parameters = {
    type: 'object',
    properties: {}
  };

  execute(): unknown {
    return {
      message: 'Selection requires editor component access via event chain',
      hasSelection: false
    };
  }
}
