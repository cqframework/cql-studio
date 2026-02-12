// Author: Preston Lee

import { BaseBrowserTool } from './base-browser-tool';

export class GetLibraryContentTool extends BaseBrowserTool {
  static readonly id = 'get_library_content';
  static override planModeAllowed = true;
  static override statusMessage = 'Loading library...';
  readonly name = GetLibraryContentTool.id;
  readonly description = 'Get the full content of a specific library';
  readonly parameters = {
    type: 'object',
    properties: {
      libraryId: { type: 'string', description: 'Library ID' }
    },
    required: ['libraryId']
  };

  execute(params: Record<string, unknown>): unknown {
    const libraryId = params['libraryId'] as string;
    if (!libraryId) {
      throw new Error('Library ID is required');
    }

    const library = this.ctx.ideStateService.libraryResources().find(l => l.id === libraryId);
    if (!library) {
      throw new Error(`Library not found: ${libraryId}`);
    }

    return {
      libraryId,
      libraryName: library.library?.name || 'Unknown',
      content: library.cqlContent || ''
    };
  }
}
