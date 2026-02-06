// Author: Preston Lee

import { BaseBrowserTool } from './base-browser-tool';

export class CreateLibraryTool extends BaseBrowserTool {
  readonly name = 'create_library';
  readonly description = 'Create a new empty CQL library and open it in the editor (same as clicking "Create New Library" button)';
  readonly parameters = {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Library name (optional, defaults to "NewLibrary")' },
      title: { type: 'string', description: 'Library title (optional, defaults to "New Library")' },
      version: { type: 'string', description: 'Library version (optional, defaults to "1.0.0")' },
      description: { type: 'string', description: 'Library description (optional, defaults to "New library")' }
    }
  };

  execute(params: Record<string, unknown>): unknown {
    const requestedName = (params['name'] as string) || 'NewLibrary';
    const requestedTitle = (params['title'] as string) || 'New Library';
    const requestedVersion = (params['version'] as string) || '1.0.0';

    const existingLibraries = this.ctx.ideStateService.libraryResources();
    const existingLibrary = existingLibraries.find(lib =>
      lib.name === requestedName ||
      lib.library?.name === requestedName ||
      (lib.title === requestedTitle && lib.version === requestedVersion)
    );

    if (existingLibrary) {
      this.ctx.ideStateService.selectLibraryResource(existingLibrary.id);
      return {
        libraryId: existingLibrary.id,
        name: existingLibrary.name || existingLibrary.library?.name || requestedName,
        title: existingLibrary.library?.title || existingLibrary.title || requestedTitle,
        version: existingLibrary.version || requestedVersion,
        message: `Library "${requestedName}" already exists, opened existing library instead of creating duplicate`,
        existing: true
      };
    }

    const newId = `new-library-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const effectiveFhirBaseUrl = this.ctx.settingsService.getEffectiveFhirBaseUrl();
    const canonicalUrl = `${effectiveFhirBaseUrl}/Library/${newId}`;

    const libraryResource = {
      id: newId,
      name: requestedName,
      title: requestedTitle,
      version: requestedVersion,
      description: (params['description'] as string) || 'New library',
      url: canonicalUrl,
      cqlContent: '',
      originalContent: '',
      isActive: false,
      isDirty: false,
      library: null
    };

    this.ctx.ideStateService.addLibraryResource(libraryResource);
    this.ctx.ideStateService.selectLibraryResource(newId);

    return {
      libraryId: newId,
      name: libraryResource.name,
      title: libraryResource.title,
      version: libraryResource.version,
      message: 'Library created and opened in editor',
      existing: false
    };
  }
}
