// Author: Preston Lee

import assert from 'node:assert/strict';
import test from 'node:test';
import type { OpenCodeWorkspaceManifest } from '@cql-studio/core';
import { resolveMcpValidateTarget } from '../src/mcp-validate-target.js';

function manifest(files: OpenCodeWorkspaceManifest['files']): OpenCodeWorkspaceManifest {
  return {
    schemaVersion: 1,
    sessionId: 'test',
    createdAt: new Date().toISOString(),
    activeLibraryId: '',
    files,
  };
}

test('resolveMcpValidateTarget prefers an explicit file argument', () => {
  const target = resolveMcpValidateTarget(manifest({
    'libraries/One.cql': {
      libraryId: 'One',
      name: 'One',
      sourceHash: 'a',
      draft: false,
      writable: true,
    },
    'libraries/Two.cql': {
      libraryId: 'Two',
      name: 'Two',
      sourceHash: 'b',
      draft: false,
      writable: true,
    },
  }), { fileArg: 'libraries/Two.cql', envActiveFile: 'libraries/One.cql' });
  assert.equal(target, 'libraries/Two.cql');
});

test('resolveMcpValidateTarget falls back to the live manifest after an empty-session create-draft', () => {
  const empty = manifest({
    'dependencies/FHIRHelpers.cql': {
      libraryId: 'FHIRHelpers',
      name: 'FHIRHelpers',
      sourceHash: 'h',
      draft: false,
      writable: false,
    },
  });
  assert.throws(
    () => resolveMcpValidateTarget(empty, { envActiveFile: '' }),
    /cql_library_create_draft/
  );

  const afterDraft = manifest({
    'libraries/MyLibrary.cql': {
      libraryId: 'MyLibrary',
      name: 'MyLibrary',
      sourceHash: 'm',
      draft: false,
      writable: true,
    },
    'dependencies/FHIRHelpers.cql': {
      libraryId: 'FHIRHelpers',
      name: 'FHIRHelpers',
      sourceHash: 'h',
      draft: false,
      writable: false,
    },
  });
  assert.equal(
    resolveMcpValidateTarget(afterDraft, { envActiveFile: '' }),
    'libraries/MyLibrary.cql'
  );
});

test('resolveMcpValidateTarget ignores a stale env active file that left the manifest', () => {
  const target = resolveMcpValidateTarget(manifest({
    'libraries/New.cql': {
      libraryId: 'New',
      name: 'New',
      sourceHash: 'n',
      draft: false,
      writable: true,
    },
  }), { envActiveFile: 'libraries/Gone.cql' });
  assert.equal(target, 'libraries/New.cql');
});
