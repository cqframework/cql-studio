// Author: Preston Lee

import { BaseBrowserTool } from './base-browser-tool';

export class GetCodeTool extends BaseBrowserTool {
  static readonly id = 'get_code';
  readonly name = GetCodeTool.id;
  readonly description = 'Get current code content from the active editor';
  readonly parameters = {
    type: 'object',
    properties: {
      libraryId: { type: 'string', description: 'Library ID (optional, uses active if not provided)' }
    }
  };

  execute(params: Record<string, unknown>): unknown {
    let libraryId = params?.['libraryId'] as string | undefined;

    if (!libraryId) {
      const activeLibrary = this.ctx.ideStateService.getActiveLibraryResource();
      if (activeLibrary) {
        libraryId = activeLibrary.id;
      } else {
        const allLibraries = this.ctx.ideStateService.libraryResources();
        if (allLibraries.length === 0) {
          throw new Error('No libraries available. Please create or load a library first using create_library tool.');
        }
        libraryId = allLibraries[0].id;
      }
    }

    const libraries = this.ctx.ideStateService.libraryResources();
    if (!libraryId) {
      const libraryList = libraries.map(l => `- ${l.name || l.id}`).join('\n');
      throw new Error(`No active library and no library specified. Available libraries:\n${libraryList}\n\nUse create_library to create a new library, or specify libraryId parameter.`);
    }

    const library = libraries.find(l => l.id === libraryId);
    if (!library) {
      const libraryList = libraries.length > 0
        ? libraries.map(l => `- ${l.name || l.id} (${l.id})`).join('\n')
        : 'No libraries available';
      throw new Error(`Library not found: ${libraryId}\n\nAvailable libraries:\n${libraryList}\n\nUse list_libraries tool to see all available libraries.`);
    }

    return {
      libraryId,
      libraryName: library.library?.name || library.name || 'Unknown',
      content: library.cqlContent || ''
    };
  }
}
