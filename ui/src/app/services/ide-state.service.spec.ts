// Author: Preston Lee

import { describe, expect, it } from 'vitest';
import { IdeStateService } from './ide-state.service';
import { OutputSection } from '../components/cql-ide/shared/ide-types';

function makeSection(id: string, title: string): OutputSection {
  return {
    id,
    title,
    content: `content-${id}`,
    type: 'text',
    status: 'success',
    expanded: true,
    timestamp: new Date()
  };
}

describe('IdeStateService output sections', () => {
  it('replaces console with full batch when preserveLogs is false', () => {
    const service = new IdeStateService();
    service.setPreserveLogs(false);
    service.addOutputSection(makeSection('existing', 'Existing'));

    service.addOutputSections([
      makeSection('a', 'Patient A'),
      makeSection('b', 'Patient B'),
      makeSection('c', 'Patient C')
    ]);

    const sections = service.outputSections();
    expect(sections).toHaveLength(3);
    expect(sections.map(s => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps single-section replace behavior when preserveLogs is false', () => {
    const service = new IdeStateService();
    service.setPreserveLogs(false);

    service.addOutputSection(makeSection('a', 'First'));
    service.addOutputSection(makeSection('b', 'Second'));

    const sections = service.outputSections();
    expect(sections).toHaveLength(1);
    expect(sections[0].id).toBe('b');
  });

  it('appends batches in order when preserveLogs is true', () => {
    const service = new IdeStateService();
    service.setPreserveLogs(true);

    service.addOutputSections([
      makeSection('a', 'Patient A'),
      makeSection('b', 'Patient B')
    ]);
    service.addOutputSections([
      makeSection('c', 'Patient C')
    ]);

    const sections = service.outputSections();
    expect(sections.map(s => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('no-ops on empty batch', () => {
    const service = new IdeStateService();
    service.setPreserveLogs(false);
    service.addOutputSection(makeSection('existing', 'Existing'));

    service.addOutputSections([]);

    expect(service.outputSections()).toHaveLength(1);
    expect(service.outputSections()[0].id).toBe('existing');
  });
});

describe('IdeStateService triggerReload', () => {
  it('keeps reload trigger set so change-detection effects can observe it', async () => {
    const service = new IdeStateService();
    service.triggerReload('lib-1');

    expect(service.reloadTrigger()?.libraryId).toBe('lib-1');
    expect(service.reloadTrigger()?.timestamp).toEqual(expect.any(Number));

    await Promise.resolve();

    expect(service.reloadTrigger()?.libraryId).toBe('lib-1');
  });

  it('emits a distinct trigger object on each triggerReload for the same library', () => {
    const service = new IdeStateService();
    service.triggerReload('lib-1');
    const first = service.reloadTrigger();
    service.triggerReload('lib-1');
    const second = service.reloadTrigger();

    expect(first).not.toBe(second);
    expect(second?.libraryId).toBe('lib-1');
  });
});

describe('IdeStateService removeLibraryResources', () => {
  it('removes many libraries in one update', () => {
    const service = new IdeStateService();
    service.addLibraryResource({
      id: 'a', name: 'A', description: '', cqlContent: '', originalContent: '',
      isActive: false, isDirty: false, library: null,
    });
    service.addLibraryResource({
      id: 'b', name: 'B', description: '', cqlContent: '', originalContent: '',
      isActive: false, isDirty: true, library: null,
    });
    service.addLibraryResource({
      id: 'c', name: 'C', description: '', cqlContent: '', originalContent: '',
      isActive: false, isDirty: false, library: null,
    });

    service.removeLibraryResources(['a', 'c']);

    expect(service.libraryResources().map(library => library.id)).toEqual(['b']);
  });

  it('no-ops on an empty id list', () => {
    const service = new IdeStateService();
    service.addLibraryResource({
      id: 'a', name: 'A', description: '', cqlContent: '', originalContent: '',
      isActive: false, isDirty: false, library: null,
    });

    service.removeLibraryResources([]);

    expect(service.libraryResources()).toHaveLength(1);
  });
});

describe('IdeStateService resetEditorSession', () => {
  it('clears libraries, console output, and translation state from the previous environment', () => {
    const service = new IdeStateService();
    service.addLibraryResource({
      id: 'lib',
      name: 'Lib',
      description: '',
      cqlContent: 'library Lib',
      originalContent: 'library Lib',
      isActive: true,
      isDirty: true,
      library: null,
    });
    service.selectLibraryResource('lib');
    service.addTextOutput('Run', 'old environment', 'success');
    service.setElmTranslationResults('<library/>');
    service.setExecuting(true);
    const session = service.currentEditorSession();

    service.resetEditorSession();

    expect(service.libraryResources()).toEqual([]);
    expect(service.activeLibraryId()).toBeNull();
    expect(service.outputSections()).toEqual([]);
    expect(service.elmTranslationResults()).toBeNull();
    expect(service.isExecuting()).toBe(false);
    expect(service.editorState().syntaxErrors).toEqual([]);
    expect(service.isCurrentEditorSession(session)).toBe(false);
    expect(service.currentEditorSession()).toBe(session + 1);
  });
});
