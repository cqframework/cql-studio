// Author: Preston Lee

import type { BrowserToolContext, BrowserToolMCPMetadata } from './base-browser-tool';
import { BaseBrowserTool } from './base-browser-tool';
import { InsertCodeTool } from './insert-code.tool';
import { ReplaceCodeTool } from './replace-code.tool';
import { GetCodeTool } from './get-code.tool';
import { FormatCodeTool } from './format-code.tool';
import { ListLibrariesTool } from './list-libraries.tool';
import { GetLibraryContentTool } from './get-library-content.tool';
import { SearchCodeTool } from './search-code.tool';
import { GetCursorPositionTool } from './get-cursor-position.tool';
import { GetSelectionTool } from './get-selection.tool';
import { NavigateToLineTool } from './navigate-to-line.tool';
import { CreateLibraryTool } from './create-library.tool';
import { ListClipboardTool } from './list-clipboard.tool';
import { ClearClipboardTool } from './clear-clipboard.tool';
import { AddToClipboardTool } from './add-to-clipboard.tool';
import { RemoveFromClipboardTool } from './remove-from-clipboard.tool';

export class BrowserToolsRegistry {
  static readonly toolClasses = [
    InsertCodeTool,
    ReplaceCodeTool,
    GetCodeTool,
    FormatCodeTool,
    ListLibrariesTool,
    GetLibraryContentTool,
    SearchCodeTool,
    GetCursorPositionTool,
    GetSelectionTool,
    NavigateToLineTool,
    CreateLibraryTool,
    ListClipboardTool,
    ClearClipboardTool,
    AddToClipboardTool,
    RemoveFromClipboardTool
  ] as const;

  static getDefinitions(): BrowserToolMCPMetadata[] {
    const dummyCtx = {} as BrowserToolContext;
    return this.toolClasses.map(C => new C(dummyCtx).toMCPTool());
  }

  static createTools(ctx: BrowserToolContext): BaseBrowserTool[] {
    return this.toolClasses.map(C => new C(ctx));
  }
}

export type BrowserToolClass = (typeof BrowserToolsRegistry.toolClasses)[number];

export { BaseBrowserTool, type BrowserToolMCPMetadata, type BrowserToolContext } from './base-browser-tool';
