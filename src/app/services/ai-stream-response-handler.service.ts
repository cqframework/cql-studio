// Author: Preston Lee

import { Injectable } from '@angular/core';
import { AiService } from './ai.service';
import { ToolCallParserService, ParsedToolCall } from './tool-call-parser.service';
import { ConversationManagerService, Conversation } from './conversation-manager.service';
import { AiConversationStateService } from './ai-conversation-state.service';
import { AiToolExecutionManagerService } from './ai-tool-execution-manager.service';
import { IdeStateService } from './ide-state.service';
import { ToolResult } from './tool-orchestrator.service';

export interface StreamResponseContext {
  isMainStream: boolean;
  getActiveConversation: () => Conversation | null;
  executeToolCalls: (calls: ParsedToolCall[]) => Promise<ToolResult[]>;
  currentMode: () => 'plan' | 'act';
}

export type ProcessReason = 'new_tool_calls' | 'duplicate_tool_calls' | 'final_answer' | 'invalid_contract';
export type ProgressDelta = 'made_progress' | 'no_progress';

export type ProcessStreamResult =
  | { done: true; reason: ProcessReason; progressDelta: ProgressDelta }
  | {
    startContinuation: { editorId: string; summary: string };
    reason: ProcessReason;
    progressDelta: ProgressDelta;
  };

/**
 * Centralizes parsing and processing of AI stream responses (main, continuation, recursive).
 * Reduces duplication across handleMainStreamResponse, handleContinuationStreamResponse,
 * and handleRecursiveContinuationStreamResponse.
 */
@Injectable({
  providedIn: 'root'
})
export class AiStreamResponseHandlerService {
  constructor(
    private aiService: AiService,
    private toolCallParser: ToolCallParserService,
    private conversationManager: ConversationManagerService,
    private conversationState: AiConversationStateService,
    private toolExecutionManager: AiToolExecutionManagerService,
    private ideStateService: IdeStateService
  ) { }

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash.toString();
  }

  /**
   * Parse raw response into display text and tool calls (shared by all stream handlers).
   */
  parseResponseContent(
    raw: string,
    mode: 'plan' | 'act'
  ): { cleanedResponse: string; toolCalls: ParsedToolCall[]; invalidActContract: boolean } {
    if (mode === 'act') {
      const structuredActDetailed = this.aiService.parseStructuredActResponseDetailed(raw);
      if (structuredActDetailed.status === 'valid' && structuredActDetailed.response) {
        const structuredAct = structuredActDetailed.response;
        let cleanedResponse = structuredAct.comment.trim();
        const toolCalls: ParsedToolCall[] = [];
        if (structuredAct.tool_call) {
          cleanedResponse += `\n[Tool: ${structuredAct.tool_call.tool}]`;
          toolCalls.push({
            tool: structuredAct.tool_call.tool,
            params: structuredAct.tool_call.params,
            raw: JSON.stringify({
              tool: structuredAct.tool_call.tool,
              params: structuredAct.tool_call.params
            })
          });
        }
        return { cleanedResponse, toolCalls, invalidActContract: false };
      }
      if (structuredActDetailed.status === 'invalid') {
        return { cleanedResponse: '', toolCalls: [], invalidActContract: true };
      }
    }
    const contentOnly = this.aiService.parseStructuredContentResponse(raw);
    if (contentOnly !== null) {
      return { cleanedResponse: contentOnly, toolCalls: [], invalidActContract: false };
    }
    const toolCalls = this.toolCallParser.parseToolCalls(raw);
    if (toolCalls.length > 0 && this.toolCallParser.hasCompleteToolCalls(raw)) {
      const cleanedResponse = this.toolCallParser.removeToolCallJsonFromResponse(raw, toolCalls);
      return { cleanedResponse, toolCalls, invalidActContract: false };
    }
    const standaloneToolCallPattern = /\{\s*"tool"\s*:\s*"[^"]+"\s*,\s*"params"\s*:\s*\{[\s\S]*?\}\s*\}/g;
    const cleanedResponse = raw.replace(standaloneToolCallPattern, '').trim();
    return { cleanedResponse, toolCalls: [], invalidActContract: false };
  }

  /**
   * Process a stream end response: parse, update plan, add messages, execute tools.
   * Returns either done or instructions to start a continuation stream.
   */
  async processResponse(raw: string, context: StreamResponseContext): Promise<ProcessStreamResult> {
    const hash = this.hashString(raw);
    if (this.conversationState.hasProcessedResponse(hash)) {
      return { done: true, reason: 'final_answer', progressDelta: 'no_progress' };
    }
    this.conversationState.markResponseProcessed(hash);
    const activeConversation = context.getActiveConversation();

    let planFound = false;
    if (activeConversation && context.currentMode() === 'plan') {
      const plan = this.aiService.parsePlan(raw);
      if (plan) {
        this.conversationManager.updatePlan(activeConversation.id, plan);
        planFound = true;
      }
    }

    const {
      cleanedResponse: parsedCleaned,
      toolCalls,
      invalidActContract
    } = this.parseResponseContent(raw, context.currentMode());
    let cleanedResponse = parsedCleaned;

    if (invalidActContract) {
      if (activeConversation) {
        return {
          startContinuation: {
            editorId: activeConversation.editorId,
            summary: 'Your previous response did not match the required JSON contract. Respond with exactly one of: {"comment":"...","next_action":"tool","tool_call":{"tool":"...","params":{...}}} or {"comment":"...","next_action":"final"}.'
          },
          reason: 'invalid_contract',
          progressDelta: 'no_progress'
        };
      }
      return { done: true, reason: 'invalid_contract', progressDelta: 'no_progress' };
    }

    const newCalls =
      toolCalls.length > 0
        ? this.conversationState.addToolCalls(toolCalls, (c) =>
          this.toolExecutionManager.getCallKey(c)
        )
        : [];

    if (context.isMainStream && this.conversationState.isStreaming()) {
      this.conversationState.endStreaming();
    }
    if (context.isMainStream && toolCalls.length > 0) {
      for (const toolCall of toolCalls) {
        if (toolCall.raw) {
          let formattedJson = toolCall.raw;
          try {
            formattedJson = JSON.stringify(JSON.parse(toolCall.raw), null, 2);
          } catch {
            // keep as-is
          }
          this.ideStateService.addJsonOutput(`Tool Call: ${toolCall.tool}`, formattedJson, 'pending');
        }
      }
    }

    if (activeConversation && context.currentMode() === 'plan' && planFound && raw.trim().startsWith('{')) {
      cleanedResponse = this.aiService.formatStructuredContentForDisplay(raw);
    }

    const trimmed = cleanedResponse?.trim() ?? '';
    let addedMessage = false;
    if (activeConversation && trimmed.length > 0) {
      const sanitized = this.aiService.sanitizeMessageContent(cleanedResponse);
      if (sanitized.trim().length > 0) {
        this.conversationManager.addAssistantMessage(activeConversation.id, sanitized);
        if (context.isMainStream) {
          this.conversationManager.completeStreaming(activeConversation.id);
        }
        addedMessage = true;
      }
    }
    if (planFound && activeConversation && !addedMessage) {
      this.conversationManager.addAssistantMessage(
        activeConversation.id,
        "I've created a plan based on the investigation results. Review it below and click \"Execute\" when ready to proceed."
      );
    }

    if (newCalls.length > 0) {
      try {
        await context.executeToolCalls(newCalls);
      } catch (error) {
        console.error('[StreamHandler] Error during tool execution:', error);
      }
      this.conversationState.updateStateForExecutionStatus();
      this.conversationState.clearPendingToolCalls();
      const conv = context.getActiveConversation();
      if (conv) {
        const summary =
          this.toolExecutionManager.getToolResultsSummary(newCalls) ||
          `Tools executed: ${newCalls.map((c) => c.tool).join(', ')}. Continue with your response.`;
        return {
          startContinuation: { editorId: conv.editorId, summary },
          reason: 'new_tool_calls',
          progressDelta: 'made_progress'
        };
      }
    }

    if (toolCalls.length > 0 && activeConversation && newCalls.length === 0) {
      this.conversationState.clearPendingToolCalls();
      const summaryFromExecuted =
        this.toolExecutionManager.getToolResultsSummary(toolCalls) ||
        `Tools executed: ${toolCalls.map((c) => c.tool).join(', ')}. Continue with your response.`;
      return {
        startContinuation: { editorId: activeConversation.editorId, summary: summaryFromExecuted },
        reason: 'duplicate_tool_calls',
        progressDelta: 'no_progress'
      };
    }

    return { done: true, reason: 'final_answer', progressDelta: 'made_progress' };
  }
}
