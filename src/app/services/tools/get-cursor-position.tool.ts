// Author: Preston Lee

import { BaseBrowserTool } from './base-browser-tool';

export class GetCursorPositionTool extends BaseBrowserTool {
  static readonly id = 'get_cursor_position';
  readonly name = GetCursorPositionTool.id;
  readonly description = 'Get the current cursor position in the editor';
  readonly parameters = {
    type: 'object',
    properties: {}
  };

  execute(): unknown {
    const editorState = this.ctx.ideStateService.editorState();
    return {
      cursorPosition: editorState.cursorPosition || null,
      hasCursor: !!editorState.cursorPosition
    };
  }
}
