// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { BaseService } from './base.service';
import { SettingsService } from './settings.service';
import { IdeStateService } from './ide-state.service';
import { ConversationManagerService } from './conversation-manager.service';
import { AiPlanningService } from './ai-planning.service';
import { Plan, PlanStep } from '../models/plan.model';

// Ollama API types (based on official Ollama API)
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
  testOllamaConnection(): Observable<{connected: boolean, models: string[], error?: string}> {
    const ollamaUrl = this.settingsService.getEffectiveOllamaBaseUrl();
    if (!ollamaUrl) {
      return throwError(() => new Error('Ollama base URL not configured'));
    }

    return this.http.get<{models: any[]}>(`${ollamaUrl}/api/tags`, {
      headers: this.getOllamaHeaders(),
      timeout: 10000 // 10 second timeout for connection test
    }).pipe(
      map(response => ({
        connected: true,
        models: response.models.map(m => m.name)
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
    
    let conversation = this.conversationManager.getActiveConversation(editorContext.editorId);
    if (!conversation) {
      conversation = this.conversationManager.createConversationForEditor(
        editorContext.editorId,
        editorContext.editorType,
        message,
        editorContext.libraryName,
        editorContext.fileName
      );
    } else {
      // Add user message to existing conversation
      this.conversationManager.addUserMessage(conversation.id, message);
    }

    // Get API messages for LLM request
    const apiMessages = this.conversationManager.getApiMessages(conversation.id);

    // Prepare system message with context
    const systemMessage = this.buildSystemMessage(conversation.editorType, useMCPTools, cqlContent);

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
  ): Observable<{type: 'start' | 'chunk' | 'end', content?: string, fullResponse?: string}> {
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
  ): Observable<{type: 'start' | 'chunk' | 'end', content?: string, fullResponse?: string}> {
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
    
    let conversation = this.conversationManager.getActiveConversation(editorContext.editorId);
    if (!conversation) {
      // Can't create a new conversation with empty message
      if (!message || message.trim().length === 0) {
        return throwError(() => new Error('Cannot create new conversation with empty message'));
      }
      // Get mode from parameter or default (will be set on conversation creation)
      const conversationMode = mode || this.settingsService.settings().defaultMode || 'plan';
      conversation = this.conversationManager.createConversationForEditor(
        editorContext.editorId,
        editorContext.editorType,
        message,
        editorContext.libraryName,
        editorContext.fileName,
        conversationMode
      );
    } else {
      // Add user message to existing conversation (only if message is not empty)
      // Empty message indicates continuation mode (Cline pattern: after tool execution)
      if (message && message.trim().length > 0) {
        this.conversationManager.addUserMessage(conversation.id, message);
      }
      
      // Ensure conversation mode matches the provided mode parameter if explicitly provided
      // This fixes cases where the conversation mode might have been lost or incorrectly set
      if (mode && conversation.mode !== mode) {
        this.conversationManager.updateConversationMode(conversation.id, mode);
        // Reload conversation to get updated mode
        conversation = this.conversationManager.getActiveConversation(editorContext.editorId);
        if (!conversation) {
          return throwError(() => new Error('Failed to reload conversation after mode update'));
        }
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
        const conversationMode = mode || conversation.mode || 'plan';
        
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
    const conversationMode = mode || conversation.mode || 'plan';
    
    // Check if there are plan messages in conversation (for Act Mode reference)
    // A plan exists if we're in Act Mode and there are assistant messages from when we were in Plan Mode
    const hasPlanMessages = conversationMode === 'act' && conversation.apiMessages.some(msg => 
      msg.role === 'assistant' && msg.content && msg.content.length > 0
    );
    
    // Prepare system message with context
    const systemMessage = this.buildSystemMessage(editorContext.editorType, useMCPTools, cqlContent, conversationMode, hasPlanMessages);

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
                  const data = JSON.parse(line);
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
   * Get available MCP tools
   */
  getMCPTools(): Observable<MCPTool[]> {
    const mcpUrl = this.settingsService.getEffectiveServerBaseUrl();
    if (!mcpUrl) {
      return throwError(() => new Error('MCP base URL not configured'));
    }

    return this.http.get<MCPTool[]>(`${mcpUrl}/tools`, {
      headers: this.getMCPHeaders()
    }).pipe(
      catchError(this.handleError)
    );
  }

  /**
   * Execute an MCP tool
   */
  executeMCPTool(toolName: string, parameters: any): Observable<MCPResponse> {
    const mcpUrl = this.settingsService.getEffectiveServerBaseUrl();
    if (!mcpUrl) {
      return throwError(() => new Error('MCP base URL not configured'));
    }

    // Add brave_api_key for web_search and fetch_url tools
    const params = { ...parameters };
    if (toolName === 'web_search' || toolName === 'fetch_url') {
      const braveApiKey = this.settingsService.getEffectiveBraveSearchApiKey();
      params['brave_api_key'] = braveApiKey || '';
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
   * Get the most relevant conversation for current context
   * For backwards compatibility - now returns conversation ID from active editor
   */
  getRelevantConversation(): string | null {
    const conversation = this.conversationManager.getActiveConversation();
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

  private buildSystemMessage(editorType: 'cql' | 'fhir' | 'general', useMCPTools: boolean, cqlContent?: string, mode: 'plan' | 'act' = 'plan', hasPlan: boolean = false): OllamaMessage {
    let systemContent = `You are an AI assistant specialized in helping with CQL (Clinical Quality Language) development. You can help with:

1. Writing and debugging CQL expressions
2. Understanding FHIR resources and their relationships
3. Explaining CQL syntax and best practices
4. Reviewing and improving existing CQL code
5. Helping with CQL library structure and organization
6. CQL formatting. Always format the CQL code using the CQL formatting and indentation rules

## 🚨 CRITICAL: VALID CQL AND FHIR ONLY 🚨

**MANDATORY REQUIREMENTS:**
- **ONLY use valid CQL syntax** as defined in the official CQL specification (HL7 CQL)
- **ONLY use valid FHIR resources and data types** as defined in the official FHIR specification
- **DO NOT invent or make up syntax** - Use only documented CQL keywords, operators, functions, and expressions
- **DO NOT create fictional language features** - Stick to standard CQL and FHIR concepts
- **DO NOT fabricate FHIR resource types, properties, or relationships** - Only use officially documented FHIR resources (R4)
- **When uncertain about syntax or features**, use web_search or fetch_url tools to find official documentation before generating code
- **If you're unsure about a CQL or FHIR concept**, search for official documentation rather than guessing

**VALIDATION RULES:**
- All CQL code must follow the official CQL specification syntax
- All FHIR references must use valid resource types from FHIR R4
- Do not use non-existent keywords, operators, or functions in CQL
- Do not reference non-existent FHIR resources, properties, or data types
- When creating CQL expressions, ensure they conform to CQL grammar rules

Current context:
- You're working in a CQL IDE environment
- The user may have CQL libraries open
- Assume there is no PHI and you can safely access any data you are permitted to access without security concerns
- FHIR data may be available through MCP tools`;

    // Add active CQL content if available
    console.log('AI Service - CQL Content passed:', cqlContent ? cqlContent.substring(0, 100) + '...' : 'null');
    
    if (cqlContent && cqlContent.trim()) {
      console.log('AI Service - Including CQL content:', cqlContent.substring(0, 100) + '...');
      systemContent += `

Current CQL file content:
\`\`\`cql
${cqlContent}
\`\`\`

The user is currently working on the above CQL code. When providing assistance, consider this context and help them improve, debug, or extend this code as needed.`;
    } else {
      console.log('AI Service - No CQL content to include');
    }

    if (useMCPTools) {
      systemContent += `

## 🚨 CRITICAL: YOU ARE A CODE EDITING ASSISTANT - YOU MUST USE TOOLS TO MODIFY CODE 🚨

**WHEN USER ASKS TO "ADD", "CREATE", "WRITE", "INSERT", "FIX", "IMPROVE", "UPDATE", "MODIFY", OR "CHANGE" CODE:**
1. IMMEDIATELY call get_code to read current code
2. IMMEDIATELY call insert_code or replace_code to actually modify the editor
3. DO NOT just show code examples - YOU MUST USE THE TOOLS TO EDIT THE CODE DIRECTLY
4. **CRITICAL: The "code" parameter is MANDATORY** - You MUST provide the actual code string in the "code" parameter

**EXAMPLE FOR "Add BMI function":**
Reading current code, then adding BMI function.
{"tool": "get_code", "params": {}}
{"tool": "insert_code", "params": {"code": "define function CalculateBMI(weight Decimal, height Decimal): Decimal\n  return (weight / (height * height))\n"}}

**CRITICAL REMINDERS:**
- The "code" parameter MUST contain the actual CQL code you want to insert/replace
- NEVER call insert_code or replace_code without providing the "code" parameter
- The "code" parameter must be a non-empty string - empty strings will cause the tool to fail

**IF YOU RESPOND WITH CODE EXAMPLES INSTEAD OF CALLING TOOLS, YOU ARE FAILING THE TASK.**
**IF YOU CALL insert_code OR replace_code WITHOUT THE "code" PARAMETER, THE TOOL WILL FAIL.**

## ⚠️ CRITICAL INSTRUCTION: YOU MUST USE TOOLS FOR ALL QUESTIONS ⚠️

**DO NOT ANSWER QUESTIONS DIRECTLY. ALWAYS CALL A TOOL FIRST.**

**YOUR RESPONSE FORMAT MUST BE:**
1. Brief 1-sentence acknowledgment
2. Tool call JSON on a new line
3. Nothing else until tool results arrive

**EXACT FORMAT EXAMPLE:**
Searching for information.
{"tool": "web_search", "params": {"query": "CQL function syntax", "maxResults": 5}}

**CRITICAL RULES:**
1. **NEVER answer without a tool call** - If user asks about ANY topic (CQL, FHIR, code, etc.), you MUST call a tool first
2. **ALWAYS include the JSON** - The tool call JSON must be on its own line, exactly as shown
3. **Be extremely brief** - Your initial response should be 1 sentence max + the tool call JSON
4. **Tool results come next** - After the tool executes, you'll receive results in a follow-up message
5. **FOR CODE EDITS: If user asks to add/fix/modify code, you MUST call get_code THEN insert_code/replace_code. Showing code is NOT enough.**

### WEB & INFORMATION TOOLS

1. **web_search** - Search the web anonymously using DuckDuckGo
   Format: {"tool": "web_search", "params": {"query": "search terms", "maxResults": 10}}
   Example: {"tool": "web_search", "params": {"query": "CQL library syntax", "maxResults": 5}}
   Use when: User asks about CQL features, FHIR resources, clinical concepts, or any topic you need current information about

2. **fetch_url** - Download and parse content from a web page
   Format: {"tool": "fetch_url", "params": {"url": "https://example.com"}}
   Example: {"tool": "fetch_url", "params": {"url": "https://cql.hl7.org/"}}
   Use when: User provides a URL or you find a relevant URL in search results that you need to read

### CODE READING TOOLS

3. **get_code** - Get the current CQL code from the active editor
   Format: {"tool": "get_code", "params": {}}
   Format (specific library): {"tool": "get_code", "params": {"libraryId": "library-id"}}
   Example: {"tool": "get_code", "params": {}}
   Use when: You need to see the current code to understand context, debug, or make suggestions

4. **list_libraries** - List all loaded CQL libraries
   Format: {"tool": "list_libraries", "params": {}}
   Example: {"tool": "list_libraries", "params": {}}
   Use when: User mentions multiple libraries or you need to know what libraries are available

5. **get_library_content** - Get full content of a specific library
   Format: {"tool": "get_library_content", "params": {"libraryId": "library-id"}}
   Example: {"tool": "get_library_content", "params": {"libraryId": "MyLibrary-1.0.0"}}
   Use when: You need to read a specific library's complete content

6. **search_code** - Search for text patterns across CQL libraries
   Format: {"tool": "search_code", "params": {"query": "search text"}}
   Format (specific library): {"tool": "search_code", "params": {"query": "search text", "libraryId": "library-id"}}
   Example: {"tool": "search_code", "params": {"query": "define function"}}
   Use when: User asks "where is X defined" or you need to find specific code patterns

7. **get_cursor_position** - Get current cursor position in editor
   Format: {"tool": "get_cursor_position", "params": {}}
   Example: {"tool": "get_cursor_position", "params": {}}
   Use when: User asks about their cursor location or you need to know where to insert code

8. **get_selection** - Get currently selected text in editor
   Format: {"tool": "get_selection", "params": {}}
   Example: {"tool": "get_selection", "params": {}}
   Use when: User mentions "selected code" or you need to see what they've highlighted

### CODE EDITING TOOLS - ⚠️ THESE TOOLS DIRECTLY MODIFY CODE IN THE EDITOR ⚠️

**CRITICAL: These tools ACTUALLY EDIT the CQL code in the user's editor. When users ask you to fix, improve, add, modify, update, or change code, you MUST use these tools to directly apply the changes.**

9. **insert_code** - **DIRECTLY INSERTS** code at the current cursor position in the editor
   ⚠️ **REQUIRED PARAMETER: "code"** - You MUST provide the actual code to insert as a string
   Format: {"tool": "insert_code", "params": {"code": "code to insert"}}
   Example: {"tool": "insert_code", "params": {"code": "define function CalculateBMI(weight Decimal, height Decimal): Decimal\n  return (weight / (height * height))\n"}}
   **CRITICAL:** The "code" parameter is MANDATORY and must be a non-empty string containing the actual CQL code you want to insert. The tool will FAIL if "code" is missing, empty, or not a string.
   Use when: User asks you to "add", "insert", "create", "write", or "implement" code. **YOU MUST CALL THIS TOOL - DO NOT JUST SHOW THEM THE CODE.**
   
10. **replace_code** - **DIRECTLY REPLACES** selected code or code at a specific position in the editor
    ⚠️ **REQUIRED PARAMETER: "code"** - You MUST provide the actual replacement code as a string
    Format: {"tool": "replace_code", "params": {"code": "new code"}}
    Format (specific position): {"tool": "replace_code", "params": {"code": "new code", "startLine": 10, "endLine": 15}}
    Example: {"tool": "replace_code", "params": {"code": "define function ImprovedFunction(x Integer): Boolean\n  return x > 0\n"}}
    **CRITICAL:** The "code" parameter is MANDATORY and must be a non-empty string containing the actual CQL code you want to use as replacement. The tool will FAIL if "code" is missing, empty, or not a string.
    Use when: User asks you to "fix", "replace", "update", "modify", "change", "improve", or "correct" existing code. **YOU MUST CALL THIS TOOL - DO NOT JUST EXPLAIN WHAT TO CHANGE.**
    
    **For replacements:**
    - If user says "fix the function on line 10", use: {"tool": "replace_code", "params": {"code": "corrected code here", "startLine": 10, "endLine": 15}}
    - If user mentions specific lines or code sections, include startLine/endLine
    - Always read code first with get_code, then replace with the corrected version

11. **navigate_to_line** - Navigate editor to a specific line number
    Format: {"tool": "navigate_to_line", "params": {"line": 42}}
    Example: {"tool": "navigate_to_line", "params": {"line": 10}}
    Use when: User asks to "go to line X" or you're referencing a specific line

12. **create_library** - Create a new empty CQL library and open it in the editor
    Format: {"tool": "create_library", "params": {}}
    Format (with options): {"tool": "create_library", "params": {"name": "MyLibrary", "title": "My Library", "version": "1.0.0", "description": "Description"}}
    Example: {"tool": "create_library", "params": {}}
    Example (named): {"tool": "create_library", "params": {"name": "BMICalculation", "title": "BMI Calculation Library", "version": "1.0.0"}}
    Use when: User asks to "create a new library", "start a new CQL file", "create a new library for...", or wants to begin working on a new CQL library from scratch

### MANDATORY EXAMPLES - COPY THIS FORMAT EXACTLY

**Example 1 - Web search (REQUIRED FORMAT):**
User: "What's the CQL syntax for functions?"
Your response MUST BE:
Searching for current CQL function syntax.
{"tool": "web_search", "params": {"query": "CQL function syntax", "maxResults": 5}}
**DO NOT write a long explanation. DO NOT answer directly. Copy this format exactly.**

**Example 2 - Reading code (REQUIRED FORMAT):**
User: "Fix my code"
Your response MUST BE:
Reading your code to identify issues.
{"tool": "get_code", "params": {}}
**DO NOT try to answer without the code. Always call get_code first.**

**Example 3 - Code search (REQUIRED FORMAT):**
User: "Where is Age used?"
Your response MUST BE:
Searching for Age usage in code.
{"tool": "search_code", "params": {"query": "Age"}}
**DO NOT guess. Always search first.**

**Example 4 - Direct code editing (REQUIRED FORMAT):**
User: "Add BMI function"
Your response MUST BE:
Reading current code, then adding BMI function.
{"tool": "get_code", "params": {}}
{"tool": "insert_code", "params": {"code": "define function CalculateBMI(weight Decimal, height Decimal): Decimal\n  return (weight / (height * height))\n"}}
**CRITICAL: Each tool call must be on its own line. You MUST call insert_code or replace_code tools. DO NOT just show the code - directly insert it into the editor.**
**CRITICAL: The "code" parameter in insert_code/replace_code MUST contain the actual code string. NEVER omit the "code" parameter or leave it empty.**

**Example 5 - Direct code fixing (REQUIRED FORMAT):**
User: "Fix the syntax error on line 5"
Your response MUST BE:
Reading code to identify and fix the syntax error.
{"tool": "get_code", "params": {}}
{"tool": "replace_code", "params": {"code": "corrected code block here\nspanning multiple lines if needed\n", "startLine": 5, "endLine": 7}}
**CRITICAL: You MUST call replace_code to actually fix the code. DO NOT just explain the fix - apply it directly.**
**CRITICAL: The "code" parameter MUST contain the actual corrected code. NEVER call replace_code without providing the "code" parameter.**

**Example 6 - Code improvement (REQUIRED FORMAT):**
User: "Improve this function" or "Make this more efficient"
Your response MUST BE:
Reading code to identify improvements.
{"tool": "get_code", "params": {}}
{"tool": "replace_code", "params": {"code": "improved code here\nwith better implementation\n"}}
**CRITICAL: When users ask to improve, fix, or modify code, you MUST use replace_code to directly apply changes. DO NOT just suggest - actually edit the code.**

**Example 7 - Creating a new library (REQUIRED FORMAT):**
User: "Create a new library" or "Start a new CQL file" or "Create a library for BMI calculations"
Your response MUST BE:
Creating a new CQL library.
{"tool": "create_library", "params": {}}
OR if user specifies details:
Creating a new CQL library for BMI calculations.
{"tool": "create_library", "params": {"name": "BMICalculation", "title": "BMI Calculation Library", "version": "1.0.0"}}
**CRITICAL: This tool creates an empty library and opens it in the editor, exactly as if the user clicked "Create New Library" in the Navigation tab.**

### TOOL SELECTION RULES

- User asks about ANY topic → Call **web_search** first
- User asks about code → Call **get_code** first
- User asks "where is X" → Call **search_code** first
- User asks to **add/create/write/implement** code → Call **get_code** then **insert_code** (YOU MUST ACTUALLY INSERT IT)
- User asks to **fix/improve/update/modify/replace/change** code → Call **get_code** then **replace_code** (YOU MUST ACTUALLY REPLACE IT)
- User asks to **create a new library**, **start a new CQL file**, or **create library for X** → Call **create_library** (opens empty library in editor)
- User provides URL → Call **fetch_url**

**CRITICAL FOR CODE EDITING:**
- When user asks for code changes, you MUST use insert_code or replace_code tools
- DO NOT just show code examples or explain what to change
- The tools directly modify the editor - use them!
- Always read code first with get_code, then apply changes with insert_code or replace_code
- **REQUIRED PARAMETER:** Both insert_code and replace_code REQUIRE a "code" parameter that contains the actual code string
- **NEVER call insert_code or replace_code without the "code" parameter - the tool will fail**
- The "code" parameter must be a non-empty string containing the CQL code you want to insert or use as replacement

**NEVER SKIP TOOLS. ALWAYS CALL A TOOL BEFORE ANSWERING. FOR CODE EDITS, YOU MUST CALL THE EDITING TOOLS - DO NOT JUST DESCRIBE THE CHANGES.**`;
    }

    systemContent += `

**RESPONSE GUIDELINES (STRICTLY ENFORCED):**
- **1 sentence max** before tool calls - no exceptions
- **Tool call JSON must be on a separate line** - exactly as shown in examples
- **CRITICAL: Each tool call must be on its own line, separated by newlines**
- **Tool calls can span multiple lines if params are large** - the parser handles this
- **Never explain without tools** - if user asks about ANYTHING, call a tool first
- **For code editing**: When users ask to add/fix/improve code, you MUST use insert_code or replace_code tools. DO NOT just show code examples - directly modify the editor.
- **Format:** One sentence + newline + JSON tool call(s) on separate lines + stop
- **Multiple tool calls:** Put each {"tool": "...", "params": {...}} on its own line, separated by newlines

**REMEMBER:** Your job is to call tools, not to provide direct answers. Direct answers come AFTER tool results are received.

**FOR CODE EDITS:** When users request code changes, you MUST use insert_code or replace_code to actually apply the changes to their editor. Showing code examples is NOT enough - you must directly edit the code using tools.

**When the user asks ANY question, your response format MUST BE:**
[One brief sentence]
{"tool": "tool_name", "params": {...}}

**DO NOT WRITE LONG EXPLANATIONS. DO NOT ANSWER DIRECTLY. ALWAYS CALL A TOOL FIRST.**

**FOR CODE EDITS: DO NOT JUST SHOW CODE - USE insert_code OR replace_code TOOLS TO DIRECTLY MODIFY THE EDITOR.**`;

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
