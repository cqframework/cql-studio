// Author: Preston Lee

import { Injectable } from '@angular/core';
import { Observable, of, throwError, Subject, firstValueFrom } from 'rxjs';
import { catchError, tap, timeout } from 'rxjs/operators';
import { ToolOrchestratorService, ToolResult } from './tool-orchestrator.service';
import { ParsedToolCall } from './tool-call-parser.service';
import { AiConversationStateService } from './ai-conversation-state.service';
import { AiPlanningService } from './ai-planning.service';
import { AiService } from './ai.service';
import { ToolPolicyService } from './tool-policy.service';
import { ConversationManagerService } from './conversation-manager.service';
import { IdeStateService } from './ide-state.service';
import { PlanStep } from '../models/plan.model';
import { InsertCodeTool, ReplaceCodeTool } from './tools';

export interface ToolExecutionEvent {
  type: 'started' | 'completed' | 'failed';
  callKey: string;
  toolCall: ParsedToolCall;
  result?: ToolResult;
  error?: string;
}

export interface ExecuteToolCallsOptions {
  conversationId?: string;
  planSteps?: PlanStep[];
  onResult?: (toolCall: ParsedToolCall, result: ToolResult) => void;
  timeoutMs?: number;
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
  private readonly MAX_TOOL_RETRY_ATTEMPTS = 1;
  private readonly TOOL_RESULTS_SUMMARY_CHAR_LIMIT = 2000;
  
  constructor(
    private toolOrchestrator: ToolOrchestratorService,
    private stateService: AiConversationStateService,
    private planningService: AiPlanningService,
    private toolPolicyService: ToolPolicyService,
    private aiService: AiService,
    private conversationManager: ConversationManagerService,
    private ideStateService: IdeStateService
  ) {}
  
  /**
   * Generate unique key for a tool call (stable regardless of param key order)
   */
  getCallKey(toolCall: ParsedToolCall): string {
    const params = toolCall.params && typeof toolCall.params === 'object' ? toolCall.params : {};
    const stableParams = this.stableStringify(params);
    return `${toolCall.tool}:${stableParams}`;
  }

  private stableStringify(obj: unknown): string {
    if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
    if (Array.isArray(obj)) return JSON.stringify(obj);
    const keys = Object.keys(obj as object).sort();
    const pairs = keys.map(k => `${JSON.stringify(k)}:${this.stableStringify((obj as Record<string, unknown>)[k])}`);
    return `{${pairs.join(',')}}`;
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
    if ((toolCall.tool === InsertCodeTool.id || toolCall.tool === ReplaceCodeTool.id)) {
      const code = toolCall.params['code'];
      if (!code || typeof code !== 'string') {
        return { valid: false, error: `${toolCall.tool} requires a 'code' parameter` };
      }
    }
    
    // Check mode restrictions (Plan Mode blocks modification tools)
    const conversation = this.conversationManager.activeConversation();
    if (conversation?.mode === 'plan') {
      const blockedTools = this.toolPolicyService.getPlanModeBlockedTools(
        this.aiService.getCachedServerMCPTools()
      );
      const modeValidation = this.planningService.validateToolCallForMode(
        toolCall.tool,
        'plan',
        { blockedTools }
      );
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
   * Execute tool calls serially and return a Promise. Supports plan step updates and IDE logging.
   */
  async executeToolCallsAsPromise(
    toolCalls: ParsedToolCall[],
    options: ExecuteToolCallsOptions = {}
  ): Promise<ToolResult[]> {
    if (toolCalls.length === 0) return [];
    const { conversationId, planSteps, onResult, timeoutMs = 25000 } = options;
    const results: ToolResult[] = [];

    for (let index = 0; index < toolCalls.length; index++) {
      const toolCall = toolCalls[index];
      if (conversationId && planSteps && planSteps[index]) {
        const callKey = this.getCallKey(toolCall);
        this.conversationManager.updatePlanStepStatus(
          conversationId,
          planSteps[index].id,
          'in-progress',
          callKey
        );
      }

      try {
        const result = await this.executeToolCallWithRetry(
          toolCall,
          timeoutMs,
          this.MAX_TOOL_RETRY_ATTEMPTS
        );
        results.push(result);
        onResult?.(toolCall, result);
        const resultJson = JSON.stringify(
          { tool: toolCall.tool, success: result.success, result: result.result, error: result.error },
          null,
          2
        );
        this.ideStateService.addJsonOutput(
          `Tool Execution Result: ${toolCall.tool}`,
          resultJson,
          result.success ? 'success' : 'error'
        );
        if (conversationId && planSteps && planSteps[index]) {
          this.conversationManager.updatePlanStepStatus(
            conversationId,
            planSteps[index].id,
            result.success ? 'completed' : 'failed'
          );
        }
      } catch (error: unknown) {
        const err = error as { message?: string; isValidationError?: boolean };
        if (!err?.isValidationError) {
          console.error(`[ToolManager] Tool execution error for ${toolCall.tool}:`, error);
        }
        const errorResult: ToolResult = {
          tool: toolCall.tool,
          success: false,
          error: err?.message ?? 'Tool execution failed'
        };
        results.push(errorResult);
        onResult?.(toolCall, errorResult);
        const errorJson = JSON.stringify(
          { tool: toolCall.tool, success: false, error: errorResult.error },
          null,
          2
        );
        this.ideStateService.addJsonOutput(`Tool Execution Error: ${toolCall.tool}`, errorJson, 'error');
        if (conversationId && planSteps && planSteps[index]) {
          this.conversationManager.updatePlanStepStatus(
            conversationId,
            planSteps[index].id,
            'failed'
          );
        }
      }
    }
    return results;
  }

  private async executeToolCallWithRetry(
    toolCall: ParsedToolCall,
    timeoutMs: number,
    maxRetries: number
  ): Promise<ToolResult> {
    const callKey = this.getCallKey(toolCall);
    let attempt = 0;
    while (attempt <= maxRetries) {
      try {
        const result = attempt === 0
          ? await firstValueFrom(this.executeToolCall(toolCall).pipe(timeout(timeoutMs)))
          : await this.executeRetryAttempt(toolCall, callKey, timeoutMs);

        if (result.success || attempt >= maxRetries || !this.isTransientToolFailure(result.error)) {
          return result;
        }

        attempt += 1;
        this.ideStateService.addWarningOutput(
          'AI tool retry',
          `Retrying ${toolCall.tool} (${attempt}/${maxRetries}) due to transient failure.`
        );
      } catch (error: unknown) {
        const err = error as { message?: string; isValidationError?: boolean };
        if (err?.isValidationError) {
          throw error;
        }

        const transientFailure = this.isTransientToolFailure(err?.message);
        if (!transientFailure || attempt >= maxRetries) {
          throw error;
        }

        const timeoutResult: ToolResult = {
          tool: toolCall.tool,
          success: false,
          error: err?.message ?? 'Tool execution timed out'
        };
        this.stateService.markToolCallCompleted(callKey, timeoutResult);
        this.executionEvents$.next({
          type: 'failed',
          callKey,
          toolCall,
          result: timeoutResult,
          error: timeoutResult.error
        });

        attempt += 1;
        this.ideStateService.addWarningOutput(
          'AI tool retry',
          `Retrying ${toolCall.tool} (${attempt}/${maxRetries}) after transient error: ${timeoutResult.error}`
        );
      }
    }

    return {
      tool: toolCall.tool,
      success: false,
      error: `Tool execution failed after ${maxRetries + 1} attempts`
    };
  }

  private async executeRetryAttempt(
    toolCall: ParsedToolCall,
    callKey: string,
    timeoutMs: number
  ): Promise<ToolResult> {
    const retryResult = await firstValueFrom(
      this.toolOrchestrator.executeToolCall(toolCall.tool, toolCall.params).pipe(
        timeout(timeoutMs),
        catchError((error: unknown) =>
          of({
            tool: toolCall.tool,
            success: false,
            error: (error as { message?: string })?.message ?? 'Tool execution failed'
          })
        )
      )
    );

    this.stateService.markToolCallCompleted(callKey, retryResult);
    this.executionEvents$.next({
      type: retryResult.success ? 'completed' : 'failed',
      callKey,
      toolCall,
      result: retryResult,
      error: retryResult.error
    });
    return retryResult;
  }

  private isTransientToolFailure(errorMessage?: string): boolean {
    if (!errorMessage) {
      return false;
    }
    const message = errorMessage.toLowerCase();
    return (
      message.includes('timeout') ||
      message.includes('timed out') ||
      message.includes('network') ||
      message.includes('failed to fetch') ||
      message.includes('econn') ||
      /\b(429|500|502|503|504)\b/.test(message)
    );
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
          const truncatedResult = resultStr.length > this.TOOL_RESULTS_SUMMARY_CHAR_LIMIT
            ? resultStr.substring(0, this.TOOL_RESULTS_SUMMARY_CHAR_LIMIT) + '...'
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
