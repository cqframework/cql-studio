// Author: Preston Lee

import { Injectable } from '@angular/core';
import { Observable, of, throwError, Subject } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { ToolOrchestratorService, ToolResult } from './tool-orchestrator.service';
import { ParsedToolCall } from './tool-call-parser.service';
import { AiConversationStateService } from './ai-conversation-state.service';
import { AiPlanningService } from './ai-planning.service';
import { ConversationManagerService } from './conversation-manager.service';

export interface ToolExecutionEvent {
  type: 'started' | 'completed' | 'failed';
  callKey: string;
  toolCall: ParsedToolCall;
  result?: ToolResult;
  error?: string;
}

/**
 * Manages tool execution with queue, validation, and tracking
 * Extracted from component to separate concerns
 */
@Injectable({
  providedIn: 'root'
})
export class AiToolExecutionManagerService {
  private executionEvents$ = new Subject<ToolExecutionEvent>();
  public executionEvents = this.executionEvents$.asObservable();
  
  constructor(
    private toolOrchestrator: ToolOrchestratorService,
    private stateService: AiConversationStateService,
    private planningService: AiPlanningService,
    private conversationManager: ConversationManagerService
  ) {}
  
  /**
   * Generate unique key for a tool call
   */
  getCallKey(toolCall: ParsedToolCall): string {
    return `${toolCall.tool}:${JSON.stringify(toolCall.params)}`;
  }
  
  /**
   * Validate tool call before execution
   */
  validateToolCall(toolCall: ParsedToolCall): { valid: boolean; error?: string } {
    if (!toolCall.tool || typeof toolCall.tool !== 'string') {
      return { valid: false, error: 'Tool name is required and must be a string' };
    }
    
    if (!toolCall.params || typeof toolCall.params !== 'object') {
      return { valid: false, error: 'Tool params must be an object' };
    }
    
    // Validate code editing tools have code
    if ((toolCall.tool === 'insert_code' || toolCall.tool === 'replace_code')) {
      const code = toolCall.params['code'];
      if (!code || typeof code !== 'string') {
        return { valid: false, error: `${toolCall.tool} requires a 'code' parameter` };
      }
    }
    
    // Check mode restrictions (Plan Mode blocks modification tools)
    const conversation = this.conversationManager.activeConversation();
    if (conversation?.mode === 'plan') {
      const modeValidation = this.planningService.validateToolCallForMode(toolCall.tool, 'plan');
      if (!modeValidation.allowed) {
        return { valid: false, error: modeValidation.reason };
      }
    }
    
    return { valid: true };
  }
  
  /**
   * Execute a tool call
   * Following Cline's pattern: prevents duplicate execution via atomic checks
   * and tracks state to handle race conditions
   */
  executeToolCall(toolCall: ParsedToolCall): Observable<ToolResult> {
    const callKey = this.getCallKey(toolCall);
    
    // Atomic check: prevent duplicate execution (Cline pattern)
    // Check executed calls first (most common case)
    if (this.stateService.hasExecutedToolCall(callKey)) {
      const existingResult = this.stateService.toolExecutionResults().get(callKey);
      if (existingResult) {
        // Return existing result immediately (idempotent)
        return of(existingResult);
      }
      return throwError(() => new Error('Tool call already executed but no result found'));
    }
    
    // Double-check: verify not currently executing (race condition protection)
    const executing = this.stateService.executingToolCalls();
    if (executing.has(callKey)) {
      // Already executing - wait for result (could return existing Observable if we tracked them)
      return throwError(() => new Error('Tool call is already executing'));
    }
    
    // Validate
    const validation = this.validateToolCall(toolCall);
    if (!validation.valid) {
      const errorResult: ToolResult = {
        tool: toolCall.tool,
        success: false,
        error: validation.error
      };
      this.stateService.markToolCallCompleted(callKey, errorResult);
      const validationError = new Error(validation.error);
      // Mark as validation error to distinguish from execution errors
      (validationError as any).isValidationError = true;
      return throwError(() => validationError);
    }
    
    // Mark as executing atomically (prevents race conditions)
    // This must happen before Observable creation to prevent duplicate subscriptions
    this.stateService.markToolCallExecuting(callKey, toolCall);
    this.executionEvents$.next({ type: 'started', callKey, toolCall });
    
    return this.toolOrchestrator.executeToolCall(toolCall.tool, toolCall.params).pipe(
      tap(result => {
        this.stateService.markToolCallCompleted(callKey, result);
        this.executionEvents$.next({ 
          type: result.success ? 'completed' : 'failed',
          callKey,
          toolCall,
          result
        });
      }),
      catchError(error => {
        // Only log actual execution errors, not validation errors (e.g., Plan Mode restrictions)
        const isValidationError = (error as any)?.isValidationError === true;
        if (!isValidationError) {
          console.error(`[ToolManager] Tool execution error: ${toolCall.tool}`, error);
        }
        const errorResult: ToolResult = {
          tool: toolCall.tool,
          success: false,
          error: error.message || 'Tool execution failed'
        };
        this.stateService.markToolCallCompleted(callKey, errorResult);
        this.executionEvents$.next({
          type: 'failed',
          callKey,
          toolCall,
          result: errorResult,
          error: error.message
        });
        return of(errorResult);
      })
    );
  }
  
  /**
   * Execute multiple tool calls in sequence
   */
  executeToolCalls(toolCalls: ParsedToolCall[]): Observable<ToolResult[]> {
    if (toolCalls.length === 0) {
      return of([]);
    }
    
    const results: ToolResult[] = [];
    let currentIndex = 0;
    
    return new Observable(observer => {
      const executeNext = () => {
        if (currentIndex >= toolCalls.length) {
          observer.next(results);
          observer.complete();
          return;
        }
        
        const toolCall = toolCalls[currentIndex];
        this.executeToolCall(toolCall).subscribe({
          next: (result) => {
            results.push(result);
            currentIndex++;
            executeNext();
          },
          error: (error) => {
            // Continue even if one fails
            results.push({
              tool: toolCall.tool,
              success: false,
              error: error.message || 'Execution failed'
            });
            currentIndex++;
            executeNext();
          }
        });
      };
      
      executeNext();
    });
  }
  
  /**
   * Cancel all executing tool calls
   */
  cancelAllExecutions(): void {
    // Note: Observable subscriptions would need to be cancelled individually
    // This is a placeholder - actual cancellation would require subscription tracking
    const executing = Array.from(this.stateService.executingToolCalls().keys());
    executing.forEach(callKey => {
      const errorResult: ToolResult = {
        tool: 'unknown',
        success: false,
        error: 'Cancelled by user'
      };
      this.stateService.markToolCallCompleted(callKey, errorResult);
    });
  }
  
  /**
   * Get aggregated tool results summary for a set of tool calls
   */
  getToolResultsSummary(toolCalls: ParsedToolCall[]): string {
    const resultsMap = this.stateService.toolExecutionResults();
    
    if (toolCalls.length === 0) {
      return '';
    }
    
    const summaries = toolCalls
      .map(call => {
        const callKey = this.getCallKey(call);
        const result = resultsMap.get(callKey);
        
        if (!result) {
          // Debug: log when results aren't found (might indicate callKey mismatch or timing issue)
          console.warn(`[ToolExecutionManager] No result found for tool call: ${call.tool}`, {
            callKey,
            availableKeys: Array.from(resultsMap.keys()),
            callParams: call.params
          });
          return null;
        }
        
        if (result.success) {
          const resultStr = JSON.stringify(result.result, null, 2);
          const truncatedResult = resultStr.length > 500 
            ? resultStr.substring(0, 500) + '...' 
            : resultStr;
          return `Tool ${call.tool} executed successfully:\n${truncatedResult}`;
        } else {
          return `Tool ${call.tool} failed: ${result.error}`;
        }
      })
      .filter(summary => summary !== null);
    
    return summaries.join('\n\n');
  }
}
