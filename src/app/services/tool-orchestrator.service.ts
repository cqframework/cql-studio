// Author: Preston Lee

import { Injectable } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { AiService, MCPTool, MCPResponse } from './ai.service';
import { IdeStateService } from './ide-state.service';
import { SettingsService } from './settings.service';

export interface ToolCall {
  tool: string;
  params: Record<string, any>;
}

export interface ToolResult {
  tool: string;
  success: boolean;
  result?: any;
  error?: string;
}

@Injectable({
  providedIn: 'root'
})
export class ToolOrchestratorService {
  // Browser-native tool registry
  private readonly BROWSER_NATIVE_TOOLS = new Set([
    'insert_code',
    'replace_code',
    'get_code',
    'format_code',
    'list_libraries',
    'get_library_content',
    'search_code',
    'get_cursor_position',
    'get_selection',
    'navigate_to_line',
    'create_library'
  ]);

  constructor(
    private aiService: AiService,
    private ideStateService: IdeStateService,
    private settingsService: SettingsService
  ) {}

  /**
   * Check if a tool is browser-native
   */
  isBrowserNativeTool(toolName: string): boolean {
    return this.BROWSER_NATIVE_TOOLS.has(toolName);
  }

  /**
   * Get all available tools (browser-native + server tools)
   */
  getAvailableTools(): Observable<MCPTool[]> {
    // Get server tools from MCP server
    return this.aiService.getMCPTools().pipe(
      map(serverTools => {
        // Combine with browser-native tools
        const browserTools = this.getBrowserNativeToolDefinitions();
        return [...browserTools, ...serverTools];
      }),
      catchError(error => {
        console.warn('Failed to fetch server tools, using browser tools only:', error);
        // Return only browser tools if server is unavailable
        return of(this.getBrowserNativeToolDefinitions());
      })
    );
  }

  /**
   * Execute a tool call (routes to browser or server)
   */
  executeToolCall(toolName: string, params: any): Observable<ToolResult> {
    if (this.isBrowserNativeTool(toolName)) {
      return of(this.executeBrowserTool(toolName, params));
    } else {
      return this.executeServerTool(toolName, params);
    }
  }

  /**
   * Execute a browser-native tool
   */
  private executeBrowserTool(toolName: string, params: any): ToolResult {
    try {
      let result: any;

      switch (toolName) {
        case 'get_code':
          result = this.getCode(params);
          break;
        case 'list_libraries':
          result = this.listLibraries();
          break;
        case 'get_library_content':
          result = this.getLibraryContent(params);
          break;
        case 'search_code':
          result = this.searchCode(params);
          break;
        case 'get_cursor_position':
          result = this.getCursorPosition();
          break;
        case 'get_selection':
          result = this.getSelection();
          break;
        case 'create_library':
          result = this.createLibrary(params);
          break;
        case 'format_code':
          this.ideStateService.requestFormatCode();
          result = { message: 'Code formatting requested' };
          break;
        case 'navigate_to_line':
          const lineNumber = params?.line;
          if (!lineNumber || typeof lineNumber !== 'number' || lineNumber < 1) {
            throw new Error('Line number is required and must be a positive number');
          }
          this.ideStateService.requestNavigateToLine(lineNumber);
          result = { message: `Navigation to line ${lineNumber} requested` };
          break;
        case 'insert_code':
        case 'replace_code':
          // These are handled via event chain through AI tab component
          result = { 
            message: `${toolName} requires editor access via event chain`,
            params: params
          };
          break;
        default:
          throw new Error(`Unknown browser-native tool: ${toolName}`);
      }

      return {
        tool: toolName,
        success: true,
        result
      };
    } catch (error: any) {
      return {
        tool: toolName,
        success: false,
        error: error.message || 'Tool execution failed'
      };
    }
  }

  /**
   * Execute a server tool via MCP
   */
  private executeServerTool(toolName: string, params: any): Observable<ToolResult> {
    return this.aiService.executeMCPTool(toolName, params).pipe(
      map((response: MCPResponse) => ({
        tool: toolName,
        success: !response.error,
        result: response.result,
        error: response.error?.message
      })),
      catchError(error => {
        return of({
          tool: toolName,
          success: false,
          error: error.message || 'Server tool execution failed'
        });
      })
    );
  }

  /**
   * Get browser-native tool definitions
   */
  private getBrowserNativeToolDefinitions(): MCPTool[] {
    return [
      {
        name: 'insert_code',
        description: 'Insert code at the current cursor position in the editor',
        parameters: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'Code to insert' }
          },
          required: ['code']
        }
      },
      {
        name: 'replace_code',
        description: 'Replace selected code or code at specified position',
        parameters: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'Code to insert' },
            startLine: { type: 'number', description: 'Start line number (optional)' },
            startCol: { type: 'number', description: 'Start column number (optional)' },
            endLine: { type: 'number', description: 'End line number (optional)' },
            endCol: { type: 'number', description: 'End column number (optional)' }
          },
          required: ['code']
        }
      },
      {
        name: 'get_code',
        description: 'Get current code content from the active editor',
        parameters: {
          type: 'object',
          properties: {
            libraryId: { type: 'string', description: 'Library ID (optional, uses active if not provided)' }
          }
        }
      },
      {
        name: 'format_code',
        description: 'Format the current CQL code in the editor',
        parameters: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'list_libraries',
        description: 'List all loaded CQL libraries',
        parameters: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'get_library_content',
        description: 'Get the full content of a specific library',
        parameters: {
          type: 'object',
          properties: {
            libraryId: { type: 'string', description: 'Library ID' }
          },
          required: ['libraryId']
        }
      },
      {
        name: 'search_code',
        description: 'Search for patterns in loaded CQL libraries',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query (text pattern)' },
            libraryId: { type: 'string', description: 'Library ID (optional, searches all if not provided)' }
          },
          required: ['query']
        }
      },
      {
        name: 'get_cursor_position',
        description: 'Get the current cursor position in the editor',
        parameters: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'get_selection',
        description: 'Get the currently selected code in the editor',
        parameters: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'navigate_to_line',
        description: 'Navigate the editor to a specific line number',
        parameters: {
          type: 'object',
          properties: {
            line: { type: 'number', description: 'Line number to navigate to' }
          },
          required: ['line']
        }
      },
      {
        name: 'create_library',
        description: 'Create a new empty CQL library and open it in the editor (same as clicking "Create New Library" button)',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Library name (optional, defaults to "NewLibrary")' },
            title: { type: 'string', description: 'Library title (optional, defaults to "New Library")' },
            version: { type: 'string', description: 'Library version (optional, defaults to "1.0.0")' },
            description: { type: 'string', description: 'Library description (optional, defaults to "New library")' }
          }
        }
      }
    ];
  }

  // Browser-native tool implementations

  private getCode(params: any): any {
    // Try to get library ID from params or active library
    let libraryId = params.libraryId;
    
    // If no libraryId in params, try to get active library
    if (!libraryId) {
      const activeLibrary = this.ideStateService.getActiveLibraryResource();
      if (activeLibrary) {
        libraryId = activeLibrary.id;
      } else {
        // No active library - check if any libraries exist
        const allLibraries = this.ideStateService.libraryResources();
        if (allLibraries.length === 0) {
          throw new Error('No libraries available. Please create or load a library first using create_library tool.');
        } else {
          // Use the first available library as fallback
          libraryId = allLibraries[0].id;
          console.warn(`[get_code] No active library, using first available library: ${libraryId}`);
        }
      }
    }

    if (!libraryId) {
      const allLibraries = this.ideStateService.libraryResources();
      const libraryList = allLibraries.map(l => `- ${l.name || l.id}`).join('\n');
      throw new Error(`No active library and no library specified. Available libraries:\n${libraryList}\n\nUse create_library to create a new library, or specify libraryId parameter.`);
    }

    const library = this.ideStateService.libraryResources().find(l => l.id === libraryId);
    if (!library) {
      const allLibraries = this.ideStateService.libraryResources();
      const libraryList = allLibraries.length > 0 
        ? allLibraries.map(l => `- ${l.name || l.id} (${l.id})`).join('\n')
        : 'No libraries available';
      throw new Error(`Library not found: ${libraryId}\n\nAvailable libraries:\n${libraryList}\n\nUse list_libraries tool to see all available libraries.`);
    }

    return {
      libraryId,
      libraryName: library.library?.name || library.name || 'Unknown',
      content: library.cqlContent || ''
    };
  }

  private listLibraries(): any {
    const libraries = this.ideStateService.libraryResources();
    return {
      count: libraries.length,
      libraries: libraries.map(lib => ({
        id: lib.id,
        name: lib.library?.name || 'Unnamed',
        isActive: lib.id === this.ideStateService.activeLibraryId()
      }))
    };
  }

  private getLibraryContent(params: any): any {
    const { libraryId } = params;
    if (!libraryId) {
      throw new Error('Library ID is required');
    }

    const library = this.ideStateService.libraryResources().find(l => l.id === libraryId);
    if (!library) {
      throw new Error(`Library not found: ${libraryId}`);
    }

    return {
      libraryId,
      libraryName: library.library?.name || 'Unknown',
      content: library.cqlContent || ''
    };
  }

  private searchCode(params: any): any {
    const { query, libraryId } = params;
    if (!query) {
      throw new Error('Search query is required');
    }

    const libraries = libraryId
      ? this.ideStateService.libraryResources().filter(l => l.id === libraryId)
      : this.ideStateService.libraryResources();

    const results: any[] = [];
    const searchLower = query.toLowerCase();

    libraries.forEach(library => {
      const content = library.cqlContent || '';
      const lines = content.split('\n');
      
      lines.forEach((line, index) => {
        if (line.toLowerCase().includes(searchLower)) {
          results.push({
            libraryId: library.id,
            libraryName: library.library?.name || 'Unknown',
            line: index + 1,
            content: line.trim()
          });
        }
      });
    });

    return {
      query,
      resultsCount: results.length,
      results: results.slice(0, 50) // Limit to 50 results
    };
  }

  private getCursorPosition(): any {
    const editorState = this.ideStateService.editorState();
    return {
      cursorPosition: editorState.cursorPosition || null,
      hasCursor: !!editorState.cursorPosition
    };
  }

  private getSelection(): any {
    // Selection is typically managed by editor component
    // This returns state information, actual selection requires editor access
    return {
      message: 'Selection requires editor component access via event chain',
      hasSelection: false
    };
  }

  private createLibrary(params: any): any {
    const requestedName = params.name || 'NewLibrary';
    const requestedTitle = params.title || 'New Library';
    const requestedVersion = params.version || '1.0.0';
    
    // Check if a library with the same name already exists
    const existingLibraries = this.ideStateService.libraryResources();
    const existingLibrary = existingLibraries.find(lib => 
      lib.name === requestedName || 
      lib.library?.name === requestedName ||
      (lib.title === requestedTitle && lib.version === requestedVersion)
    );
    
    if (existingLibrary) {
      console.log(`[createLibrary] Library "${requestedName}" already exists, selecting existing library instead`);
      this.ideStateService.selectLibraryResource(existingLibrary.id);
      return {
        libraryId: existingLibrary.id,
        name: existingLibrary.name || existingLibrary.library?.name || requestedName,
        title: existingLibrary.library?.title || existingLibrary.title || requestedTitle,
        version: existingLibrary.version || requestedVersion,
        message: `Library "${requestedName}" already exists, opened existing library instead of creating duplicate`,
        existing: true
      };
    }
    
    // Create new library with unique ID
    const newId = `new-library-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const effectiveFhirBaseUrl = this.settingsService.getEffectiveFhirBaseUrl();
    const canonicalUrl = `${effectiveFhirBaseUrl}/Library/${newId}`;
    
    const libraryResource = {
      id: newId,
      name: requestedName,
      title: requestedTitle,
      version: requestedVersion,
      description: params.description || 'New library',
      url: canonicalUrl,
      cqlContent: '',
      originalContent: '',
      isActive: false,
      isDirty: false,
      library: null
    };
    
    console.log(`[createLibrary] Creating new library: ${requestedName} (${newId})`);
    this.ideStateService.addLibraryResource(libraryResource);
    this.ideStateService.selectLibraryResource(newId);
    
    return {
      libraryId: newId,
      name: libraryResource.name,
      title: libraryResource.title,
      version: libraryResource.version,
      message: 'Library created and opened in editor',
      existing: false
    };
  }
}

