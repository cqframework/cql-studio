// Author: Preston Lee

import { Injectable, signal, computed } from '@angular/core';
import { OllamaMessage } from './ai.service';
import { ParsedToolCall } from './tool-call-parser.service';
import { ToolResult } from './tool-orchestrator.service';

/**
 * Conversation flow states inspired by Cline's architecture
 */
export type ConversationState = 
  | 'idle'
  | 'streaming'
  | 'tool-detected'
  | 'tool-executing'
  | 'results-ready'
  | 'awaiting-followup'
  | 'error';

/**
 * Centralized state management for AI conversations
 * Single source of truth for conversation state, following Cline's pattern
 */
@Injectable({
  providedIn: 'root'
})
export class AiConversationStateService {
  // Conversation messages - read-only, modifications through service methods
  private _messages = signal<OllamaMessage[]>([]);
  
  // Streaming state
  private _isStreaming = signal<boolean>(false);
  private _streamingResponse = signal<string>('');
  private _lastChunkTime = signal<number>(0);
  
  // Tool execution state
  private _pendingToolCalls = signal<ParsedToolCall[]>([]);
  private _executingToolCalls = signal<Map<string, ParsedToolCall>>(new Map()); // by callKey
  private _toolExecutionResults = signal<Map<string, ToolResult>>(new Map()); // by callKey
  private _executedToolCallKeys = signal<Set<string>>(new Set());
  
  // Conversation flow state machine
  private _conversationState = signal<ConversationState>('idle');
  
  // Error state
  private _error = signal<string | null>(null);
  
  // Deduplication tracking
  private _processedResponseHashes = signal<Set<string>>(new Set());
  
  // Public computed properties
  public messages = computed(() => this._messages());
  public isStreaming = computed(() => this._isStreaming());
  public streamingResponse = computed(() => this._streamingResponse());
  public pendingToolCalls = computed(() => this._pendingToolCalls());
  public executingToolCalls = computed(() => this._executingToolCalls());
  public toolExecutionResults = computed(() => this._toolExecutionResults());
  public conversationState = computed(() => this._conversationState());
  public error = computed(() => this._error());
  
  /**
   * Check if a tool call has already been executed
   */
  hasExecutedToolCall(callKey: string): boolean {
    return this._executedToolCallKeys().has(callKey);
  }
  
  /**
   * Check if a response has been processed
   */
  hasProcessedResponse(hash: string): boolean {
    return this._processedResponseHashes().has(hash);
  }
  
  /**
   * Reset all state (called when starting a new message)
   */
  resetState(): void {
    this._isStreaming.set(false);
    this._streamingResponse.set('');
    this._pendingToolCalls.set([]);
    this._executingToolCalls.set(new Map());
    this._toolExecutionResults.set(new Map());
    this._executedToolCallKeys.set(new Set());
    this._processedResponseHashes.set(new Set());
    this._error.set(null);
    this.transitionTo('idle');
  }
  
  /**
   * Start streaming
   */
  startStreaming(): void {
    this._isStreaming.set(true);
    this._streamingResponse.set('');
    this._lastChunkTime.set(Date.now());
    this._error.set(null);
    this.transitionTo('streaming');
  }
  
  /**
   * Add streaming chunk
   */
  addStreamingChunk(content: string): void {
    if (!this._isStreaming()) {
      this.startStreaming();
    }
    const current = this._streamingResponse();
    this._streamingResponse.set(current + (content || ''));
    this._lastChunkTime.set(Date.now());
  }
  
  /**
   * End streaming and transition to appropriate state
   * Following Cline's pattern: ensure state reflects current execution status
   */
  endStreaming(): void {
    const wasStreaming = this._isStreaming();
    this._isStreaming.set(false);
    
    // Transition to appropriate state based on current execution status
    this.updateStateForExecutionStatus();
  }
  
  /**
   * Update state based on current execution status
   * Can be called independently to ensure state is correct
   */
  updateStateForExecutionStatus(): void {
    const currentState = this._conversationState();
    
    // If we have tool calls pending or executing, we should be in tool-executing
    if (this._pendingToolCalls().length > 0 || this._executingToolCalls().size > 0) {
      if (currentState !== 'tool-executing') {
        this.transitionTo('tool-executing');
      }
    } 
    // If we have results and nothing executing, we should be in results-ready
    else if (this._toolExecutionResults().size > 0) {
      if (currentState !== 'results-ready') {
        this.transitionTo('results-ready');
      }
    } 
    // Otherwise, we should be idle
    else {
      if (currentState !== 'idle' && currentState !== 'awaiting-followup') {
        this.transitionTo('idle');
      }
    }
  }
  
  /**
   * Add tool calls (from parser)
   * Following Cline's pattern: prevent duplicate execution via deduplication
   * and atomic state updates to prevent race conditions
   */
  addToolCalls(toolCalls: ParsedToolCall[], getCallKey: (call: ParsedToolCall) => string): ParsedToolCall[] {
    if (toolCalls.length === 0) {
      return [];
    }
    
    // Atomic check: get all existing keys in one operation to prevent race conditions
    const existingKeys = new Set<string>();
    
    // Check executed calls
    this._executedToolCallKeys().forEach(key => existingKeys.add(key));
    
    // Check pending calls
    this._pendingToolCalls().forEach(call => {
      existingKeys.add(getCallKey(call));
    });
    
    // Check executing calls
    this._executingToolCalls().forEach((call, key) => {
      existingKeys.add(key);
    });
    
    // Filter out duplicates (following Cline's deduplication pattern)
    const newCalls = toolCalls.filter(call => {
      const key = getCallKey(call);
      return !existingKeys.has(key);
    });
    
    if (newCalls.length > 0) {
      // Atomic update: add new calls in one operation
      const currentPending = this._pendingToolCalls();
      this._pendingToolCalls.set([...currentPending, ...newCalls]);
      
      // If we're streaming, transition to tool-detected (pause chat immediately)
      // This follows Cline's pattern of pausing when tools are detected
      if (this._conversationState() === 'streaming') {
        // Stop streaming immediately when tools detected (Cline pattern)
        this._isStreaming.set(false);
        this.transitionTo('tool-detected');
      }
    }
    
    return newCalls;
  }
  
  /**
   * Helper to generate call key (for use in filtering)
   */
  generateCallKey(call: ParsedToolCall): string {
    return `${call.tool}:${JSON.stringify(call.params)}`;
  }
  
  /**
   * Mark tool call as executing
   */
  markToolCallExecuting(callKey: string, toolCall: ParsedToolCall): void {
    const executing = new Map(this._executingToolCalls());
    executing.set(callKey, toolCall);
    this._executingToolCalls.set(executing);
    
    // Remove from pending
    const pending = this._pendingToolCalls().filter(c => this.generateCallKey(c) !== callKey);
    this._pendingToolCalls.set(pending);
    
    // Add to executed set to prevent re-execution
    const executed = new Set(this._executedToolCallKeys());
    executed.add(callKey);
    this._executedToolCallKeys.set(executed);
    
    this.transitionTo('tool-executing');
  }
  
  /**
   * Mark tool call as completed
   */
  markToolCallCompleted(callKey: string, result: ToolResult): void {
    // Remove from executing
    const executing = new Map(this._executingToolCalls());
    executing.delete(callKey);
    this._executingToolCalls.set(executing);
    
    // Add to results
    const results = new Map(this._toolExecutionResults());
    results.set(callKey, result);
    this._toolExecutionResults.set(results);
    
    // Update state
    if (executing.size === 0) {
      // All tools completed
      this.transitionTo('results-ready');
    }
  }
  
  /**
   * Mark response as processed (for deduplication)
   */
  markResponseProcessed(hash: string): void {
    const processed = new Set(this._processedResponseHashes());
    processed.add(hash);
    this._processedResponseHashes.set(processed);
  }
  
  /**
   * Set messages (used when loading conversation)
   */
  setMessages(messages: OllamaMessage[]): void {
    this._messages.set([...messages]);
  }
  
  /**
   * Add message (with deduplication)
   */
  addMessage(message: OllamaMessage): void {
    const messages = this._messages();
    const lastMessage = messages[messages.length - 1];
    
    // Check for duplicates
    if (lastMessage && 
        lastMessage.role === message.role && 
        lastMessage.content === message.content) {
      return;
    }
    
    this._messages.set([...messages, message]);
  }
  
  /**
   * Append to last assistant message (for tool results)
   */
  appendToLastAssistantMessage(additionalContent: string): boolean {
    const messages = this._messages();
    if (messages.length === 0) return false;
    
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role === 'assistant') {
      if (lastMessage.content.includes(additionalContent.substring(0, 50))) {
        return false;
      }
      
      const updatedMessages = [...messages];
      updatedMessages[updatedMessages.length - 1] = {
        ...lastMessage,
        content: lastMessage.content + additionalContent
      };
      this._messages.set(updatedMessages);
      return true;
    }
    
    return false;
  }
  
  /**
   * Set error
   */
  setError(error: string | null): void {
    this._error.set(error);
    if (error) {
      this.transitionTo('error');
    }
  }
  
  /**
   * State machine transitions
   */
  private transitionTo(newState: ConversationState): void {
    const currentState = this._conversationState();
    
    // Validate transition
    const validTransitions: Record<ConversationState, ConversationState[]> = {
      'idle': ['streaming', 'error'],
      'streaming': ['tool-detected', 'idle', 'error'],
      'tool-detected': ['tool-executing', 'error'],
      'tool-executing': ['results-ready', 'tool-executing', 'error'],
      'results-ready': ['awaiting-followup', 'idle', 'streaming', 'error'],
      'awaiting-followup': ['idle', 'streaming', 'error'],
      'error': ['idle']
    };
    
    if (validTransitions[currentState]?.includes(newState)) {
      this._conversationState.set(newState);
    } else {
      // Allow error state from any state
      if (newState === 'error') {
        this._conversationState.set(newState);
      }
    }
  }
  
}
