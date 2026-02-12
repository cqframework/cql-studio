// Author: Preston Lee

import { BaseBrowserTool } from './base-browser-tool';

export class NavigateToLineTool extends BaseBrowserTool {
  static readonly id = 'navigate_to_line';
  static override planModeAllowed = true;
  static override statusMessage = 'Navigating...';
  readonly name = NavigateToLineTool.id;
  readonly description = 'Navigate the editor to a specific line number';
  readonly parameters = {
    type: 'object',
    properties: {
      line: { type: 'number', description: 'Line number to navigate to' }
    },
    required: ['line']
  };

  execute(params: Record<string, unknown>): unknown {
    const lineNumber = params?.['line'] as number | undefined;
    if (!lineNumber || typeof lineNumber !== 'number' || lineNumber < 1) {
      throw new Error('Line number is required and must be a positive number');
    }
    this.ctx.ideStateService.requestNavigateToLine(lineNumber);
    return { message: `Navigation to line ${lineNumber} requested` };
  }
}
