// Author: Preston Lee

import { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { ThemeType } from '../models/settings.model';

const DARK_HIGHLIGHT = HighlightStyle.define([
  { tag: tags.keyword, color: '#7bb3f0', fontWeight: 'bold' },
  { tag: tags.function(tags.variableName), color: '#f0e68c' },
  { tag: tags.typeName, color: '#6dd5ed' },
  { tag: tags.operator, color: '#e0e0e0' },
  { tag: tags.number, color: '#a8d8a8' },
  { tag: tags.string, color: '#f4a261' },
  { tag: tags.variableName, color: '#b3d9ff' },
  { tag: tags.comment, color: '#8fbc8f', fontStyle: 'italic' },
  { tag: tags.bracket, color: '#e0e0e0' },
  { tag: tags.punctuation, color: '#e0e0e0' }
]);

const LIGHT_HIGHLIGHT = HighlightStyle.define([
  { tag: tags.keyword, color: '#0550ae', fontWeight: 'bold' },
  { tag: tags.function(tags.variableName), color: '#8250df' },
  { tag: tags.typeName, color: '#116329' },
  { tag: tags.operator, color: '#24292f' },
  { tag: tags.number, color: '#0550ae' },
  { tag: tags.string, color: '#0a3069' },
  { tag: tags.variableName, color: '#24292f' },
  { tag: tags.comment, color: '#6e7781', fontStyle: 'italic' },
  { tag: tags.bracket, color: '#24292f' },
  { tag: tags.punctuation, color: '#24292f' }
]);

function createEditorChromeTheme(dark: boolean, height: string): Extension {
  return EditorView.theme({
    '&': {
      height,
      fontSize: '13px',
      fontFamily: "'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', 'Courier New', monospace",
      backgroundColor: 'var(--bs-body-bg)',
      color: 'var(--bs-body-color)'
    },
    '.cm-content': {
      padding: '12px',
      minHeight: height,
      color: 'var(--bs-body-color)',
      caretColor: 'var(--bs-body-color)'
    },
    '.cm-focused': {
      outline: 'none'
    },
    '.cm-editor': {
      border: 'none',
      borderRadius: '0',
      backgroundColor: 'var(--bs-body-bg)'
    },
    '.cm-scroller': {
      backgroundColor: 'var(--bs-body-bg)'
    },
    '.cm-gutters': {
      backgroundColor: 'var(--bs-secondary-bg)',
      color: 'var(--bs-secondary-color)',
      borderRight: '1px solid var(--bs-border-color)'
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'var(--bs-tertiary-bg)'
    },
    '.cm-activeLine': {
      backgroundColor: dark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.04)'
    },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
      backgroundColor: dark ? '#264f78' : '#b6d6f2'
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--bs-body-color)'
    },
    '.cm-placeholder': {
      color: 'var(--bs-secondary-color)',
      fontStyle: 'italic'
    },
    '.cm-tooltip': {
      backgroundColor: 'var(--bs-body-bg)',
      border: '1px solid var(--bs-border-color)',
      borderRadius: '4px',
      color: 'var(--bs-body-color)',
      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.15)'
    },
    '.cm-tooltip-lint': {
      fontFamily: "'Courier New', Courier, monospace",
      fontSize: '0.85rem',
      lineHeight: '1.4'
    },
    '.cm-diagnostic': {
      backgroundColor: 'var(--bs-body-bg)',
      color: 'var(--bs-body-color)',
      padding: '6px 8px'
    },
    '.cm-diagnostic-error': {
      borderLeftColor: 'var(--bs-danger)'
    },
    '.cm-diagnostic-warning': {
      borderLeftColor: 'var(--bs-warning)'
    },
    '.cm-diagnosticText': {
      color: 'var(--bs-body-color)'
    },
    '.cm-diagnosticSource': {
      color: 'var(--bs-secondary-color)'
    }
  }, { dark });
}

export function createCqlEditorThemeExtensions(theme: ThemeType, height: string): Extension[] {
  const dark = theme === ThemeType.DARK;
  return [
    createEditorChromeTheme(dark, height),
    syntaxHighlighting(dark ? DARK_HIGHLIGHT : LIGHT_HIGHLIGHT)
  ];
}
