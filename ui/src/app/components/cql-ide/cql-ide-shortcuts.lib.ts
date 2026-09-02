// Author: Preston Lee

import { KeyboardShortcut } from './shared/ide-types';

export function isMacPlatform(): boolean {
  return navigator.platform.toUpperCase().indexOf('MAC') >= 0;
}

export function getAllShortcuts(isMac: boolean = isMacPlatform()): KeyboardShortcut[] {
  return [
    { key: 'F4', description: 'Save Active Editor' },
    { key: 'F5', description: 'Execute Active Library' },
    {
      key: 'F6',
      description: 'Execute All Open Libraries'
    },
    {
      key: isMac ? '⌘+⌥+W' : 'Ctrl+W',
      description: 'Close Active Editor'
    },
    {
      key: 'Ctrl+Space',
      description: 'Autocomplete'
    },
    {
      key: isMac ? '⌘+/' : 'Ctrl+/',
      description: 'Toggle Line Comment'
    },
    { key: 'F12', description: 'Go to Definition / Open Terminology' },
    { key: 'Shift+F12', description: 'Find All References' },
    { key: 'Hover / right-click', description: 'Find References, Peek ValueSet, Rename' }
  ];
}
