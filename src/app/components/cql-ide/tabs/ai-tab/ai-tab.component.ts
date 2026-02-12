// Author: Preston Lee

import { Component, input, output, computed, signal, viewChild, ElementRef, AfterViewChecked, AfterViewInit, OnInit, OnDestroy } from '@angular/core';
import { Subscription, BehaviorSubject } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MarkdownComponent } from 'ngx-markdown';
import { AiService } from '../../../../services/ai.service';
import { IdeStateService } from '../../../../services/ide-state.service';
import { SettingsService } from '../../../../services/settings.service';
import { ConversationManagerService, Conversation } from '../../../../services/conversation-manager.service';
import { ToolResult } from '../../../../services/tool-orchestrator.service';
import { ToolCallParserService, ParsedToolCall } from '../../../../services/tool-call-parser.service';
import { CodeDiffPreviewComponent, CodeDiff } from './code-diff-preview.component';
import { AiConversationStateService } from '../../../../services/ai-conversation-state.service';
import { AiToolExecutionManagerService } from '../../../../services/ai-tool-execution-manager.service';
import { AiStreamResponseHandlerService, StreamResponseContext } from '../../../../services/ai-stream-response-handler.service';
import { InsertCodeTool, ReplaceCodeTool } from '../../../../services/tools';
import { ToolPolicyService } from '../../../../services/tool-policy.service';
import { PlanDisplayComponent } from './plan-display.component';
import { TimeagoPipe } from 'ngx-timeago';

@Component({
  selector: 'app-ai-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, MarkdownComponent, CodeDiffPreviewComponent, PlanDisplayComponent, TimeagoPipe],
  templateUrl: './ai-tab.component.html',
  styleUrls: ['./ai-tab.component.scss']
})
export class AiTabComponent implements OnInit, AfterViewInit, AfterViewChecked, OnDestroy {
  messagesContainer = viewChild<ElementRef>('messagesContainer');
  scrollSentinel = viewChild<ElementRef>('scrollSentinel');
  cqlContent = input<string>('');
  replaceCqlCode = output<string>();
  insertCqlCode = output<string>();

  // Component state signals
  private _isLoading = signal(false);
  private _currentMessage = signal('');
  private _error = signal<string | null>(null);
  
  /** Connection test state: driven by Observable so template updates don't trigger ExpressionChangedAfterItHasBeenCheckedError */
  private _connectionTestResult = new BehaviorSubject<{ status: 'unknown' | 'testing' | 'connected' | 'error'; error: string; models: string[] }>({
    status: 'unknown',
    error: '',
    models: []
  });
  public connectionTestResult$ = this._connectionTestResult.asObservable();
  private _suggestedCommands = signal<string[]>([]);
  private _isLoadingSuggestions = signal<boolean>(false);
  private _codeDiffPreview = signal<CodeDiff | null>(null);
  private _showDiffPreview = signal<boolean>(false);
  private _resettingMCPTools = signal<boolean>(false);
  
  public currentMode = computed(() => {
    const conversation = this.activeConversation();
    return conversation?.mode || 'act';
  });
  
  private _currentSubscription: Subscription | null = null;
  private _lastMessageCount = 0;
  private _lastStreamingLength = 0;
  private _scrollRafId: number | null = null;
  private _userScrolledUp = false;
  private _intersectionObserver: IntersectionObserver | null = null;

  public isLoading = computed(() => this._isLoading());
  public currentMessage = computed(() => this._currentMessage());
  public error = computed(() => this._error());
  public useMCPTools = computed(() => this.settingsService.settings().useMCPTools);
  public activeConversation = computed(() => this.conversationManager.activeConversation());
  
  public activeConversationId = computed(() => this.activeConversation()?.id || null);
  public conversations = computed(() => this.conversationManager.conversations());
  public hasActiveConversation = computed(() => !!this.activeConversation());
  
  public canSendMessage = computed(() => 
    !this._isLoading() && this._currentMessage().trim().length > 0
  );
  public canStop = computed(() => 
    this._isLoading() || this.conversationState.isStreaming()
  );
  public canToggleMode = computed(() => 
    !this._isLoading() && !this.conversationState.isStreaming()
  );
  public isAiAvailable = computed(() => this.aiService.isAiAssistantAvailable());
  public streamingResponse = computed(() => this.conversationState.streamingResponse());
  public isStreaming = computed(() => this.conversationState.isStreaming());
  public suggestedCommands = computed(() => this._suggestedCommands());
  public isLoadingSuggestions = computed(() => this._isLoadingSuggestions());
  public pendingToolCalls = computed(() => this.conversationState.pendingToolCalls());
  public executingToolCalls = computed(() => this.conversationState.executingToolCalls());
  public toolExecutionResults = computed(() => this.conversationState.toolExecutionResults());
  public codeDiffPreview = computed(() => this._codeDiffPreview());
  public showDiffPreview = computed(() => this._showDiffPreview());
  public resettingMCPTools = computed(() => this._resettingMCPTools());
  public activePlan = computed(() => this.activeConversation()?.plan);
  public isPlanExecuting = computed(() => {
    const plan = this.activePlan();
    if (!plan) return false;
    return plan.steps.some(s => s.status === 'in-progress');
  });

  constructor(
    private aiService: AiService,
    public ideStateService: IdeStateService,
    public settingsService: SettingsService,
    private conversationManager: ConversationManagerService,
    private router: Router,
    private toolCallParser: ToolCallParserService,
    private conversationState: AiConversationStateService,
    private toolExecutionManager: AiToolExecutionManagerService,
    private streamHandler: AiStreamResponseHandlerService,
    private toolPolicyService: ToolPolicyService
  ) {
  }

  private getStreamResponseContext(isMainStream: boolean): StreamResponseContext {
    return {
      isMainStream,
      getActiveConversation: () => this.activeConversation(),
      executeToolCalls: (calls) => this.executeToolCallsWithOptions(calls),
      currentMode: () => this.currentMode()
    };
  }

  private async executeToolCallsWithOptions(toolCalls: ParsedToolCall[]): Promise<ToolResult[]> {
    const conv = this.activeConversation();
    const plan = conv?.plan;
    const options = {
      conversationId: conv?.id,
      planSteps: plan && this.currentMode() === 'act' ? plan.steps : undefined,
      onResult: (tc: ParsedToolCall, r: ToolResult) => this.handleToolResult(tc, r)
    };
    return this.toolExecutionManager.executeToolCallsAsPromise(toolCalls, options);
  }

  private finishResponse(): void {
    this.conversationState.endStreaming();
    this._isLoading.set(false);
    this._currentMessage.set('');
    this._currentSubscription = null;
  }

  ngOnInit(): void {
  }
  
  ngAfterViewInit(): void {
    setTimeout(() => {
      this.setupScrollSentinelObserver();
    }, 0);
  }

  ngOnDestroy(): void {
    if (this._currentSubscription) {
      this._currentSubscription.unsubscribe();
      this._currentSubscription = null;
    }
    
    if (this._intersectionObserver) {
      this._intersectionObserver.disconnect();
      this._intersectionObserver = null;
    }
    
    if (this._scrollRafId !== null) {
      cancelAnimationFrame(this._scrollRafId);
      this._scrollRafId = null;
    }
    
    if (this.messagesContainer()) {
      this.messagesContainer()!.nativeElement.removeEventListener('scroll', this.onUserScroll);
    }
  }

  onMessageChange(event: Event): void {
    const target = event.target as HTMLTextAreaElement;
    const value = target?.value || '';
    this._currentMessage.set(value);
    this._error.set(null);
    this.autoResizeTextarea(target);
  }

  private autoResizeTextarea(textarea: HTMLTextAreaElement): void {
    textarea.style.height = 'auto';
    const scrollHeight = textarea.scrollHeight;
    const maxHeight = 120;
    const minHeight = 36;
    
    if (scrollHeight > maxHeight) {
      textarea.style.height = maxHeight + 'px';
      textarea.style.overflowY = 'auto';
    } else if (scrollHeight < minHeight) {
      textarea.style.height = minHeight + 'px';
      textarea.style.overflowY = 'hidden';
    } else {
      textarea.style.height = scrollHeight + 'px';
      textarea.style.overflowY = 'hidden';
    }
  }

  public onStopRequest(): void {
    if (this._currentSubscription) {
      this._currentSubscription.unsubscribe();
      this._currentSubscription = null;
    }
    
    this._isLoading.set(false);
    this.conversationState.resetState();
  }

  public onKeyPress(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.onSendMessage();
    }
  }

  public onSelectConversation(conversationId: string): void {
    this.conversationManager.setActiveConversationById(conversationId);
    this._error.set(null);
  }

  public onNewConversation(): void {
    const active = this.activeConversation();
    if (active) {
      this.conversationManager.deleteConversation(active.id);
    }
    this.conversationState.resetState();
    this._currentMessage.set('');
    this._error.set(null);
  }

  public onDeleteConversation(conversationId: string): void {
    this.conversationManager.deleteConversation(conversationId);
  }

  public onClearAllConversations(): void {
    this.conversationManager.clearAllConversations();
    this.conversationState.resetState();
  }

  public onResetMCPTools(): void {
    this._resettingMCPTools.set(true);
    this.ideStateService.addInfoOutput('AI MCP tools', 'Reinitializing server MCP tools...');
    this.aiService.reinitializeServerMCPTools().subscribe({
      next: result => {
        this._resettingMCPTools.set(false);
        if (result.success) {
          this.ideStateService.addInfoOutput(
            'AI MCP tools',
            result.count !== undefined
              ? `Reinitialized server MCP tools. ${result.count} tool(s) loaded from CQL Studio Server.`
              : 'Reinitialized server MCP tools.'
          );
        } else {
          this.ideStateService.addWarningOutput('AI MCP tools', result.error ?? 'Reinitialization failed.');
        }
      },
      error: err => {
        this._resettingMCPTools.set(false);
        this.ideStateService.addErrorOutput('AI MCP tools', err?.message ?? 'Reinitialization failed.');
      }
    });
  }

  public onNavigateToSettings(): void {
    this.router.navigate(['/settings']);
  }

  public testConnection(): void {
    this._connectionTestResult.next({ status: 'testing', error: '', models: [] });
    this.aiService.testOllamaConnection().subscribe({
      next: (result) => {
        const status: 'connected' | 'error' | 'unknown' = result.connected ? 'connected' : (result.error ? 'error' : 'unknown');
        this._connectionTestResult.next({
          status,
          error: result.error || '',
          models: result.models || []
        });
      },
      error: (error) => {
        this._connectionTestResult.next({
          status: 'error',
          error: error.message,
          models: []
        });
      }
    });
  }

  public getContextHistory(): Conversation[] {
    const editorContext = this.conversationManager.getCurrentEditorContext();
    const allConversations = this.conversationManager.conversations();
    return allConversations.filter(c => c.editorId === editorContext.editorId);
  }

  public getContextDisplayName(conversation: Conversation): string {
    if (conversation.libraryName) {
      return `CQL: ${conversation.libraryName}`;
    } else if (conversation.fileName) {
      return `File: ${conversation.fileName}`;
    } else {
      return conversation.title;
    }
  }

  public onSwitchToEditorContext(editorId: string): void {
    this.conversationManager.switchToEditor(editorId);
  }

  public filterToolResultsFromMessage(content: string): string {
    return this.aiService.sanitizeMessageContent(content);
  }

  public shouldPulsate(): boolean {
    return this.conversationState.isStreaming() || 
           this.conversationState.pendingToolCalls().length > 0 ||
           this.conversationState.executingToolCalls().size > 0;
  }

  public getToolExecutionStatus(): string {
    const pending = this.conversationState.pendingToolCalls();
    const executing = this.conversationState.executingToolCalls();
    
    if (executing.size > 0) {
      const tools = Array.from(executing.values()).map(c => c.tool).join(', ');
      return `Executing: ${tools}`;
    } else if (pending.length > 0) {
      const tools = pending.map(c => c.tool).join(', ');
      return `Pending: ${tools}`;
    }
    return '';
  }

  public onCancelToolExecutions(): void {
    this.toolExecutionManager.cancelAllExecutions();
  }

  public onApproveCodeDiff(): void {
    const diff = this._codeDiffPreview();
    if (diff) {
      this.replaceCqlCode.emit(diff.after);
      this._showDiffPreview.set(false);
      this._codeDiffPreview.set(null);
    }
  }

  public onRejectCodeDiff(): void {
    this._showDiffPreview.set(false);
    this._codeDiffPreview.set(null);
  }

  public toggleMode(): void {
    if (!this.canToggleMode()) {
      return;
    }
    
    const conversation = this.activeConversation();
    if (!conversation) {
      return;
    }
    
    const newMode: 'plan' | 'act' = conversation.mode === 'plan' ? 'act' : 'plan';
    this.conversationManager.updateConversationMode(conversation.id, newMode);
  }

  public onRefreshSuggestions(): void {
    this.loadSuggestedCommands();
  }

  public onSuggestedCommandClick(command: string): void {
    this._currentMessage.set(command);
    this.onSendMessage();
  }

  private handleToolResult(toolCall: ParsedToolCall, result: ToolResult): void {
    if (toolCall.tool === InsertCodeTool.id || toolCall.tool === ReplaceCodeTool.id) {
      let code = '';
      if (toolCall.params && toolCall.params['code']) {
        code = typeof toolCall.params['code'] === 'string' 
          ? toolCall.params['code'] 
          : String(toolCall.params['code']);
      }
      
      if (!code || code.trim().length === 0) {
        console.warn('[handleToolResult] No code found in tool call params', toolCall);
        return;
      }

      if (toolCall.tool === ReplaceCodeTool.id) {
        const currentCode = this.cqlContent() || '';
        const autoApply = this.settingsService.settings().autoApplyCodeEdits && 
                         !this.settingsService.settings().requireDiffPreview;
        
        if (autoApply) {
          this.replaceCqlCode.emit(code);
        } else {
          const diff: CodeDiff = {
            before: currentCode,
            after: code,
            title: 'Replace Code',
            description: 'Code replacement preview'
          };
          this._codeDiffPreview.set({ ...diff });
          this._showDiffPreview.set(true);
        }
      } else if (toolCall.tool === InsertCodeTool.id) {
        const autoApply = this.settingsService.settings().autoApplyCodeEdits && 
                         !this.settingsService.settings().requireDiffPreview;
        
        if (autoApply) {
          const currentCode = this.cqlContent() || '';
          this.replaceCqlCode.emit(currentCode + '\n' + code);
        } else {
          const currentCode = this.cqlContent() || '';
          const diff: CodeDiff = {
            before: currentCode,
            after: currentCode + '\n' + code,
            title: 'Insert Code',
            description: 'Code insertion preview'
          };
          this._codeDiffPreview.set({ ...diff });
          this._showDiffPreview.set(true);
        }
      }
    }
  }

  public onSendMessage(): void {
    const message = this._currentMessage().trim();
    
    if (!message || this._isLoading()) {
      return;
    }

    this._suggestedCommands.set([]);
    this.conversationState.resetState();
    this._isLoading.set(true);
    this._error.set(null);

    const editorContext = this.conversationManager.getCurrentEditorContext();
    const editorId = editorContext?.editorId;
    
    if (this._currentSubscription) {
      this._currentSubscription.unsubscribe();
      this._currentSubscription = null;
    }
    
    const mode = this.currentMode();
    const subscription = this.aiService.sendStreamingMessage(
      message,
      editorId,
      this.useMCPTools(),
      this.cqlContent(),
      undefined,
      mode
    );
    
    this._currentSubscription = subscription.subscribe({
      next: async (event) => {
        if (event.type === 'start') {
          this.conversationState.startStreaming();
        } else if (event.type === 'chunk') {
          const chunkContent = event.content || '';
          if (chunkContent.length > 0) {
            this.conversationState.addStreamingChunk(chunkContent);
          }
        } else if (event.type === 'end') {
          const finalResponse = (event as { fullResponse?: string }).fullResponse ?? this.conversationState.streamingResponse();
          await this.handleMainStreamResponse(finalResponse);
        }
      },
      error: (err: any) => {
        console.error('Streaming error:', err);
        this._isLoading.set(false);
        
        let errorMessage = 'Failed to send message';
        if (err?.message) {
          errorMessage = err.message;
        } else if (err instanceof TypeError && err.message === 'Failed to fetch') {
          errorMessage = 'Unable to connect to Ollama server. Please check your settings and ensure the server is running.';
        }
        
        this.conversationState.setError(errorMessage);
        this.conversationState.endStreaming();
        this._error.set(errorMessage);
        this._currentSubscription = null;
      },
      complete: (): void => {
        this._currentSubscription = null;
      }
    });
  }

  public onReplaceCode(code: string): void {
    this.replaceCqlCode.emit(code);
  }

  private loadSuggestedCommands(): void {
    const conv = this.activeConversation();
    if (conv && conv.uiMessages.length > 0) {
      this._suggestedCommands.set([]);
      return;
    }

    this._isLoadingSuggestions.set(true);
    this._suggestedCommands.set([]);

    this.aiService.generateSuggestedCommands(this.cqlContent() ?? '').subscribe({
      next: (commands) => {
        this._suggestedCommands.set(commands);
        this._isLoadingSuggestions.set(false);
      },
      error: (error) => {
        this._suggestedCommands.set([]);
        this._isLoadingSuggestions.set(false);
      }
    });
  }

  public ngAfterViewChecked(): void {
    if (!this.messagesContainer()) {
      return;
    }

    const conversation = this.activeConversation();
    const messageCount = conversation?.uiMessages?.length || 0;
    const streamingLength = this.conversationState.streamingResponse().length;
    const isStreaming = this.conversationState.isStreaming();
    const hasToolCalls = this.conversationState.pendingToolCalls().length > 0;
    
    if (messageCount > this._lastMessageCount || 
        (isStreaming && streamingLength > this._lastStreamingLength) ||
        hasToolCalls) {
      this._lastMessageCount = messageCount;
      this._lastStreamingLength = streamingLength;
      const shouldAutoScroll = !this._userScrolledUp || messageCount > this._lastMessageCount;
      
      if (shouldAutoScroll) {
        this.scheduleScroll();
      }
    }
  }
  
  private setupScrollSentinelObserver(): void {
    setTimeout(() => {
      if (!this.messagesContainer() || !this.scrollSentinel()) {
        return;
      }
      
      const container = this.messagesContainer()!.nativeElement;
      const sentinel = this.scrollSentinel()?.nativeElement;
      
      if (!container || !sentinel) {
        return;
      }
      
      container.addEventListener('scroll', this.onUserScroll);
      
      this._intersectionObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach(entry => {
            const isNearBottom = entry.isIntersecting || 
                                 (entry.boundingClientRect.top - container.clientHeight) < 100;
            
            if (isNearBottom && !this.conversationState.isStreaming()) {
              this._userScrolledUp = false;
            }
          });
        },
        {
          root: container,
          rootMargin: '0px 0px 100px 0px',
          threshold: [0, 1]
        }
      );
      
      this._intersectionObserver.observe(sentinel);
    }, 100);
  }
  
  private onUserScroll = (): void => {
    if (!this.messagesContainer()) {
      return;
    }
    
    const container = this.messagesContainer()!.nativeElement;
    const scrollTop = container.scrollTop;
    const scrollHeight = container.scrollHeight;
    const clientHeight = container.clientHeight;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 50;
    
    if (!isNearBottom && this.conversationState.isStreaming()) {
      this._userScrolledUp = true;
    } else if (isNearBottom && !this.conversationState.isStreaming()) {
      this._userScrolledUp = false;
    }
  };
  
  private scheduleScroll(): void {
    if (this._scrollRafId !== null) {
      cancelAnimationFrame(this._scrollRafId);
    }
    
    this._scrollRafId = requestAnimationFrame(() => {
      this.scrollToBottom();
      this._scrollRafId = null;
    });
  }
  
  private scrollToBottom(): void {
    const isStreaming = this.conversationState.isStreaming();
    
    if (this.scrollSentinel()?.nativeElement) {
      this.scrollSentinel()!.nativeElement.scrollIntoView({ 
        behavior: isStreaming ? 'auto' : 'smooth',
        block: 'end'
      });
    } else if (this.messagesContainer) {
      const element = this.messagesContainer()!.nativeElement;
      if (isStreaming) {
        element.scrollTop = element.scrollHeight;
      } else {
        element.scrollTop = element.scrollHeight;
      }
    }
  }

  getToolStatusMessage(toolCall: ParsedToolCall): string {
    const toolName = toolCall.tool;
    const serverTools = this.aiService.getCachedServerMCPTools();
    const messages = this.toolPolicyService.getToolStatusMessages(serverTools);
    return messages[toolName] ?? `Executing ${toolName}...`;
  }

  private async handleMainStreamResponse(finalResponse: string): Promise<void> {
    try {
      const result = await this.streamHandler.processResponse(
        finalResponse,
        this.getStreamResponseContext(true)
      );
      if ('startContinuation' in result) {
        this.startContinuationStream(result.startContinuation.editorId, result.startContinuation.summary);
      } else {
        this.finishResponse();
      }
    } catch (err) {
      console.error('[AI Tab] Error processing main stream response:', err);
      this.finishResponse();
    }
    this._userScrolledUp = false;
    if (!this._intersectionObserver && this.scrollSentinel()) {
      this.setupScrollSentinelObserver();
    }
  }

  private startContinuationStream(editorId: string, summary: string): void {
    this.conversationState.startStreaming();
    this._isLoading.set(true);
    if (this._currentSubscription) {
      this._currentSubscription.unsubscribe();
      this._currentSubscription = null;
    }
    const mode = this.currentMode();
    this._currentSubscription = this.aiService
      .sendStreamingMessage('', editorId, this.useMCPTools(), this.cqlContent(), summary, mode)
      .subscribe({
        next: async (event) => {
          if (event.type === 'chunk') {
            this.conversationState.addStreamingChunk(event.content || '');
          } else if (event.type === 'end') {
            const finalResponse = (event as { fullResponse?: string }).fullResponse ?? this.conversationState.streamingResponse();
            try {
              const result = await this.streamHandler.processResponse(
                finalResponse,
                this.getStreamResponseContext(false)
              );
              if ('startContinuation' in result) {
                this.startContinuationStream(
                  result.startContinuation.editorId,
                  result.startContinuation.summary
                );
              } else {
                this.finishResponse();
              }
            } catch (err) {
              console.error('[AI Tab] Error processing continuation response:', err);
              this.finishResponse();
            }
          }
        },
        error: (error: unknown) => {
          const err = error as { message?: string };
          const errorMessage =
            err?.message ||
            (error instanceof TypeError && (error as Error).message === 'Failed to fetch'
              ? 'Unable to connect to Ollama server. Please check your settings and ensure the server is running.'
              : 'Failed to continue response');
          this._isLoading.set(false);
          this.conversationState.setError(errorMessage);
          this.conversationState.endStreaming();
          this._error.set(errorMessage);
          this._currentSubscription = null;
        },
        complete: () => {
          this._currentSubscription = null;
        }
      });
  }

  public onExecutePlan(): void {
    const conversation = this.activeConversation();
    if (!conversation || !conversation.plan) {
      return;
    }
    
    // Switch to act mode to execute the plan
    this.conversationManager.updateConversationMode(conversation.id, 'act');
    
    // Send a message to execute the plan
    const planDescription = conversation.plan.description || 'Execute the plan';
    this._currentMessage.set(`Execute the plan: ${planDescription}`);
    this.onSendMessage();
  }

  public onRevisePlan(): void {
    const conversation = this.activeConversation();
    if (!conversation || !conversation.plan) {
      return;
    }
    
    // Ask user for revision instructions
    const planDescription = conversation.plan.description || 'the plan';
    this._currentMessage.set(`Please revise ${planDescription}. What changes would you like to make?`);
    // Don't auto-send, let user edit the message first
  }

}
