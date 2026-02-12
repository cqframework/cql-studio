// Author: Preston Lee

import { CreateLibraryTool } from './tools/create-library.tool';
import { FormatCodeTool } from './tools/format-code.tool';
import { GetCodeTool } from './tools/get-code.tool';
import { GetCursorPositionTool } from './tools/get-cursor-position.tool';
import { GetLibraryContentTool } from './tools/get-library-content.tool';
import { GetSelectionTool } from './tools/get-selection.tool';
import { InsertCodeTool } from './tools/insert-code.tool';
import { ListLibrariesTool } from './tools/list-libraries.tool';
import { NavigateToLineTool } from './tools/navigate-to-line.tool';
import { ReplaceCodeTool } from './tools/replace-code.tool';
import { SearchCodeTool } from './tools/search-code.tool';

/**
 * Tools allowed in Plan Mode (read-only investigation).
 * Includes MCP server tools (read_file, list_files, etc.) by name; those lack types in this codebase.
 */
export const PLAN_MODE_ALLOWED_TOOLS = new Set<string>([
  GetCodeTool.id,
  ListLibrariesTool.id,
  GetLibraryContentTool.id,
  SearchCodeTool.id,
  GetCursorPositionTool.id,
  GetSelectionTool.id,
  'read_file',
  'list_files',
  'web_search',
  'searxng_search',
  'fetch_url'
]);

/**
 * Tools blocked in Plan Mode (modification tools).
 * Includes MCP server tools by name.
 */
export const PLAN_MODE_BLOCKED_TOOLS = new Set<string>([
  InsertCodeTool.id,
  ReplaceCodeTool.id,
  CreateLibraryTool.id,
  'delete_file',
  'write_file',
  'edit_file'
]);

/**
 * User-facing status messages for tool execution
 */
export const TOOL_STATUS_MESSAGES: Record<string, string> = {
  [GetCodeTool.id]: 'Reading code...',
  [InsertCodeTool.id]: 'Inserting code...',
  [ReplaceCodeTool.id]: 'Updating code...',
  [FormatCodeTool.id]: 'Formatting code...',
  [ListLibrariesTool.id]: 'Listing libraries...',
  [GetLibraryContentTool.id]: 'Loading library...',
  [SearchCodeTool.id]: 'Searching code...',
  [CreateLibraryTool.id]: 'Creating library...',
  [GetCursorPositionTool.id]: 'Getting cursor position...',
  [GetSelectionTool.id]: 'Getting selection...',
  [NavigateToLineTool.id]: 'Navigating...'
};
