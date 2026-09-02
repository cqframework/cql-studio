// Author: Preston Lee

import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Library } from 'fhir/r4';
import { LibraryService } from './library.service';
import { IdeStateService } from './ide-state.service';
import { ElmIncludeRef } from './elm-include.lib';
import { WorkspaceLibraryOrigin } from '../components/cql-ide/shared/ide-types';

export interface PendingLibraryOpen {
  library: Library;
  workspaceOrigin?: WorkspaceLibraryOrigin;
}

@Injectable({
  providedIn: 'root'
})
export class CqlIdeLibraryOpenerService {
  private readonly libraryService = inject(LibraryService);
  private readonly ideStateService = inject(IdeStateService);

  private readonly _pendingOpen = signal<PendingLibraryOpen | null>(null);

  readonly pendingOpen = this._pendingOpen.asReadonly();

  /**
   * Queue a library to open after navigating to the IDE.
   * Prefer this over calling openLibraryFromServer across a route change
   * (avoids continuing async work on a destroyed source component).
   */
  requestOpenFromServer(library: Library, workspaceOrigin?: WorkspaceLibraryOrigin): void {
    if (!library.id?.trim()) {
      return;
    }
    this._pendingOpen.set({ library, ...(workspaceOrigin ? { workspaceOrigin } : {}) });
  }

  consumePendingOpen(): PendingLibraryOpen | null {
    const pending = this._pendingOpen();
    this._pendingOpen.set(null);
    return pending;
  }

  clearPendingOpen(): void {
    this._pendingOpen.set(null);
  }

  findOpenLibraryTabId(library: Library): string | null {
    if (!library.id) {
      return null;
    }
    const existing = this.ideStateService.libraryResources().find(
      lib => lib.id === library.id || (
        lib.library?.name === library.name &&
        (lib.version ?? lib.library?.version) === library.version
      )
    );
    return existing?.id ?? null;
  }

  findOpenTabByIncludeRef(ref: ElmIncludeRef): string | null {
    const existing = this.ideStateService.libraryResources().find(lib => {
      const name = lib.library?.name ?? lib.name;
      const version = lib.library?.version ?? lib.version;
      return name === ref.path && (version ?? null) === (ref.version ?? null);
    });
    return existing?.id ?? null;
  }

  async openLibraryFromServer(
    library: Library,
    workspaceOrigin?: WorkspaceLibraryOrigin
  ): Promise<string | null> {
    if (!library.id) {
      return null;
    }

    const existingId = this.findOpenLibraryTabId(library);
    if (existingId) {
      if (workspaceOrigin) {
        this.ideStateService.updateLibraryResource(existingId, { workspaceOrigin });
      }
      this.ideStateService.selectLibraryResource(existingId);
      await this.waitForLibraryReady(existingId);
      return existingId;
    }

    let freshLibrary: Library;
    try {
      freshLibrary = await firstValueFrom(this.libraryService.get(library.id));
    } catch (error) {
      console.error('Error fetching library from server:', error);
      return this.openLibraryFromCachedData(library, workspaceOrigin);
    }

    if (!freshLibrary.id) {
      return null;
    }

    const cqlAttachment = freshLibrary.content?.find(c => c.contentType === 'text/cql');
    const fromUrl = !!(cqlAttachment?.url && !cqlAttachment?.data);

    if (fromUrl) {
      const libraryResource = {
        id: freshLibrary.id,
        name: freshLibrary.name || freshLibrary.id,
        title: freshLibrary.title || freshLibrary.name || freshLibrary.id,
        version: freshLibrary.version || '1.0.0',
        description: freshLibrary.description || `Library ${freshLibrary.name || freshLibrary.id}`,
        url: freshLibrary.url || this.libraryService.urlFor(freshLibrary.id),
        cqlContent: '',
        originalContent: '',
        isActive: false,
        isDirty: false,
        library: freshLibrary,
        contentLoading: true,
        isReadOnly: true,
        ...(workspaceOrigin ? { workspaceOrigin } : {})
      };
      this.ideStateService.addLibraryResource(libraryResource);
      this.ideStateService.selectLibraryResource(freshLibrary.id);
    }

    try {
      const { cqlContent } = await firstValueFrom(this.libraryService.getCqlContent(freshLibrary));
      if (fromUrl) {
        this.ideStateService.updateLibraryResource(freshLibrary.id!, {
          cqlContent,
          originalContent: cqlContent,
          contentLoading: false,
          contentLoadError: undefined
        });
        this.ideStateService.triggerReload(freshLibrary.id!);
      } else {
        const libraryResource = {
          id: freshLibrary.id!,
          name: freshLibrary.name || freshLibrary.id!,
          title: freshLibrary.title || freshLibrary.name || freshLibrary.id!,
          version: freshLibrary.version || '1.0.0',
          description: freshLibrary.description || `Library ${freshLibrary.name || freshLibrary.id}`,
          url: freshLibrary.url || this.libraryService.urlFor(freshLibrary.id!),
          cqlContent,
          originalContent: cqlContent,
          isActive: false,
          isDirty: false,
          library: freshLibrary,
          contentLoading: false,
          isReadOnly: false,
          ...(workspaceOrigin ? { workspaceOrigin } : {})
        };
        this.ideStateService.addLibraryResource(libraryResource);
        this.ideStateService.selectLibraryResource(freshLibrary.id!);
      }
      await this.waitForLibraryReady(freshLibrary.id!);
      return freshLibrary.id!;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (fromUrl) {
        const errorMessage = `Could not load CQL from URL for library "${freshLibrary.name || freshLibrary.id}". ${message}`;
        this.ideStateService.updateLibraryResource(freshLibrary.id!, {
          contentLoading: false,
          contentLoadError: errorMessage
        });
        this.ideStateService.addTextOutput('Library Load Failed', errorMessage, 'error');
      }
      return null;
    }
  }

  async openIncludedLibrary(ref: ElmIncludeRef): Promise<string | null> {
    const existingTabId = this.findOpenTabByIncludeRef(ref);
    if (existingTabId) {
      this.ideStateService.selectLibraryResource(existingTabId);
      await this.waitForLibraryReady(existingTabId);
      return existingTabId;
    }

    let library: Library | null;
    try {
      library = await firstValueFrom(
        this.libraryService.findByNameAndVersion(ref.path, ref.version ?? undefined)
      );
    } catch {
      return null;
    }

    if (!library) {
      return null;
    }

    return this.openLibraryFromServer(library);
  }

  private async openLibraryFromCachedData(
    library: Library,
    workspaceOrigin?: WorkspaceLibraryOrigin
  ): Promise<string | null> {
    const id = library.id;
    if (!id) {
      return null;
    }

    const existingId = this.findOpenLibraryTabId(library);
    if (existingId) {
      if (workspaceOrigin) {
        this.ideStateService.updateLibraryResource(existingId, { workspaceOrigin });
      }
      this.ideStateService.selectLibraryResource(existingId);
      await this.waitForLibraryReady(existingId);
      return existingId;
    }

    const cqlAttachment = library.content?.find(c => c.contentType === 'text/cql');
    const fromUrl = !!(cqlAttachment?.url && !cqlAttachment?.data);

    if (fromUrl) {
      const libraryResource = {
        id,
        name: library.name || id,
        title: library.title || library.name || id,
        version: library.version || '1.0.0',
        description: library.description || `Library ${library.name || id}`,
        url: library.url || this.libraryService.urlFor(id),
        cqlContent: '',
        originalContent: '',
        isActive: false,
        isDirty: false,
        library,
        contentLoading: true,
        isReadOnly: true,
        ...(workspaceOrigin ? { workspaceOrigin } : {})
      };
      this.ideStateService.addLibraryResource(libraryResource);
      this.ideStateService.selectLibraryResource(id);
    }

    try {
      const { cqlContent } = await firstValueFrom(this.libraryService.getCqlContent(library));
      if (fromUrl) {
        this.ideStateService.updateLibraryResource(id, {
          cqlContent,
          originalContent: cqlContent,
          contentLoading: false,
          contentLoadError: undefined
        });
        this.ideStateService.triggerReload(id);
      } else {
        const libraryResource = {
          id,
          name: library.name || id,
          title: library.title || library.name || id,
          version: library.version || '1.0.0',
          description: library.description || `Library ${library.name || id}`,
          url: library.url || this.libraryService.urlFor(id),
          cqlContent,
          originalContent: cqlContent,
          isActive: false,
          isDirty: false,
          library,
          contentLoading: false,
          isReadOnly: false,
          ...(workspaceOrigin ? { workspaceOrigin } : {})
        };
        this.ideStateService.addLibraryResource(libraryResource);
        this.ideStateService.selectLibraryResource(id);
      }
      await this.waitForLibraryReady(id);
      return id;
    } catch {
      return null;
    }
  }

  private waitForLibraryReady(libraryId: string): Promise<void> {
    return new Promise(resolve => {
      const check = (): void => {
        const resource = this.ideStateService.libraryResources().find(lib => lib.id === libraryId);
        if (!resource) {
          resolve();
          return;
        }
        if (resource.contentLoading || resource.contentLoadError) {
          if (resource.contentLoadError) {
            resolve();
            return;
          }
          requestAnimationFrame(check);
          return;
        }
        resolve();
      };
      check();
    });
  }
}
