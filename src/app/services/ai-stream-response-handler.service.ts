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

export type ProcessStreamResult =
  | { done: true }
  | { startContinuation: { editorId: string; summary: string } };

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
  parseResponseContent(raw: string): { cleanedResponse: string; toolCalls: ParsedToolCall[] } {
    const structuredAct = this.aiService.parseStructuredActResponse(raw);
    if (structuredAct) {
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
      return { cleanedResponse, toolCalls };
    }
    const contentOnly = this.aiService.parseStructuredContentResponse(raw);
    if (contentOnly !== null) {
      return { cleanedResponse: contentOnly, toolCalls: [] };
    }
    const toolCalls = this.toolCallParser.parseToolCalls(raw);
    if (toolCalls.length > 0 && this.toolCallParser.hasCompleteToolCalls(raw)) {
      const cleanedResponse = this.toolCallParser.removeToolCallJsonFromResponse(raw, toolCalls);
      return { cleanedResponse, toolCalls };
    }
    const standaloneToolCallPattern = /\{\s*"tool"\s*:\s*"[^"]+"\s*,\s*"params"\s*:\s*\{[\s\S]*?\}\s*\}/g;
    const cleanedResponse = raw.replace(standaloneToolCallPattern, '').trim();
    return { cleanedResponse, toolCalls: [] };
  }

  /**
   * Process a stream end response: parse, update plan, add messages, execute tools.
   * Returns either done or instructions to start a continuation stream.
   */
  async processResponse(raw: string, context: StreamResponseContext): Promise<ProcessStreamResult> {
    const hash = this.hashString(raw);
    if (this.conversationState.hasProcessedResponse(hash)) {
      return { done: true };
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

    const { cleanedResponse: parsedCleaned, toolCalls } = this.parseResponseContent(raw);
    let cleanedResponse = parsedCleaned;

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
        return { startContinuation: { editorId: conv.editorId, summary } };
      }
    }

    if (toolCalls.length > 0 && activeConversation && newCalls.length === 0) {
      this.conversationState.clearPendingToolCalls();
      const summaryFromExecuted =
        this.toolExecutionManager.getToolResultsSummary(toolCalls) ||
        `Tools executed: ${toolCalls.map((c) => c.tool).join(', ')}. Continue with your response.`;
      return { startContinuation: { editorId: activeConversation.editorId, summary: summaryFromExecuted } };
    }

    return { done: true };
  }
}
