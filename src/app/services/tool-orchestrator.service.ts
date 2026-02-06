// Author: Preston Lee

import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { AiService, MCPTool, MCPResponse } from './ai.service';
import { IdeStateService } from './ide-state.service';
import { SettingsService } from './settings.service';
import { ClipboardService } from './clipboard.service';
import { BrowserToolsRegistry } from './tools';

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
  private readonly browserTools: ReturnType<typeof BrowserToolsRegistry.createTools>;

  constructor(
    private aiService: AiService,
    private ideStateService: IdeStateService,
    private settingsService: SettingsService,
    private clipboardService: ClipboardService
  ) {
    this.browserTools = BrowserToolsRegistry.createTools({
      ideStateService: this.ideStateService,
      settingsService: this.settingsService,
      clipboardService: this.clipboardService
    });
  }

  private get browserToolsByName(): Map<string, (typeof this.browserTools)[number]> {
    const map = new Map<string, (typeof this.browserTools)[number]>();
    this.browserTools.forEach(t => map.set(t.name, t));
    return map;
  }

  isBrowserNativeTool(toolName: string): boolean {
    return this.browserToolsByName.has(toolName);
  }

  getAvailableTools(): Observable<MCPTool[]> {
    const definitions = BrowserToolsRegistry.getDefinitions() as MCPTool[];
    return this.aiService.getMCPTools().pipe(
      map(serverTools => [...definitions, ...serverTools]),
      catchError(() => of([...definitions]))
    );
  }

  executeToolCall(toolName: string, params: any): Observable<ToolResult> {
    if (this.isBrowserNativeTool(toolName)) {
      return of(this.executeBrowserTool(toolName, params));
    }
    return this.executeServerTool(toolName, params);
  }

  private executeBrowserTool(toolName: string, params: any): ToolResult {
    const tool = this.browserToolsByName.get(toolName);
    if (!tool) {
      return {
        tool: toolName,
        success: false,
        error: `Unknown browser-native tool: ${toolName}`
      };
    }
    try {
      const result = tool.execute(params ?? {});
      return { tool: toolName, success: true, result };
    } catch (error: any) {
      return {
        tool: toolName,
        success: false,
        error: error?.message ?? 'Tool execution failed'
      };
    }
  }

  private executeServerTool(toolName: string, params: any): Observable<ToolResult> {
    return this.aiService.executeMCPTool(toolName, params).pipe(
      map((response: MCPResponse) => ({
        tool: toolName,
        success: !response.error,
        result: response.result,
        error: response.error?.message
      })),
      catchError(error =>
        of({
          tool: toolName,
          success: false,
          error: error?.message ?? 'Server tool execution failed'
        })
      )
    );
  }
}
