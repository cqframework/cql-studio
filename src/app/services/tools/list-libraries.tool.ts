// Author: Preston Lee

import { BaseBrowserTool } from './base-browser-tool';

export class ListLibrariesTool extends BaseBrowserTool {
  readonly name = 'list_libraries';
  readonly description = 'List all loaded CQL libraries';
  readonly parameters = {
    type: 'object',
    properties: {}
  };

  execute(): unknown {
    const libraries = this.ctx.ideStateService.libraryResources();
    return {
      count: libraries.length,
      libraries: libraries.map(lib => ({
        id: lib.id,
        name: lib.library?.name || 'Unnamed',
        isActive: lib.id === this.ctx.ideStateService.activeLibraryId()
      }))
    };
  }
}
