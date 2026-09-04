// Author: Preston Lee

import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { LibraryService } from './library.service';
import { CqlIdeLibraryOpenerService } from './cql-ide-library-opener.service';
import { IdeStateService } from './ide-state.service';
import { asTestDouble, minimalLibrary } from '../../testing/spec-helpers';
import { WorkspaceLibraryOrigin } from '../components/cql-ide/shared/ide-types';

const origin: WorkspaceLibraryOrigin = {
  workspaceId: 'workspace-1',
  workspaceName: 'Quality Team',
  resourceReferenceId: 'reference-1',
  role: 'EDITOR',
};

describe('CqlIdeLibraryOpenerService workspace origin', () => {
  let opener: CqlIdeLibraryOpenerService;
  let ideState: IdeStateService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: LibraryService, useValue: asTestDouble<LibraryService>() }],
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
    const library = minimalLibrary({ id: 'Example', name: 'Example' });
    ideState.addLibraryResource({
      id: 'Example',
      name: 'Example',
      description: 'Example library',
      cqlContent: "library Example version '1.0.0'",
      originalContent: "library Example version '1.0.0'",
      isActive: false,
      isDirty: false,
      library,
    });

    await expect(opener.openLibraryFromServer(library, origin)).resolves.toBe('Example');

    expect(ideState.getActiveLibraryResource()?.workspaceOrigin).toEqual(origin);
  });
});
