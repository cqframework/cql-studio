// Author: Preston Lee

import { BaseBrowserTool } from './base-browser-tool';

export class GetSelectionTool extends BaseBrowserTool {
  readonly name = 'get_selection';
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
