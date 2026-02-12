// Author: Preston Lee

import { BaseBrowserTool } from './base-browser-tool';

export class SearchCodeTool extends BaseBrowserTool {
  static readonly id = 'search_code';
  static override planModeAllowed = true;
  static override statusMessage = 'Searching code...';
  readonly name = SearchCodeTool.id;
  readonly description = 'Search for patterns in CQL libraries open within the CQL IDE. Does not search external files or content.';
  readonly parameters = {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query (text pattern)' },
      libraryId: { type: 'string', description: 'Library ID (optional, searches all if not provided)' }
    },
    required: ['query']
  };

  execute(params: Record<string, unknown>): unknown {
    const query = params['query'] as string;
    const libraryId = params['libraryId'] as string | undefined;
    if (!query) {
      throw new Error('Search query is required');
    }

    const libraries = libraryId
      ? this.ctx.ideStateService.libraryResources().filter(l => l.id === libraryId)
      : this.ctx.ideStateService.libraryResources();

    const results: Array<{ libraryId: string; libraryName: string; line: number; content: string }> = [];
    const searchLower = query.toLowerCase();

    libraries.forEach(library => {
      const content = library.cqlContent || '';
      const lines = content.split('\n');
      lines.forEach((line, index) => {
        if (line.toLowerCase().includes(searchLower)) {
          results.push({
            libraryId: library.id,
            libraryName: library.library?.name || 'Unknown',
            line: index + 1,
            content: line.trim()
          });
        }
      });
    });

    return {
      query,
      resultsCount: results.length,
      results: results.slice(0, 50)
    };
  }
}
