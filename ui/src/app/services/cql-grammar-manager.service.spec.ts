// Author: Preston Lee

import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, toggleComment } from '@codemirror/commands';
import { createCqlEditorBaseExtensions } from './cql-codemirror-extensions.lib';
import { CqlGrammarManager } from './cql-grammar-manager.service';

describe('CqlGrammarManager commentTokens', () => {
  function createState(doc: string, selection?: { anchor: number; head?: number }): EditorState {
    const grammar = new CqlGrammarManager();
    return EditorState.create({
      doc,
      selection,
      extensions: [...createCqlEditorBaseExtensions(), ...grammar.createExtensions()]
    });
  }

  function applyToggle(state: EditorState): { ok: boolean; state: EditorState } {
    let next = state;
    const ok = toggleComment({
      state: next,
      dispatch: tr => {
        next = tr.state;
      }
    });
    return { ok, state: next };
  }

  it('exposes // and /* */ commentTokens for CodeMirror', () => {
    const state = createState('define Foo: 1');
    expect(state.languageDataAt('commentTokens', 0)).toEqual([
      { line: '//', block: { open: '/*', close: '*/' } }
    ]);
  });

  it('binds Mod-/ to toggleComment via defaultKeymap', () => {
    const binding = defaultKeymap.find(b => b.key === 'Mod-/');
    expect(binding?.run).toBe(toggleComment);
  });

  it('toggles a single line comment', () => {
    let { ok, state } = applyToggle(createState('define Foo: 1'));
    expect(ok).toBe(true);
    expect(state.doc.toString()).toBe('// define Foo: 1');

    ({ ok, state } = applyToggle(state));
    expect(ok).toBe(true);
    expect(state.doc.toString()).toBe('define Foo: 1');
  });

  it('toggles comments across a multi-line selection', () => {
    const doc = 'define Foo: 1\ndefine Bar: 2';
    let { ok, state } = applyToggle(createState(doc, { anchor: 0, head: doc.length }));
    expect(ok).toBe(true);
    expect(state.doc.toString()).toBe('// define Foo: 1\n// define Bar: 2');

    ({ ok, state } = applyToggle(state));
    expect(ok).toBe(true);
    expect(state.doc.toString()).toBe(doc);
  });
});
