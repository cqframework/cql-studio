// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { BaseService } from './base.service';
import { SettingsService } from './settings.service';
import { IdeStateService } from './ide-state.service';
import { ConversationManagerService } from './conversation-manager.service';
import { AiPlanningService } from './ai-planning.service';
import { Plan, PlanStep } from '../models/plan.model';
import { BrowserToolsRegistry } from './tools';

// Ollama API types (structured options per https://github.com/ollama/ollama/blob/main/docs/api.md)

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaRequest {
  model: string;
  messages: OllamaMessage[];
  stream?: boolean;
  options?: {
    temperature?: number;
    top_p?: number;
  };
}

export interface OllamaResponse {
  model: string;
  created_at: string;
  message: OllamaMessage;
  done: boolean;
}

/** GET /api/tags response: list of available models */
export interface OllamaTagsResponse {
  models: Array<{ name: string; modified_at?: string; size?: number; digest?: string; details?: unknown }>;
}

/** Streaming chunk: one NDJSON line from POST /api/chat with stream: true */
export interface OllamaStreamChunk {
  message?: { role?: string; content?: string };
  done?: boolean;
}

export interface MCPTool {
  name: string;
  description: string;
  parameters: any;
}

export interface MCPRequest {
  method: string;
  params: any;
}

export interface MCPResponse {
  result?: any;
  error?: {
    code: number;
    message: string;
  };
}

@Injectable({
  providedIn: 'root'
})
export class AiService extends BaseService {
  private settingsService = inject(SettingsService);
  private ideStateService = inject(IdeStateService);
  private conversationManager = inject(ConversationManagerService);
  private planningService = inject(AiPlanningService);

  /** Cached server MCP tools; populated by reinitializeServerMCPTools() when Server MCP is enabled. */
  private serverMCPToolsCache: MCPTool[] | null = null;

  /**
   * Check if AI assistant is available (Ollama configured and enabled)
   */
  isAiAssistantAvailable(): boolean {
    return !!(this.settingsService.getEffectiveOllamaBaseUrl() &&
      this.settingsService.settings().enableAiAssistant);
  }

  /**
   * Test Ollama connection and model availability
   */
  testOllamaConnection(): Observable<{ connected: boolean, models: string[], error?: string }> {
    const ollamaUrl = this.settingsService.getEffectiveOllamaBaseUrl();
    if (!ollamaUrl) {
      return throwError(() => new Error('Ollama base URL not configured'));
    }

    return this.http.get<OllamaTagsResponse>(`${ollamaUrl}/api/tags`, {
      headers: this.getOllamaHeaders(),
      timeout: 10000 // 10 second timeout for connection test
    }).pipe(
      map(response => ({
        connected: true,
        models: response.models.map(m => m.name).filter((name): name is string => !!name)
      })),
      catchError(error => {
        console.error('Ollama connection test failed:', error);
        return throwError(() => new Error(`Connection test failed: ${error.message || 'Unknown error'}`));
      })
    );
  }

  /**
   * Send a context-aware message to Ollama
   * Uses ConversationManagerService for conversation management
   */
  sendContextAwareMessage(
    message: string,
    useMCPTools: boolean = true,
    cqlContent?: string
  ): Observable<OllamaResponse> {
    const editorContext = this.conversationManager.getCurrentEditorContext();
    const editorId = editorContext?.editorId;
    return this.sendMessage(message, editorId, useMCPTools, cqlContent);
  }

  /**
   * Send a message to Ollama with optional MCP tool integration
   * Uses ConversationManagerService for conversation management
   */
  sendMessage(
    message: string,
    editorId?: string,
    useMCPTools: boolean = true,
    cqlContent?: string
  ): Observable<OllamaResponse> {
    const ollamaUrl = this.settingsService.getEffectiveOllamaBaseUrl();
    if (!ollamaUrl || !this.settingsService.settings().enableAiAssistant) {
      return throwError(() => new Error('AI Assistant is not enabled or Ollama base URL not configured'));
    }

    const model = this.settingsService.getEffectiveOllamaModel();

    // Get or create conversation for editor
    const editorContext = editorId
      ? this.conversationManager.getEditorContextFromId(editorId)
      : this.conversationManager.getCurrentEditorContext();

    if (!editorContext) {
      return throwError(() => new Error('No editor context available'));
    }

    const conversation = this.conversationManager.getOrCreateActiveConversation();
    this.conversationManager.addUserMessage(conversation.id, message);

    // Get API messages for LLM request
    const apiMessages = this.conversationManager.getApiMessages(conversation.id);

    const hasEditorContext = editorContext.editorId !== ConversationManagerService.NO_EDITOR_CONTEXT_ID;
    const systemMessage = this.buildSystemMessage(editorContext.editorType, useMCPTools, cqlContent, 'act', false, hasEditorContext);

    const request: OllamaRequest = {
      model: model,
      messages: [systemMessage, ...apiMessages],
      stream: false,
      options: {
        temperature: 0.7,
        top_p: 0.9
      }
    };

    return this.http.post<OllamaResponse>(`${ollamaUrl}/api/chat`, request, {
      headers: this.getOllamaHeaders(),
      timeout: 120000 // 2 minute timeout
    }).pipe(
      map(response => {
        // Add assistant response to conversation
        this.conversationManager.addAssistantMessage(conversation!.id, response.message.content);
        this.conversationManager.updateConversationTitleFromUserMessage(conversation!.id, message);
        return response;
      }),
      catchError(this.handleError)
    );
  }

  /**
   * Send a context-aware streaming message to Ollama
   */
  sendContextAwareStreamingMessage(
    message: string,
    useMCPTools: boolean = true,
    cqlContent?: string
  ): Observable<{ type: 'start' | 'chunk' | 'end', content?: string, fullResponse?: string }> {
    const editorContext = this.conversationManager.getCurrentEditorContext();
    const editorId = editorContext?.editorId;
    return this.sendStreamingMessage(message, editorId, useMCPTools, cqlContent);
  }

  /**
   * Send a streaming message to Ollama with optional MCP tool integration
   * Uses ConversationManagerService for conversation management
   * @param toolResultsSummary Optional tool results to append to last message for AI context (never saved)
   */
  sendStreamingMessage(
    message: string,
    editorId?: string,
    useMCPTools: boolean = true,
    cqlContent?: string,
    toolResultsSummary?: string,
    mode?: 'plan' | 'act'
  ): Observable<{ type: 'start' | 'chunk' | 'end', content?: string, fullResponse?: string }> {
    const ollamaUrl = this.settingsService.getEffectiveOllamaBaseUrl();

    if (!ollamaUrl || !this.settingsService.settings().enableAiAssistant) {
      return throwError(() => new Error('AI Assistant is not enabled or Ollama base URL not configured'));
    }

    const model = this.settingsService.getEffectiveOllamaModel();

    // Get or create conversation for editor
    const editorContext = editorId
      ? this.conversationManager.getEditorContextFromId(editorId)
      : this.conversationManager.getCurrentEditorContext();

    if (!editorContext) {
      return throwError(() => new Error('No editor context available'));
    }

    let conversation = this.conversationManager.getOrCreateActiveConversation();
    if (message && message.trim().length > 0) {
      this.conversationManager.addUserMessage(conversation.id, message);
    }
    if (mode && conversation.mode !== mode) {
      this.conversationManager.updateConversationMode(conversation.id, mode);
      const updated = this.conversationManager.activeConversation();
      if (updated?.id === conversation.id) {
        conversation = updated;
      }
    }

    // Get API messages for LLM request
    let apiMessages = this.conversationManager.getApiMessages(conversation.id);

    // Append tool results to last assistant message if provided (in-memory only, never saved)
    if (toolResultsSummary) {
      const lastMessage = apiMessages[apiMessages.length - 1];
      if (lastMessage && lastMessage.role === 'assistant') {
        // Clone messages array and append tool results to last message (in-memory only)
        apiMessages = [...apiMessages];
        const conversationMode = mode || conversation.mode || 'act';

        // In plan mode, explicitly instruct to create a plan after tool execution
        let toolResultsText = `\n\n**Tool Execution Results:**\n${toolResultsSummary}`;
        if (conversationMode === 'plan' && !message) {
          // Continuation mode in plan - explicitly request plan creation
          toolResultsText += `\n\nBased on these tool execution results, create a structured plan in JSON format. The plan should outline the steps needed to accomplish the user's request. Include the plan JSON in your response.`;
        }

        apiMessages[apiMessages.length - 1] = {
          ...lastMessage,
          content: lastMessage.content + toolResultsText
        };
      }
    }

    // Get mode from conversation or parameter
    const conversationMode = mode || conversation.mode || 'act';

    // Check if there are plan messages in conversation (for Act Mode reference)
    // A plan exists if we're in Act Mode and there are assistant messages from when we were in Plan Mode
    const hasPlanMessages = conversationMode === 'act' && conversation.apiMessages.some(msg =>
      msg.role === 'assistant' && msg.content && msg.content.length > 0
    );

    const hasEditorContext = editorContext.editorId !== ConversationManagerService.NO_EDITOR_CONTEXT_ID;
    const systemMessage = this.buildSystemMessage(editorContext.editorType, useMCPTools, cqlContent, conversationMode, hasPlanMessages, hasEditorContext);

    const request: OllamaRequest = {
      model: model,
      messages: [systemMessage, ...apiMessages],
      stream: true,
      options: {
        temperature: 0.7,
        top_p: 0.9
      }
    };

    return new Observable(observer => {
      let fullResponse = '';
      const conversationId = conversation.id;

      // Emit start event
      observer.next({ type: 'start' });

      fetch(`${ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(request)
      }).then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('No response body reader available');
        }

        const decoder = new TextDecoder();
        let buffer = '';

        const readChunk = (): Promise<void> => {
          return reader.read().then(({ done, value }) => {
            if (done) {
              // Mark streaming as complete (component will add the final cleaned message)
              this.conversationManager.completeStreaming(conversationId);
              this.conversationManager.updateConversationTitleFromUserMessage(conversationId, message);
              observer.next({ type: 'end', fullResponse });
              observer.complete();
              return;
            }

            // Decode the chunk
            buffer += decoder.decode(value, { stream: true });

            // Process complete lines
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer

            for (const line of lines) {
              if (line.trim()) {
                try {
                  const data = JSON.parse(line) as OllamaStreamChunk;
                  if (data.message && data.message.content) {
                    const content = data.message.content;
                    fullResponse += content;

                    // Don't update conversation message during streaming - only update when complete
                    // This prevents duplicate display (conversation message vs streaming response)
                    // Component will handle updating the conversation when streaming ends

                    observer.next({ type: 'chunk', content });
                  }
                } catch (e) {
                  // Skip invalid JSON lines
                }
              }
            }

            return readChunk();
          });
        };

        return readChunk();
      }).catch(error => {
        let errorMessage = 'Failed to connect to Ollama server';

        if (error instanceof TypeError && error.message === 'Failed to fetch') {
          errorMessage = 'Unable to connect to Ollama server. Please check:\n' +
            '- The Ollama server URL is correct\n' +
            '- The Ollama server is running\n' +
            '- There are no network connectivity issues\n' +
            '- CORS is properly configured (if accessing from a browser)';
        } else if (error instanceof TypeError) {
          errorMessage = `Network error: ${error.message}`;
        } else if (error.message) {
          errorMessage = error.message;
        }

        observer.error(new Error(errorMessage));
      });
    });
  }

  /**
   * Get cached server MCP tools (populated by reinitializeServerMCPTools when Server MCP is enabled).
   */
  getCachedServerMCPTools(): MCPTool[] {
    return this.serverMCPToolsCache ?? [];
  }

  /**
   * Reinitialize server MCP tools by querying the CQL Studio Server. Call when Server MCP is enabled
   * and server URL is configured. Populates the cache used by getMCPTools() and buildSystemMessage.
   */
  reinitializeServerMCPTools(): Observable<{ success: boolean; count?: number; error?: string }> {
    const mcpUrl = this.settingsService.getEffectiveServerBaseUrl();
    const useMCP = this.settingsService.settings().useMCPTools;
    if (!mcpUrl || !useMCP) {
      this.serverMCPToolsCache = null;
      return of({
        success: false,
        error: !mcpUrl ? 'CQL Studio Server URL not configured.' : 'Server MCP tools are disabled in settings.'
      });
    }
    return this.http.get<MCPTool[]>(`${mcpUrl}/tools`, {
      headers: this.getMCPHeaders()
    }).pipe(
      map(tools => {
        this.serverMCPToolsCache = Array.isArray(tools) ? tools : [];
        return { success: true, count: this.serverMCPToolsCache.length };
      }),
      catchError(err => {
        this.serverMCPToolsCache = null;
        const message = err?.error?.message ?? err?.message ?? 'Request failed';
        return of({ success: false, error: message });
      })
    );
  }

  /**
   * Get available MCP tools (cached server tools only; browser tools are defined in the app).
   */
  getMCPTools(): Observable<MCPTool[]> {
    return of(this.getCachedServerMCPTools());
  }

  /**
   * Execute an MCP tool
   */
  executeMCPTool(toolName: string, parameters: any): Observable<MCPResponse> {
    const mcpUrl = this.settingsService.getEffectiveServerBaseUrl();
    if (!mcpUrl) {
      return throwError(() => new Error('MCP base URL not configured'));
    }

    // Inject client-side config for tools that require it
    const params = { ...parameters };
    if (toolName === 'searxng_search') {
      const searxngBaseUrl = this.settingsService.getEffectiveSearxngBaseUrl();
      params['searxng_base_url'] = searxngBaseUrl || '';
    }

    const request: MCPRequest = {
      method: toolName,
      params: params
    };

    return this.http.post<MCPResponse>(`${mcpUrl}/execute`, request, {
      headers: this.getMCPHeaders()
    }).pipe(
      catchError(this.handleError)
    );
  }

  /**
   * Get FHIR data through MCP server
   */
  getFhirData(resourceType: string, id?: string, query?: any): Observable<any> {
    const mcpUrl = this.settingsService.getEffectiveServerBaseUrl();
    if (!mcpUrl) {
      return throwError(() => new Error('MCP base URL not configured'));
    }

    const params = {
      resourceType,
      id,
      query
    };

    return this.http.post<any>(`${mcpUrl}/fhir`, params, {
      headers: this.getMCPHeaders()
    }).pipe(
      catchError(this.handleError)
    );
  }

  /**
   * Generate suggested AI commands based on CQL content
   */
  generateSuggestedCommands(cqlContent: string): Observable<string[]> {
    const ollamaUrl = this.settingsService.getEffectiveOllamaBaseUrl();

    if (!ollamaUrl || !this.settingsService.settings().enableAiAssistant) {
      return throwError(() => new Error('AI Assistant is not enabled or Ollama base URL not configured'));
    }

    const model = this.settingsService.getEffectiveOllamaModel();

    const systemMessage: OllamaMessage = {
      role: 'system',
      content: `You are an AI assistant that generates helpful suggestions and code for CQL developers. Based on the provided CQL content, generate 3-5 specific, actionable commands that a developer might want to ask an AI assistant about their CQL code.

IMPORTANT: Return ONLY a valid JSON array of strings. Do not include any markdown formatting, code blocks, or explanations. Just return the raw JSON array.

Example format:
["Review this CQL code for best practices", "Explain the logic in this CQL expression", "Help me debug any syntax errors", "Suggest improvements for performance", "Generate test cases for this CQL"]

Focus on practical, specific commands that would be immediately useful to someone working with the provided CQL code.`
    };

    const userMessage: OllamaMessage = {
      role: 'user',
      content: `Based on this CQL code, suggest 3-5 helpful commands I could ask an AI assistant:

\`\`\`cql
${cqlContent}
\`\`\``
    };

    const request: OllamaRequest = {
      model: model,
      messages: [systemMessage, userMessage],
      stream: false,
      options: {
        temperature: 0.3,
        top_p: 0.8
      }
    };

    return this.http.post<OllamaResponse>(`${ollamaUrl}/api/chat`, request, {
      headers: this.getOllamaHeaders(),
      timeout: 30000 // 30 second timeout for command generation
    }).pipe(
      map(response => {
        try {
          // Clean the response content by removing markdown code blocks
          let content = response.message.content;

          // Remove markdown code block formatting
          content = content.replace(/```json\s*/g, '').replace(/```\s*/g, '');

          // Trim whitespace
          content = content.trim();

          // Parse the JSON response
          const commands = JSON.parse(content);
          if (Array.isArray(commands) && commands.length > 0) {
            return commands.slice(0, 5); // Limit to 5 commands
          }
          return [];
        } catch (error) {
          console.warn('Failed to parse suggested commands:', error);
          console.warn('Raw response content:', response.message.content);
          return [];
        }
      }),
      catchError(this.handleError)
    );
  }

  /**
   * Switch to a different editor context (delegates to ConversationManagerService)
   */
  switchToEditorContext(editorId: string): string | null {
    const conversation = this.conversationManager.switchToEditor(editorId);
    return conversation?.id || null;
  }

  /**
   * Get conversations (delegates to ConversationManagerService)
   * For backwards compatibility
   */
  getConversations() {
    return this.conversationManager.getAllConversations();
  }

  /**
   * Get a specific conversation (delegates to ConversationManagerService)
   * For backwards compatibility
   */
  getConversation(id: string) {
    const all = this.conversationManager.getAllConversations();
    return all.find(c => c.id === id) || null;
  }

  /**
   * Delete a conversation (delegates to ConversationManagerService)
   */
  deleteConversation(id: string): void {
    this.conversationManager.deleteConversation(id);
  }

  /**
   * Clear all conversations (delegates to ConversationManagerService)
   */
  clearAllConversations(): void {
    this.conversationManager.clearAllConversations();
  }

  /**
   * Get the most relevant conversation (the one the user has selected).
   */
  getRelevantConversation(): string | null {
    const conversation = this.conversationManager.activeConversation();
    return conversation?.id || null;
  }

  /**
   * Sanitize message content - delegates to ConversationManagerService
   * Also removes plan JSON blocks
   */
  public sanitizeMessageContent(content: string): string {
    if (!content) {
      return content;
    }

    // Remove JSON plan blocks
    let sanitized = content.replace(/```(?:json)?\s*\{[\s\S]*?"plan"[\s\S]*?\}\s*```/g, '');

    // Remove standalone plan JSON
    sanitized = sanitized.replace(/\{\s*"plan"\s*:\s*\{[\s\S]*?\}\s*\}/g, '');

    // Delegate to ConversationManagerService for consistent sanitization
    // This ensures tool results are removed from all displayed messages
    sanitized = this.conversationManager.sanitizeContentForDisplay(sanitized);

    return sanitized;
  }

  /**
   * Add assistant message to conversation (delegates to ConversationManagerService)
   * For backwards compatibility
   */
  addAssistantMessage(conversationId: string, content: string): boolean {
    this.conversationManager.addAssistantMessage(conversationId, content);
    return true;
  }

  /**
   * Append tool results - now handled in sendStreamingMessage
   * For backwards compatibility
   */
  appendToolResults(conversationId: string, toolResultsSummary: string): boolean {
    // Tool results are now appended in-memory in sendStreamingMessage
    // This method is kept for backwards compatibility but does nothing
    return true;
  }

  private buildSystemMessage(editorType: 'cql' | 'fhir' | 'general', useMCPTools: boolean, cqlContent?: string, mode: 'plan' | 'act' = 'act', hasPlan: boolean = false, hasEditorContext: boolean = true): OllamaMessage {
    let systemContent = `You are an AI assistant specialized in CQL (Clinical Quality Language) development. You can help with writing/debugging CQL, FHIR resources, syntax, best practices, and library structure.

**VALID CQL AND FHIR ONLY:** Use only official CQL (HL7) and FHIR R4 syntax and resources. Do not invent syntax or fabricate resource types. When uncertain, use web/search tools (if available) to find official documentation.`;

    if (hasEditorContext) {
      systemContent += `\n\n**Current context:** The user has a CQL library or file open. Use get_code, insert_code, replace_code, format_code as needed to read and edit their code.`;
    } else {
      systemContent += `\n\n**Current context:** No editor is open. Use create_library to start a new library, or list_libraries / get_library_content / search_code if the user has existing libraries. For general CQL/FHIR questions you may answer or use web search tools if available.`;
    }

    if (cqlContent && cqlContent.trim()) {
      systemContent += `

Current CQL file content:
\`\`\`
${cqlContent}
\`\`\`
Use this context when helping improve, debug, or extend the code.`;
    }

    if (useMCPTools) {
      systemContent += `

**Response format:** One brief sentence, then a newline, then tool call JSON on its own line. Example:
Reading current code.
{"tool": "get_code", "params": {}}
Always call a tool first; do not answer directly until you have results. Put each tool call on its own line.`;

      if (hasEditorContext) {
        systemContent += `

**Code editing (editor is open):** For add/fix/improve/modify code, call get_code first, then insert_code or replace_code with the actual code in the "code" parameter (required, non-empty string). Do not just show code—use the tools to edit the editor. replace_code can take startLine/endLine.`;
      }

      systemContent += `

**Search rate limiting:** If server tools (searxng_search, web_search, fetch_url) exist, use one search per turn when possible; prefer get_code/search_code for in-editor content.`
        + this.formatBrowserToolsForSystemPrompt(BrowserToolsRegistry.getDefinitions() as MCPTool[])
        + `

**Tool selection:** Code question → get_code. "Where is X" → search_code. Add/create code → get_code then insert_code. Fix/improve code → get_code then replace_code. Format → format_code. New library → create_library. Documentation/URLs → server web/search tools if listed below.`
        + this.formatServerToolsForSystemPrompt(this.getCachedServerMCPTools());
    }

    // Add mode-specific prompts
    if (mode === 'plan') {
      systemContent += '\n\n' + this.planningService.getPlanModeSystemPrompt();
    } else {
      systemContent += '\n\n' + this.planningService.getActModeSystemPrompt(hasPlan);

      // In Act Mode, if there was a plan, emphasize following it
      if (hasPlan) {
        systemContent += '\n\n**IMPORTANT:** Review the plan from previous messages and execute the agreed-upon steps.';
      }
    }

    return {
      role: 'system',
      content: systemContent
    };
  }


  private formatBrowserToolsForSystemPrompt(tools: MCPTool[]): string {
    if (!tools.length) return '';
    let out = '\n\n### BROWSER TOOLS (internal – always available)\n\n';
    tools.forEach((t, i) => {
      const exampleParams = this.buildExampleParamsForTool(t);
      const paramsJson = JSON.stringify(exampleParams);
      out += `${i + 1}. **${t.name}** - ${t.description || 'No description'}\n`;
      out += `   Format: {"tool": "${t.name}", "params": ${paramsJson}}\n`;
      out += `   Example: {"tool": "${t.name}", "params": ${paramsJson}}\n`;
      out += '\n';
    });
    return out;
  }

  private buildExampleParamsForTool(tool: MCPTool): Record<string, unknown> {
    const params: Record<string, unknown> = {};
    const schema = tool.parameters;
    if (!schema || typeof schema !== 'object') return params;
    const props = schema.properties ?? {};
    const required: string[] = Array.isArray(schema.required) ? schema.required : [];
    const keys = required.length ? required : Object.keys(props);
    for (const k of keys) {
      const prop = props[k];
      const type = prop?.type;
      if (type === 'number') params[k] = k === 'line' ? 10 : 0;
      else if (type === 'string') {
        if (k === 'code') params[k] = 'define function Example()\n  return true';
        else if (k === 'query') params[k] = 'search text';
        else if (k === 'libraryId') params[k] = 'library-id';
        else params[k] = 'value';
      } else params[k] = 'value';
    }
    return params;
  }

  private formatServerToolsForSystemPrompt(tools: MCPTool[]): string {
    if (!tools.length) return '';
    let out = '\n\n### SERVER MCP TOOLS (from CQL Studio Server)\n\n';
    tools.forEach((t, i) => {
      out += `${i + 1}. **${t.name}** - ${t.description || 'No description'}\n`;
      if (t.parameters && typeof t.parameters === 'object') {
        const params = t.parameters.properties ?? t.parameters;
        const keys = Object.keys(params);
        if (keys.length) {
          out += `   Format: {"tool": "${t.name}", "params": {${keys.map(k => `"${k}": <value>`).join(', ')}}}\n`;
        }
      }
      out += '\n';
    });
    return out;
  }

  private getOllamaHeaders(): HttpHeaders {
    return new HttpHeaders({
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    });
  }

  private getMCPHeaders(): HttpHeaders {
    return new HttpHeaders({
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    });
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  private generateTitle(firstMessage: string): string {
    const words = firstMessage.split(' ').slice(0, 5);
    return words.join(' ') + (firstMessage.split(' ').length > 5 ? '...' : '');
  }

  /**
   * Parse plan from AI response text
   * Looks for JSON plan structure in markdown code blocks or inline JSON
   */
  parsePlan(responseText: string): Plan | null {
    if (!responseText || responseText.trim().length === 0) {
      return null;
    }

    // Try to find JSON plan in markdown code blocks
    const jsonBlockRegex = /```(?:json)?\s*(\{[\s\S]*?"plan"[\s\S]*?\})\s*```/g;
    let match = jsonBlockRegex.exec(responseText);

    if (match) {
      try {
        const jsonStr = match[1];
        const parsed = JSON.parse(jsonStr);
        if (parsed.plan && parsed.plan.steps && Array.isArray(parsed.plan.steps)) {
          return this.createPlanFromParsed(parsed.plan);
        }
      } catch (e) {
        console.warn('[AI Service] Failed to parse plan from JSON block:', e);
      }
    }

    // Try to find standalone JSON plan object
    const standalonePlanRegex = /\{\s*"plan"\s*:\s*\{[\s\S]*?\}\s*\}/g;
    let execMatch: RegExpExecArray | null = null;
    while ((execMatch = standalonePlanRegex.exec(responseText)) !== null) {
      try {
        const parsed = JSON.parse(execMatch[0]);
        if (parsed.plan && parsed.plan.steps && Array.isArray(parsed.plan.steps)) {
          return this.createPlanFromParsed(parsed.plan);
        }
      } catch (e) {
        console.warn('[AI Service] Failed to parse standalone plan JSON:', e);
      }
    }

    return null;
  }

  /**
   * Create Plan object from parsed plan data
   */
  private createPlanFromParsed(planData: any): Plan {
    const steps: PlanStep[] = [];

    // Limit to 12 steps as required
    const limitedSteps = planData.steps.slice(0, 12);

    limitedSteps.forEach((stepData: any, index: number) => {
      steps.push({
        id: `step_${Date.now()}_${index}`,
        number: stepData.number || (index + 1),
        description: stepData.description || '',
        status: 'pending'
      });
    });

    return {
      id: `plan_${Date.now()}`,
      description: planData.description || '',
      steps,
      createdAt: new Date()
    };
  }


  private handleError = (error: any): Observable<never> => {
    console.error('AI Service Error:', error);
    let errorMessage = 'An unknown error occurred';

    if (error.error instanceof ErrorEvent) {
      errorMessage = `Client Error: ${error.error.message}`;
    } else if (error.name === 'TimeoutError' || error.message?.includes('timeout')) {
      errorMessage = 'Request timeout: The Ollama server is taking too long to respond. The model might be loading or the server is under heavy load.';
    } else if (error.status === 0) {
      errorMessage = 'Network Error: Unable to connect to the Ollama server. Please check the server URL and ensure it\'s running.';
    } else if (error.status === 404) {
      errorMessage = 'Ollama server not found. Please check the server URL.';
    } else if (error.status === 500) {
      errorMessage = 'Ollama server error. The model might not be available or there\'s a server issue.';
    } else if (error.status >= 400) {
      errorMessage = `Server Error: ${error.status} - ${error.statusText}`;
    } else if (error.error && error.error.message) {
      errorMessage = error.error.message;
    }

    return throwError(() => new Error(errorMessage));
  };
}
