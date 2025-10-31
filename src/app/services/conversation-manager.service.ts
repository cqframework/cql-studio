// Author: Preston Lee

import { Injectable, signal, computed, inject, effect } from '@angular/core';
import { OllamaMessage } from './ai.service';
import { ParsedToolCall, ToolCallParserService } from './tool-call-parser.service';
import { ToolResult } from './tool-orchestrator.service';
import { IdeStateService } from './ide-state.service';
import { SettingsService } from './settings.service';
import { Plan, PlanStep } from '../models/plan.model';

/**
 * UI Message extends OllamaMessage with display metadata
 * Following Cline's dual-array pattern: separate UI messages from API messages
 */
export interface UIMessage extends OllamaMessage {
  id: string;
  streaming?: boolean;
  toolCalls?: ParsedToolCall[];
  toolResults?: ToolResult[];
  timestamp: Date;
}

/**
 * Conversation with workspace/editor scope
 * One conversation per editor context (Cline pattern)
 */
export interface Conversation {
  id: string;
  editorId: string;
  editorType: 'cql' | 'fhir' | 'general';
  libraryName?: string;
  fileName?: string;
  title: string;
  apiMessages: OllamaMessage[]; // Messages sent to/received from API (may include tool calls/results)
  uiMessages: UIMessage[]; // Messages displayed in UI (tool calls/results filtered out)
  mode: 'plan' | 'act'; // Current mode (persists per conversation)
  plan?: Plan; // Optional plan stored when in plan mode
  createdAt: Date;
  updatedAt: Date;
  lastAccessed: Date;
}

/**
 * Editor context metadata (separate from conversation storage)
 */
export interface EditorContext {
  editorId: string;
  editorType: 'cql' | 'fhir' | 'general';
  libraryName?: string;
  fileName?: string;
}

/**
 * Centralized conversation management service
 * Following Cline's architecture: workspace-scoped, automatic context switching
 */
@Injectable({
  providedIn: 'root'
})
export class ConversationManagerService {
  private readonly STORAGE_KEY_PREFIX = 'ai_conversation_';
  private readonly MAX_CONVERSATIONS_PER_EDITOR = 1; // One conversation per editor (Cline pattern)
  private readonly MAX_API_MESSAGES = 100; // Context window management (Cline pattern: prevent infinite growth)
  private readonly MAX_CONTEXT_TOKENS = 8000; // Approximate token limit for Ollama (configurable)
  
  // Active conversation signal - automatically updates when editor changes
  private _activeConversation = signal<Conversation | null>(null);
  private _activeEditorId = signal<string | null>(null);
  
  // Public computed signals
  public activeConversation = computed(() => this._activeConversation());
  public activeEditorId = computed(() => this._activeEditorId());
  
  private ideStateService = inject(IdeStateService);
  private settingsService = inject(SettingsService);
  private toolCallParser = inject(ToolCallParserService);
  
  constructor() {
    // Automatically detect current editor context
    this.detectAndLoadActiveEditor();
    
    // Watch for editor changes and automatically switch conversations (Cline pattern)
    // Use effect to reactively update active conversation when editor changes
    effect(() => {
      // Get current editor context (library takes precedence, then file, then general)
      const libraryId = this.ideStateService.activeLibraryId();
      const fileId = this.ideStateService.activeFileId();
      
      let editorId: string | null = null;
      
      if (libraryId) {
        editorId = `library_${libraryId}`;
      } else if (fileId) {
        editorId = `file_${fileId}`;
      } else {
        // General context as fallback
        editorId = 'general_context';
      }
      
      // Only switch if editor actually changed (prevent unnecessary updates)
      const currentEditorId = this._activeEditorId();
      if (currentEditorId !== editorId) {
        const context = this.getEditorContextFromId(editorId);
        if (context) {
          const conversation = this.loadOrCreateConversation(context);
          this._activeEditorId.set(editorId);
          this._activeConversation.set(conversation);
        }
      }
    });
  }
  
  /**
   * Get the current editor context from IDE state
   */
  getCurrentEditorContext(): EditorContext | null {
    const activeLibrary = this.ideStateService.getActiveLibraryResource();
    const activeFileId = this.ideStateService.activeFileId();
    
    if (activeLibrary) {
      return {
        editorId: `library_${activeLibrary.id}`,
        editorType: 'cql',
        libraryName: activeLibrary.name,
        fileName: activeLibrary.name
      };
    }
    
    if (activeFileId) {
      return {
        editorId: `file_${activeFileId}`,
        editorType: 'general',
        fileName: activeFileId
      };
    }
    
    return null;
  }
  
  /**
   * Get active conversation for current editor (or create if none exists)
   */
  getActiveConversation(editorId?: string): Conversation | null {
    const context = editorId 
      ? this.getEditorContextFromId(editorId)
      : this.getCurrentEditorContext();
    
    if (!context) {
      return null;
    }
    
    const targetEditorId = editorId || context.editorId;
    
    // If already loaded and matches, return it
    const current = this._activeConversation();
    if (current && current.editorId === targetEditorId) {
      return current;
    }
    
    // Load or create conversation for this editor
    return this.loadOrCreateConversation(context);
  }
  
  /**
   * Switch to a specific editor's conversation
   * Automatically loads conversation when editor changes
   */
  switchToEditor(editorId: string): Conversation | null {
    const context = this.getEditorContextFromId(editorId);
    if (!context) {
      return null;
    }
    
    const conversation = this.loadOrCreateConversation(context);
    this._activeEditorId.set(editorId);
    this._activeConversation.set(conversation);
    return conversation;
  }
  
  /**
   * Create a new conversation for an editor context
   * Only one conversation per editor (Cline pattern)
   */
  createConversationForEditor(
    editorId: string,
    editorType: 'cql' | 'fhir' | 'general',
    firstMessage?: string,
    libraryName?: string,
    fileName?: string,
    mode?: 'plan' | 'act'
  ): Conversation {
    const conversation: Conversation = {
      id: this.generateId(),
      editorId,
      editorType,
      libraryName,
      fileName,
      title: this.generateTitle(firstMessage || editorId),
      apiMessages: [], // API format (full context including tool calls/results)
      uiMessages: [], // UI format (sanitized, no tool JSON)
      mode: mode || this.settingsService.settings().defaultMode || 'plan', // Use provided mode or default from settings
      createdAt: new Date(),
      updatedAt: new Date(),
      lastAccessed: new Date()
    };
    
    if (firstMessage) {
      // Add to both arrays (Cline pattern: keep them in sync initially)
      const userApiMessage: OllamaMessage = { role: 'user', content: firstMessage };
      const userUiMessage: UIMessage = {
        id: this.generateMessageId(),
        role: 'user',
        content: firstMessage,
        timestamp: new Date()
      };
      conversation.apiMessages.push(userApiMessage);
      conversation.uiMessages.push(userUiMessage);
    }
    
    this.saveConversation(conversation);
    this._activeEditorId.set(editorId);
    this._activeConversation.set(conversation);
    
    return conversation;
  }
  
  /**
   * Get API messages for LLM request (includes tool calls/results, full context)
   * Following Cline's dual-array pattern: API messages maintain full context
   * Includes context window management to prevent infinite growth
   */
  getApiMessages(conversationId: string, maxMessages?: number): OllamaMessage[] {
    const conversation = this.loadConversation(conversationId);
    if (!conversation) {
      return [];
    }
    
    let messages = [...conversation.apiMessages];
    const limit = maxMessages || this.MAX_API_MESSAGES;
    
    // Context window management (Cline pattern: keep recent messages, truncate old ones)
    if (messages.length > limit) {
      // Preserve system message if present (typically first message)
      const systemMessages = messages.filter(m => m.role === 'system');
      const nonSystemMessages = messages.filter(m => m.role !== 'system');
      
      // Keep system message(s) + most recent non-system messages
      const keepCount = limit - systemMessages.length;
      const recentMessages = nonSystemMessages.slice(-keepCount);
      
      messages = [...systemMessages, ...recentMessages];
    }
    
    return messages;
  }
  
  /**
   * Get UI messages for display (with metadata)
   * Following Cline's dual-array pattern
   */
  getUIMessages(conversationId: string): UIMessage[] {
    const conversation = this.loadConversation(conversationId);
    if (!conversation) {
      return [];
    }
    
    return [...conversation.uiMessages];
  }
  
  /**
   * Add user message to conversation (Cline pattern: add to both arrays)
   */
  addUserMessage(conversationId: string, content: string): void {
    const conversation = this.loadConversation(conversationId);
    if (!conversation) {
      return;
    }
    
    // Add to API messages (full content)
    const apiMessage: OllamaMessage = { role: 'user', content };
    conversation.apiMessages.push(apiMessage);
    
    // Add to UI messages (same content, but with metadata)
    const uiMessage: UIMessage = {
      id: this.generateMessageId(),
      role: 'user',
      content,
      timestamp: new Date()
    };
    conversation.uiMessages.push(uiMessage);
    
    conversation.updatedAt = new Date();
    conversation.lastAccessed = new Date();
    this.saveConversation(conversation);
    
    // Update active conversation if it's the one being modified
    if (this._activeConversation()?.id === conversationId) {
      this._activeConversation.set({ ...conversation });
    }
  }
  
  /**
   * Add assistant message to conversation (Cline pattern: full content in API, sanitized in UI)
   */
  addAssistantMessage(conversationId: string, content: string): void {
    const conversation = this.loadConversation(conversationId);
    if (!conversation) {
      return;
    }
    
    // Add full content to API messages (may include tool calls/results for context)
    const apiMessage: OllamaMessage = { role: 'assistant', content };
    conversation.apiMessages.push(apiMessage);
    
    // Sanitize content for UI (remove tool JSON)
    const sanitizedContent = this.sanitizeContent(content);
    
    // Only add to UI if there's content after sanitization
    if (sanitizedContent && sanitizedContent.trim().length > 0) {
      // Check for duplicates in UI
      const lastUiMessage = conversation.uiMessages[conversation.uiMessages.length - 1];
      if (!lastUiMessage || lastUiMessage.role !== 'assistant' || lastUiMessage.content !== sanitizedContent) {
        conversation.uiMessages.push({
          id: this.generateMessageId(),
          role: 'assistant',
          content: sanitizedContent,
          timestamp: new Date()
        });
      }
    }
    
    conversation.updatedAt = new Date();
    conversation.lastAccessed = new Date();
    this.saveConversation(conversation);
    
    // Update active conversation if it's the one being modified
    if (this._activeConversation()?.id === conversationId) {
      this._activeConversation.set({ ...conversation });
    }
  }
  
  /**
   * Update last assistant message with streaming content (Cline pattern: update both arrays)
   */
  updateLastAssistantMessage(conversationId: string, content: string): void {
    const conversation = this.loadConversation(conversationId);
    if (!conversation) {
      return;
    }
    
    // Update API message (full content, may include tool JSON)
    const lastApiMessage = conversation.apiMessages[conversation.apiMessages.length - 1];
    if (lastApiMessage && lastApiMessage.role === 'assistant') {
      lastApiMessage.content = content;
    } else {
      // Create new API message if none exists
      conversation.apiMessages.push({ role: 'assistant', content });
    }
    
    // Update UI message (sanitized content)
    const sanitizedContent = this.sanitizeContent(content);
    const lastUiMessage = conversation.uiMessages[conversation.uiMessages.length - 1];
    if (lastUiMessage && lastUiMessage.role === 'assistant') {
      lastUiMessage.content = sanitizedContent;
      lastUiMessage.streaming = true;
    } else if (sanitizedContent && sanitizedContent.trim().length > 0) {
      // Create new UI message if none exists and there's content
      conversation.uiMessages.push({
        id: this.generateMessageId(),
        role: 'assistant',
        content: sanitizedContent,
        streaming: true,
        timestamp: new Date()
      });
    }
    
    conversation.updatedAt = new Date();
    this.saveConversation(conversation);
    
    // Update active conversation
    if (this._activeConversation()?.id === conversationId) {
      this._activeConversation.set({ ...conversation });
    }
  }
  
  /**
   * Mark streaming as complete
   */
  completeStreaming(conversationId: string): void {
    const conversation = this.loadConversation(conversationId);
    if (!conversation) {
      return;
    }
    
    const lastMessage = conversation.uiMessages[conversation.uiMessages.length - 1];
    if (lastMessage && lastMessage.role === 'assistant') {
      lastMessage.streaming = false;
      conversation.updatedAt = new Date();
      this.saveConversation(conversation);
      
      // Update active conversation
      if (this._activeConversation()?.id === conversationId) {
        this._activeConversation.set({ ...conversation });
      }
    }
  }
  
  /**
   * Delete a conversation
   */
  deleteConversation(conversationId: string): void {
    const conversation = this.loadConversation(conversationId);
    if (!conversation) {
      return;
    }
    
    const storageKey = this.getStorageKey(conversation.editorId);
    localStorage.removeItem(storageKey);
    
    // Clear active conversation if it was deleted
    if (this._activeConversation()?.id === conversationId) {
      this._activeConversation.set(null);
      this._activeEditorId.set(null);
    }
  }
  
  /**
   * Get all conversations (across all editors)
   */
  getAllConversations(): Conversation[] {
    const conversations: Conversation[] = [];
    const keys = Object.keys(localStorage);
    
    for (const key of keys) {
      if (key.startsWith(this.STORAGE_KEY_PREFIX)) {
        try {
          const data = localStorage.getItem(key);
          if (data) {
            const conv = JSON.parse(data);
            // Backward compatibility: if apiMessages doesn't exist, initialize from uiMessages
            let apiMessages = conv.apiMessages || [];
            if (!conv.apiMessages && conv.uiMessages) {
              // Convert UI messages to API format (backward compatibility)
              apiMessages = conv.uiMessages.map((msg: any) => ({
                role: msg.role,
                content: msg.content
              }));
            }
            
            conversations.push({
              ...conv,
              createdAt: new Date(conv.createdAt),
              updatedAt: new Date(conv.updatedAt),
              lastAccessed: new Date(conv.lastAccessed),
              mode: (conv.mode === 'plan' || conv.mode === 'act') ? conv.mode : (this.settingsService?.settings()?.defaultMode || 'plan'), // Backward compatibility - only accept valid mode values
              apiMessages: apiMessages, // Ensure apiMessages array exists
              uiMessages: (conv.uiMessages || []).map((msg: any) => ({
                ...msg,
                timestamp: new Date(msg.timestamp)
              }))
            });
          }
        } catch {
          // Skip invalid entries
        }
      }
    }
    
    return conversations.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }
  
  /**
   * Clear all conversations
   */
  clearAllConversations(): void {
    const keys = Object.keys(localStorage);
    for (const key of keys) {
      if (key.startsWith(this.STORAGE_KEY_PREFIX)) {
        localStorage.removeItem(key);
      }
    }
    
    this._activeConversation.set(null);
    this._activeEditorId.set(null);
  }
  
  /**
   * Detect current editor and load its conversation
   */
  private detectAndLoadActiveEditor(): void {
    const context = this.getCurrentEditorContext();
    if (context) {
      const conversation = this.loadOrCreateConversation(context);
      this._activeEditorId.set(context.editorId);
      this._activeConversation.set(conversation);
    }
  }
  
  
  /**
   * Load or create conversation for editor context
   */
  private loadOrCreateConversation(context: EditorContext): Conversation {
    // Try to load existing conversation
    const existing = this.loadConversationByEditorId(context.editorId);
    if (existing) {
      existing.lastAccessed = new Date();
      this.saveConversation(existing);
      return existing;
    }
    
    // Create new conversation
    return this.createConversationForEditor(
      context.editorId,
      context.editorType,
      undefined,
      context.libraryName,
      context.fileName
    );
  }
  
  /**
   * Load conversation by ID with error recovery (Cline pattern: handle corrupted data gracefully)
   */
  private loadConversation(conversationId: string): Conversation | null {
    try {
      const allConversations = this.getAllConversations();
      return allConversations.find(c => c.id === conversationId) || null;
    } catch (error) {
      console.error(`Failed to load conversation ${conversationId}:`, error);
      // Error recovery: clear corrupted entry if it exists
      try {
        const conversations = this.getAllConversations();
        const corrupted = conversations.find(c => c.id === conversationId);
        if (corrupted) {
          this.deleteConversation(conversationId);
        }
      } catch {
        // If recovery fails, at least log it
        console.error('Failed to recover from conversation load error');
      }
      return null;
    }
  }
  
  /**
   * Load conversation by editor ID
   */
  private loadConversationByEditorId(editorId: string): Conversation | null {
    const storageKey = this.getStorageKey(editorId);
    const data = localStorage.getItem(storageKey);
    
    if (!data) {
      return null;
    }
    
    try {
      const conv = JSON.parse(data);
      return {
        ...conv,
        mode: (conv.mode === 'plan' || conv.mode === 'act') ? conv.mode : (this.settingsService?.settings()?.defaultMode || 'plan'), // Backward compatibility - only accept valid mode values
        createdAt: new Date(conv.createdAt),
        updatedAt: new Date(conv.updatedAt),
        lastAccessed: new Date(conv.lastAccessed),
        uiMessages: (conv.uiMessages || []).map((msg: any) => ({
          ...msg,
          timestamp: new Date(msg.timestamp)
        }))
      };
    } catch {
      return null;
    }
  }
  
  /**
   * Update conversation mode
   */
  updateConversationMode(conversationId: string, mode: 'plan' | 'act'): void {
    const conversation = this.loadConversation(conversationId);
    if (!conversation) {
      return;
    }
    
    conversation.mode = mode;
    conversation.updatedAt = new Date();
    this.saveConversation(conversation);
    
    // Update active conversation if it matches
    if (this._activeConversation()?.id === conversationId) {
      this._activeConversation.set({ ...conversation });
    }
  }
  
  /**
   * Update plan in conversation
   */
  updatePlan(conversationId: string, plan: Plan): void {
    const conversation = this.loadConversation(conversationId);
    if (!conversation) {
      return;
    }
    
    conversation.plan = plan;
    conversation.updatedAt = new Date();
    this.saveConversation(conversation);
    
    // Update active conversation if it matches
    if (this._activeConversation()?.id === conversationId) {
      this._activeConversation.set({ ...conversation });
    }
  }
  
  /**
   * Update plan step status
   */
  updatePlanStepStatus(conversationId: string, stepId: string, status: PlanStep['status'], toolCallId?: string): void {
    const conversation = this.loadConversation(conversationId);
    if (!conversation || !conversation.plan) {
      return;
    }
    
    const step = conversation.plan.steps.find((s: PlanStep) => s.id === stepId);
    if (step) {
      step.status = status;
      if (toolCallId) {
        step.toolCallId = toolCallId;
      }
      conversation.updatedAt = new Date();
      this.saveConversation(conversation);
      
      // Update active conversation if it matches
      if (this._activeConversation()?.id === conversationId) {
        this._activeConversation.set({ ...conversation });
      }
    }
  }
  
  /**
   * Save conversation to storage
   */
  private saveConversation(conversation: Conversation): void {
    const storageKey = this.getStorageKey(conversation.editorId);
    localStorage.setItem(storageKey, JSON.stringify(conversation));
  }
  
  /**
   * Get storage key for editor ID
   */
  private getStorageKey(editorId: string): string {
    return `${this.STORAGE_KEY_PREFIX}${editorId}`;
  }
  
  /**
   * Get editor context from editor ID (public for AiService)
   */
  getEditorContextFromId(editorId: string): EditorContext | null {
    if (editorId.startsWith('library_')) {
      const libraryId = editorId.replace('library_', '');
      const library = this.ideStateService.libraryResources().find(r => r.id === libraryId);
      if (library) {
        return {
          editorId,
          editorType: 'cql',
          libraryName: library.name,
          fileName: library.name
        };
      }
    } else if (editorId.startsWith('file_')) {
      const fileId = editorId.replace('file_', '');
      return {
        editorId,
        editorType: 'general',
        fileName: fileId
      };
    }
    
    return {
      editorId,
      editorType: 'general'
    };
  }
  
  /**
   * Sanitize content (remove tool JSON and tool results, following Cline pattern)
   * Removes all technical tool execution details - conversation should be user-friendly
   */
  private sanitizeContent(content: string): string {
    if (!content) {
      return content;
    }
    
    let sanitized = content;
    
    // Remove tool execution results section (multiple variations)
    const toolResultsPatterns = [
      /\n\n\*\*Tool Execution Results:\*\*[\s\S]*$/m,
      /\n\*\*Tool Execution Results:\*\*[\s\S]*$/m,
      /\*\*Tool Execution Results:\*\*[\s\S]*$/m,
      /\n\nTool Execution Results:[\s\S]*$/m,
      /\nTool Execution Results:[\s\S]*$/m,
      /Tool Execution Results:[\s\S]*$/m
    ];
    
    for (const pattern of toolResultsPatterns) {
      sanitized = sanitized.replace(pattern, '');
    }
    
    // Remove tool result summary lines (various formats)
    // Match patterns like "Tool web_search executed successfully:" followed by content
    sanitized = sanitized.replace(/^Tool\s+\w+\s+(executed successfully|failed|completed):[\s\S]*?(?=\n\n|\n[A-Z]|\nTool|$)/gmi, '');
    sanitized = sanitized.replace(/^Tool\s+\w+\s+(executed successfully|failed|completed):.*$/gmi, '');
    sanitized = sanitized.replace(/^✓\s+Tool\s+\w+.*$/gmi, '');
    sanitized = sanitized.replace(/^✗\s+Tool\s+\w+.*$/gmi, '');
    sanitized = sanitized.replace(/^Tool:\s+\w+.*$/gmi, '');
    
    // Remove JSON tool blocks using the tool parser service (handles balanced braces properly)
    const toolBlocks = this.toolCallParser.findToolJsonBlocks(sanitized);
    // Remove blocks in reverse order to preserve indices
    let textWithoutToolBlocks = sanitized;
    for (let i = toolBlocks.length - 1; i >= 0; i--) {
      textWithoutToolBlocks = textWithoutToolBlocks.substring(0, toolBlocks[i].start) + 
                              textWithoutToolBlocks.substring(toolBlocks[i].end);
    }
    sanitized = textWithoutToolBlocks;
    
    // Additional regex patterns for edge cases
    sanitized = sanitized.replace(/\{\s*"tool"\s*:\s*"[^"]+"\s*,\s*"success"\s*:\s*(true|false)[\s\S]*?\}/g, '');
    sanitized = sanitized.replace(/\{\s*"result"\s*:\s*[^}]*\}/g, '');
    
    // Remove web search result structures (arrays of results)
    sanitized = sanitized.replace(/\{\s*"results"\s*:\s*\[[\s\S]*?\]\s*[,\s]*"query"\s*:\s*"[^"]*"\s*\}/g, '');
    sanitized = sanitized.replace(/\{\s*"query"\s*:\s*"[^"]*"\s*[,\s]*"results"\s*:\s*\[[\s\S]*?\]\s*\}/g, '');
    sanitized = sanitized.replace(/\{\s*"title"\s*:\s*"[^"]*"[\s\S]*?"url"\s*:\s*"[^"]*"[\s\S]*?\}/g, '');
    
    // Remove multi-line JSON blocks (tool results often span multiple lines)
    // Match blocks that contain tool, result, success, error, or query/results patterns
    sanitized = sanitized.replace(/\{[\s\S]*?"tool"[\s\S]*?"result"[\s\S]*?\}/g, '');
    sanitized = sanitized.replace(/\{[\s\S]*?"tool"[\s\S]*?"error"[\s\S]*?\}/g, '');
    sanitized = sanitized.replace(/\{[\s\S]*?"tool"[\s\S]*?"success"[\s\S]*?\}/g, '');
    sanitized = sanitized.replace(/\{[\s\S]*?"results"[\s\S]*?\}/g, ''); // Web search results array
    sanitized = sanitized.replace(/\{[\s\S]*?"query"[\s\S]*?"results"[\s\S]*?\}/g, ''); // Web search query + results
    
    // Remove tool JSON from individual lines
    const lines = sanitized.split('\n');
    const filteredLines = lines.filter(line => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      
      // Remove lines that look like tool JSON
      if (trimmed.startsWith('{') && (trimmed.includes('"tool"') || trimmed.includes('"result"') || trimmed.includes('"success"') || trimmed.includes('"query"') || trimmed.includes('"results"') || trimmed.includes('"params"'))) {
        return false;
      }
      
      // Remove lines with tool execution status
      if (/^Tool\s+\w+\s+(executed successfully|failed|completed):/.test(trimmed)) {
        return false;
      }
      
      // Remove lines that are just JSON structures (tool results, web search results)
      if (/^\s*\{[\s\S]*\}\s*$/.test(trimmed) && (trimmed.includes('"tool"') || trimmed.includes('"result"') || trimmed.includes('"success"') || trimmed.includes('"query"') || trimmed.includes('"results"') || trimmed.includes('"params"') || (trimmed.includes('"title"') && trimmed.includes('"url"')))) {
        return false;
      }
      
      // Remove lines that are fragments of tool JSON blocks (like "params": {...} or "resultsCount": ...)
      if (/^\s*"params"\s*:\s*\{/.test(trimmed) || /^\s*"resultsCount"\s*:/.test(trimmed) || 
          (/^\s*"[^"]+"\s*:\s*\{/.test(trimmed) && trimmed.match(/"params"|"resultsCount"|"results"/))) {
        return false;
      }
      
      // Remove lines that look like web search result entries (title, url, snippet)
      if (/^\s*\{\s*"title"/.test(trimmed) || /^\s*\{\s*"url"/.test(trimmed) || /^\s*"title"\s*:\s*"/.test(trimmed) || /^\s*"url"\s*:\s*"/.test(trimmed) || /^\s*"snippet"\s*:\s*"/.test(trimmed)) {
        return false;
      }
      
      // Remove JSON array entries that are part of tool results
      if (trimmed.startsWith('[') && (trimmed.includes('"title"') || trimmed.includes('"url"') || trimmed.includes('"results"') || trimmed.includes('"snippet"'))) {
        return false;
      }
      
      // Remove continuation of tool result JSON blocks
      if (/^\s*"[^"]+"\s*:\s*"/.test(trimmed) && (trimmed.includes('http://') || trimmed.includes('https://')) && trimmed.length < 200) {
        // Likely a URL from web search results
        return false;
      }
      
      return true;
    });
    
    sanitized = filteredLines.join('\n').trim();
    
    // Clean up excessive newlines
    sanitized = sanitized.replace(/\n{3,}/g, '\n\n');
    
    return sanitized;
  }
  
  /**
   * Public method for sanitizing content (used by AI service)
   */
  sanitizeContentForDisplay(content: string): string {
    return this.sanitizeContent(content);
  }
  
  /**
   * Generate unique ID
   */
  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
  
  /**
   * Generate message ID
   */
  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Generate conversation title from first message
   */
  private generateTitle(firstMessage?: string): string {
    if (firstMessage) {
      const words = firstMessage.split(' ').slice(0, 5);
      return words.join(' ') + (firstMessage.split(' ').length > 5 ? '...' : '');
    }
    return 'New Conversation';
  }
}

