// Author: Preston Lee

import { BaseBrowserTool } from './base-browser-tool';

export class RemoveFromClipboardTool extends BaseBrowserTool {
  static readonly id = 'remove_from_clipboard';
  readonly name = RemoveFromClipboardTool.id;
  readonly description = 'Remove a single item from the FHIR clipboard by its id. Use list_clipboard to get item ids.';
  readonly parameters = {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Clipboard item id (from list_clipboard)' }
    },
    required: ['id']
  };

  execute(params: Record<string, unknown>): unknown {
    const id = params['id'] as string | undefined;
    if (!id || typeof id !== 'string') {
      throw new Error('id is required and must be a string');
    }

    const items = this.ctx.clipboardService.list();
    const found = items.some(item => item.id === id);
    if (!found) {
      throw new Error(`Clipboard item not found: ${id}. Use list_clipboard to see available ids.`);
    }

    this.ctx.clipboardService.remove(id);
    return { message: 'Item removed from clipboard', id };
  }
}
