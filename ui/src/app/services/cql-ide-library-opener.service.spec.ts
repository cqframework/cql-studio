// Author: Preston Lee

import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { Library } from 'fhir/r4';
import { LibraryService } from './library.service';
import { CqlIdeLibraryOpenerService } from './cql-ide-library-opener.service';
import { IdeStateService } from './ide-state.service';
import { minimalLibrary } from '../../testing/spec-helpers';
import { WorkspaceLibraryOrigin } from '../components/cql-ide/shared/ide-types';

const origin: WorkspaceLibraryOrigin = {
  workspaceId: 'workspace-1',
  workspaceName: 'Quality Team',
  resourceReferenceId: 'reference-1',
  role: 'EDITOR',
};

describe('CqlIdeLibraryOpenerService', () => {
  let opener: CqlIdeLibraryOpenerService;
  let ideState: IdeStateService;
  let libraryService: {
    get: ReturnType<typeof vi.fn>;
    getCqlContent: ReturnType<typeof vi.fn>;
    urlFor: ReturnType<typeof vi.fn>;
    findByNameAndVersion: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    libraryService = {
      get: vi.fn(),
      getCqlContent: vi.fn(),
      urlFor: vi.fn((id: string) => `https://example.org/Library/${id}`),
      findByNameAndVersion: vi.fn(),
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: LibraryService, useValue: libraryService }],
    });
    opener = TestBed.inject(CqlIdeLibraryOpenerService);
    ideState = TestBed.inject(IdeStateService);
  });

  it('carries workspace identity across navigation into the IDE', () => {
    const library = minimalLibrary({ id: 'Example', name: 'Example' });

    opener.requestOpenFromServer(library, origin);

    expect(opener.consumePendingOpen()).toEqual({ library, workspaceOrigin: origin });
    expect(opener.consumePendingOpen()).toBeNull();
  });

  it('associates an already-open library with its workspace reference', async () => {
    const library = minimalLibrary({ id: 'Example', name: 'Example', version: '1.0.0' });
    ideState.addLibraryResource({
      id: 'Example',
      name: 'Example',
      version: '1.0.0',
      description: 'Example library',
      cqlContent: "library Example version '1.0.0'",
      originalContent: "library Example version '1.0.0'",
      isActive: false,
      isDirty: false,
      library,
    });
    libraryService.get.mockReturnValue(of(library));
    libraryService.getCqlContent.mockReturnValue(
      of({ cqlContent: "library Example version '1.0.0'", fromUrl: false })
    );

    await expect(opener.openLibraryFromServer(library, origin)).resolves.toBe('Example');

    expect(ideState.getActiveLibraryResource()?.workspaceOrigin).toEqual(origin);
  });

  it('refreshes CQL and FHIR version when reopening a clean tab', async () => {
    const stale: Library = minimalLibrary({
      id: 'BMI',
      name: 'BMI',
      version: '1.0.0',
      content: [{ contentType: 'text/cql', data: 'c3RhbGU=' }],
    });
    const fresh: Library = minimalLibrary({
      id: 'BMI',
      name: 'BMI',
      version: '1.0.1',
      content: [{ contentType: 'text/cql', data: 'ZnJlc2g=' }],
    });
    ideState.addLibraryResource({
      id: 'BMI',
      name: 'BMI',
      version: '1.0.0',
      description: 'stale',
      cqlContent: "library BMI version '1.0.0'",
      originalContent: "library BMI version '1.0.0'",
      isActive: false,
      isDirty: false,
      library: stale,
    });
    libraryService.get.mockReturnValue(of(fresh));
    libraryService.getCqlContent.mockReturnValue(
      of({ cqlContent: "library BMI version '1.0.1'\n", fromUrl: false })
    );

    await opener.openLibraryFromServer(fresh);

    const active = ideState.getActiveLibraryResource();
    expect(active?.version).toBe('1.0.1');
    expect(active?.cqlContent).toContain("version '1.0.1'");
    expect(active?.library?.version).toBe('1.0.1');
    expect(active?.isDirty).toBe(false);
  });

  it('does not overwrite a dirty open tab when reopening from Navigation', async () => {
    const library = minimalLibrary({ id: 'BMI', name: 'BMI', version: '1.0.1' });
    ideState.addLibraryResource({
      id: 'BMI',
      name: 'BMI',
      version: '1.0.0',
      description: 'local edits',
      cqlContent: "library BMI version '1.0.0'\n// draft",
      originalContent: "library BMI version '1.0.0'",
      isActive: false,
      isDirty: true,
      library,
    });

    await opener.openLibraryFromServer(library);

    expect(libraryService.get).not.toHaveBeenCalled();
    const active = ideState.getActiveLibraryResource();
    expect(active?.version).toBe('1.0.0');
    expect(active?.cqlContent).toContain('// draft');
    expect(active?.isDirty).toBe(true);
  });
});
