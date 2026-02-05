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
import { ConversationManagerService, Conversation, UIMessage } from '../../../../services/conversation-manager.service';
import { ToolResult } from '../../../../services/tool-orchestrator.service';
import { ToolCallParserService, ParsedToolCall } from '../../../../services/tool-call-parser.service';
import { CodeDiffPreviewComponent, CodeDiff } from './code-diff-preview.component';
import { AiConversationStateService } from '../../../../services/ai-conversation-state.service';
import { AiToolExecutionManagerService } from '../../../../services/ai-tool-execution-manager.service';
import { Plan, PlanStep } from '../../../../models/plan.model';
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
    private toolExecutionManager: AiToolExecutionManagerService
  ) {
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

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString();
  }

  private removeToolCallJsonFromResponse(response: string, toolCalls: ParsedToolCall[]): string {
    let cleaned = response;
    
    for (const toolCall of toolCalls) {
      if (toolCall.raw) {
        if (cleaned.includes(toolCall.raw)) {
          cleaned = cleaned.replace(toolCall.raw, '').trim();
        }
      }
    }
    
    const standaloneToolCallPattern = /\{\s*"tool"\s*:\s*"[^"]+"\s*,\s*"params"\s*:\s*\{[\s\S]*?\}\s*\}/g;
    cleaned = cleaned.replace(standaloneToolCallPattern, '').trim();
    
    const lines = cleaned.split('\n');
    const filteredLines = lines.filter(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith('{') && trimmed.includes('"tool"') && trimmed.includes('"params"')) {
        return false;
      }
      return true;
    });
    
    return filteredLines.join('\n').trim();
  }

  private handleToolResult(toolCall: ParsedToolCall, result: ToolResult): void {
    if (toolCall.tool === 'insert_code' || toolCall.tool === 'replace_code') {
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

      if (toolCall.tool === 'replace_code') {
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
      } else if (toolCall.tool === 'insert_code') {
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
          let chunkContent = event.content || '';
          const toolCallInChunk = /\{\s*"tool"\s*:\s*"[^"]+"\s*,\s*"params"\s*:\s*\{[\s\S]*?\}\s*\}/g;
          chunkContent = chunkContent.replace(toolCallInChunk, '');
          
          if (chunkContent.trim().length > 0) {
            this.conversationState.addStreamingChunk(chunkContent);
          }
        } else if (event.type === 'end') {
          const finalResponse = this.conversationState.streamingResponse();
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
    const statusMessages: Record<string, string> = {
      'get_code': 'Reading code...',
      'insert_code': 'Inserting code...',
      'replace_code': 'Updating code...',
      'format_code': 'Formatting code...',
      'list_libraries': 'Listing libraries...',
      'get_library_content': 'Loading library...',
      'search_code': 'Searching code...',
      'create_library': 'Creating library...',
      'get_cursor_position': 'Getting cursor position...',
      'get_selection': 'Getting selection...',
      'navigate_to_line': 'Navigating...',
      'web_search': 'Searching web...',
      'searxng_search': 'Searching web (SearXNG)...',
      'fetch_url': 'Fetching URL...'
    };
    
    return statusMessages[toolName] || `Executing ${toolName}...`;
  }

  /**
   * Execute tool calls serially (one after another)
   * Returns a promise that resolves with all results after sequential execution
   */
  private async executeToolCallsWithPromise(toolCalls: ParsedToolCall[]): Promise<ToolResult[]> {
    if (toolCalls.length === 0) {
      return [];
    }

    const results: ToolResult[] = [];
    const activeConversation = this.activeConversation();

    // Execute each tool call sequentially
    for (let index = 0; index < toolCalls.length; index++) {
      const toolCall = toolCalls[index];
      
      // Update plan step status if we have a plan and are executing
      if (activeConversation?.plan && this.currentMode() === 'act') {
        const step = activeConversation.plan.steps[index];
        if (step) {
          const callKey = this.toolExecutionManager.getCallKey(toolCall);
          this.conversationManager.updatePlanStepStatus(
            activeConversation.id,
            step.id,
            'in-progress',
            callKey
          );
        }
      }

      try {
        // Execute tool call and wait for it to complete before moving to next
        const result = await new Promise<ToolResult>((resolve) => {
          let subscription: any = null;
          let timeoutId: any = null;
          let resolved = false; // Guard to prevent double resolution

          const cleanupAndResolve = (result: ToolResult) => {
            if (resolved) return; // Prevent double resolution
            resolved = true;
            
            if (timeoutId) {
              clearTimeout(timeoutId);
              timeoutId = null;
            }
            if (subscription && !subscription.closed) {
              subscription.unsubscribe();
            }
            resolve(result);
          };

          subscription = this.toolExecutionManager.executeToolCall(toolCall).subscribe({
            next: (result) => {
              this.handleToolResult(toolCall, result);
              
              // Update plan step status on completion
              if (activeConversation?.plan && this.currentMode() === 'act') {
                const step = activeConversation.plan.steps[index];
                if (step) {
                  this.conversationManager.updatePlanStepStatus(
                    activeConversation.id,
                    step.id,
                    result.success ? 'completed' : 'failed'
                  );
                }
              }
              
              const resultJson = JSON.stringify({
                tool: toolCall.tool,
                success: result.success,
                result: result.result,
                error: result.error
              }, null, 2);
              
              this.ideStateService.addJsonOutput(
                `Tool Execution Result: ${toolCall.tool}`,
                resultJson,
                result.success ? 'success' : 'error'
              );
              
              cleanupAndResolve(result);
            },
            error: (error) => {
              // Only log actual execution errors, not validation errors (e.g., Plan Mode restrictions)
              const isValidationError = (error as any)?.isValidationError === true;
              if (!isValidationError) {
                console.error(`[Component] Tool execution error for ${toolCall.tool}:`, error);
              }
              
              const errorJson = JSON.stringify({
                tool: toolCall.tool,
                success: false,
                error: error.message || 'Tool execution failed'
              }, null, 2);
              
              this.ideStateService.addJsonOutput(
                `Tool Execution Error: ${toolCall.tool}`,
                errorJson,
                'error'
              );
              
              // Update plan step status on error
              if (activeConversation?.plan && this.currentMode() === 'act') {
                const step = activeConversation.plan.steps[index];
                if (step) {
                  this.conversationManager.updatePlanStepStatus(
                    activeConversation.id,
                    step.id,
                    'failed'
                  );
                }
              }
              
              cleanupAndResolve({
                tool: toolCall.tool,
                success: false,
                error: error.message || 'Tool execution failed'
              } as ToolResult);
            },
            complete: () => {
              // Subscription completed - this doesn't resolve the promise
              // The promise is resolved in next() or error() handlers
            }
          });
          
          // Set timeout for tool execution
          timeoutId = setTimeout(() => {
            if (!resolved && subscription && !subscription.closed) {
              console.warn(`[Component] Tool execution timeout for ${toolCall.tool}`);
              cleanupAndResolve({
                tool: toolCall.tool,
                success: false,
                error: 'Tool execution timed out'
              } as ToolResult);
            }
          }, 5000);
        });

        results.push(result);
      } catch (error: any) {
        // Fallback error handling
        const errorResult: ToolResult = {
          tool: toolCall.tool,
          success: false,
          error: error?.message || 'Tool execution failed'
        };
        results.push(errorResult);
      }
    }

    return results;
  }

  private handleRecursiveContinuationStreamResponse(finalContinuation: string): void {
    const finalHash = this.hashString(finalContinuation);
    if (!this.conversationState.hasProcessedResponse(finalHash)) {
      this.conversationState.markResponseProcessed(finalHash);
      const currentConversation = this.activeConversation();
      
      // In plan mode, check for and parse plan in recursive continuation response
      let planFound = false;
      if (currentConversation && this.currentMode() === 'plan') {
        const plan = this.aiService.parsePlan(finalContinuation);
        if (plan) {
          this.conversationManager.updatePlan(currentConversation.id, plan);
          planFound = true;
          console.log('[Component] Plan found and updated in recursive continuation response', plan);
        } else {
          console.log('[Component] No plan found in recursive continuation response', { responseLength: finalContinuation?.length });
        }
      }
      
      // If a plan was found but no text content, add a minimal message so the conversation shows progress
      if (planFound && (!finalContinuation || finalContinuation.trim().length === 0)) {
        if (currentConversation) {
          this.conversationManager.addAssistantMessage(currentConversation.id, 'I\'ve created a plan based on the investigation results. Review it below and click "Execute" when ready to proceed.');
        }
      }
      
      if (currentConversation && finalContinuation && finalContinuation.trim().length > 0) {
        // Use sanitizeMessageContent to remove plan JSON and tool results
        let cleanedResponse = this.aiService.sanitizeMessageContent(finalContinuation);
        if (cleanedResponse.trim().length > 0) {
          this.conversationManager.addAssistantMessage(currentConversation.id, cleanedResponse);
        } else if (planFound) {
          // If plan found but cleaned response is empty, still add a message
          this.conversationManager.addAssistantMessage(currentConversation.id, 'I\'ve created a plan based on the investigation results. Review it below and click "Execute" when ready to proceed.');
        }
      }
      this.conversationState.endStreaming();
      this._isLoading.set(false);
      this._currentMessage.set('');
      this._currentSubscription = null;
    } else {
      this.conversationState.endStreaming();
      this._isLoading.set(false);
      this._currentSubscription = null;
    }
  }

  private async handleContinuationStreamResponse(continuationResponse: string): Promise<void> {
    const responseHash = this.hashString(continuationResponse);
    
    if (!this.conversationState.hasProcessedResponse(responseHash)) {
      this.conversationState.markResponseProcessed(responseHash);
      
      const activeConversation = this.activeConversation();
      
      // In plan mode, check for and parse plan in continuation response (check before processing tool calls)
      let planFound = false;
      if (activeConversation && this.currentMode() === 'plan') {
        const plan = this.aiService.parsePlan(continuationResponse);
        if (plan) {
          this.conversationManager.updatePlan(activeConversation.id, plan);
          planFound = true;
          console.log('[Component] Plan found and updated in continuation response', plan);
        } else {
          console.log('[Component] No plan found in continuation response', { responseLength: continuationResponse?.length });
        }
      }
      
      let cleanedResponse = continuationResponse;
      const continuationToolCalls = this.toolCallParser.parseToolCalls(cleanedResponse);
      let continuationNewCalls: ParsedToolCall[] = [];
      
      if (continuationToolCalls.length > 0 && this.toolCallParser.hasCompleteToolCalls(cleanedResponse)) {
        continuationNewCalls = this.conversationState.addToolCalls(continuationToolCalls, (c) => 
          this.toolExecutionManager.getCallKey(c)
        );
        
        cleanedResponse = this.removeToolCallJsonFromResponse(cleanedResponse, continuationToolCalls);
        
        if (activeConversation && cleanedResponse && cleanedResponse.trim().length > 0) {
          this.conversationManager.addAssistantMessage(activeConversation.id, cleanedResponse);
        }
        
        if (continuationNewCalls.length > 0) {
          // Execute tools serially - wait for all to complete sequentially
          this.executeToolCallsWithPromise(continuationNewCalls).then(() => {
            this.conversationState.updateStateForExecutionStatus();
            const activeConversation = this.activeConversation();
            const continuationSummary = this.toolExecutionManager.getToolResultsSummary(continuationNewCalls);
            if (continuationSummary && activeConversation) {
              this.startRecursiveContinuationStream(activeConversation.editorId, continuationSummary);
            } else {
              this.conversationState.endStreaming();
              this._isLoading.set(false);
              this._currentMessage.set('');
              this._currentSubscription = null;
            }
          }).catch((error) => {
            console.error('[Component] Error in continuation tool execution:', error);
            this.conversationState.updateStateForExecutionStatus();
          });
          return;
        }
      }
      
      // If a plan was found but no text content, add a minimal message so the conversation shows progress
      if (planFound && (!cleanedResponse || cleanedResponse.trim().length === 0)) {
        if (activeConversation) {
          this.conversationManager.addAssistantMessage(activeConversation.id, 'I\'ve created a plan based on the investigation results. Review it below and click "Execute" when ready to proceed.');
        }
      }
      
      if (activeConversation && cleanedResponse && cleanedResponse.trim().length > 0) {
        // Use sanitizeMessageContent to remove plan JSON and tool results
        cleanedResponse = this.aiService.sanitizeMessageContent(cleanedResponse);
        if (cleanedResponse.trim().length > 0) {
          this.conversationManager.addAssistantMessage(activeConversation.id, cleanedResponse);
        }
      }
      
      this.conversationState.endStreaming();
      this._isLoading.set(false);
      this._currentMessage.set('');
      this._currentSubscription = null;
    } else {
      this.conversationState.endStreaming();
      this._isLoading.set(false);
      this._currentSubscription = null;
    }
  }

  private startRecursiveContinuationStream(editorId: string, continuationSummary: string): void {
    this.conversationState.startStreaming();
    this._isLoading.set(true);
    if (this._currentSubscription) {
      this._currentSubscription.unsubscribe();
      this._currentSubscription = null;
    }
    
    const mode = this.currentMode();
    this._currentSubscription = this.aiService.sendStreamingMessage(
      '',
      editorId,
      this.useMCPTools(),
      this.cqlContent(),
      continuationSummary,
      mode
    ).subscribe({
      next: async (event) => {
        if (event.type === 'start') {
        } else if (event.type === 'chunk') {
          this.conversationState.addStreamingChunk(event.content || '');
        } else if (event.type === 'end') {
          const finalContinuation = this.conversationState.streamingResponse();
          this.handleRecursiveContinuationStreamResponse(finalContinuation);
        }
      },
      error: (error) => {
        console.error('[Component] Recursive continuation error:', error);
        this._isLoading.set(false);
        
        let errorMessage = 'Failed to continue response';
        if (error?.message) {
          errorMessage = error.message;
        } else if (error instanceof TypeError && error.message === 'Failed to fetch') {
          errorMessage = 'Unable to connect to Ollama server. Please check your settings and ensure the server is running.';
        }
        
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

  private startContinuationStream(editorId: string, summary: string): void {
    this.conversationState.startStreaming();
    this._isLoading.set(true);
    
    if (this._currentSubscription) {
      this._currentSubscription.unsubscribe();
      this._currentSubscription = null;
    }
    
    const mode = this.currentMode();
    this._currentSubscription = this.aiService.sendStreamingMessage(
      '',
      editorId,
      this.useMCPTools(),
      this.cqlContent(),
      summary,
      mode
    ).subscribe({
      next: async (event) => {
        if (event.type === 'start') {
        } else if (event.type === 'chunk') {
          this.conversationState.addStreamingChunk(event.content || '');
        } else if (event.type === 'end') {
          const continuationResponse = this.conversationState.streamingResponse();
          await this.handleContinuationStreamResponse(continuationResponse);
        }
      },
      error: (error) => {
        console.error('[Component] Continuation error:', error);
        this._isLoading.set(false);
        
        let errorMessage = 'Failed to continue response';
        if (error?.message) {
          errorMessage = error.message;
        } else if (error instanceof TypeError && error.message === 'Failed to fetch') {
          errorMessage = 'Unable to connect to Ollama server. Please check your settings and ensure the server is running.';
        }
        
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

  private async handleMainStreamResponse(finalResponse: string): Promise<void> {
    const responseHash = this.hashString(finalResponse);
    
    if (!this.conversationState.hasProcessedResponse(responseHash)) {
      this.conversationState.markResponseProcessed(responseHash);
      
      let parsedToolCalls: ParsedToolCall[] = [];
      const toolCalls = this.toolCallParser.parseToolCalls(finalResponse);
      let newCalls: ParsedToolCall[] = [];
      
      if (toolCalls.length > 0 && this.toolCallParser.hasCompleteToolCalls(finalResponse)) {
        parsedToolCalls = toolCalls;
        
        newCalls = this.conversationState.addToolCalls(toolCalls, (c) => 
          this.toolExecutionManager.getCallKey(c)
        );
        
        if (this.conversationState.isStreaming()) {
          this.conversationState.endStreaming();
        }
        
        for (const toolCall of toolCalls) {
          if (toolCall.raw) {
            let formattedJson = toolCall.raw;
            try {
              const parsed = JSON.parse(toolCall.raw);
              formattedJson = JSON.stringify(parsed, null, 2);
            } catch {
            }
            
            this.ideStateService.addJsonOutput(
              `Tool Call: ${toolCall.tool}`,
              formattedJson,
              'pending'
            );
          }
        }
        
        finalResponse = this.removeToolCallJsonFromResponse(finalResponse, toolCalls);
      }
      
      const standaloneToolCallPattern = /\{\s*"tool"\s*:\s*"[^"]+"\s*,\s*"params"\s*:\s*\{[\s\S]*?\}\s*\}/g;
      let cleanedResponse = finalResponse.replace(standaloneToolCallPattern, '').trim();
      
      // In plan mode, check for and parse plan
      const activeConversation = this.activeConversation();
      if (activeConversation && this.currentMode() === 'plan') {
        const plan = this.aiService.parsePlan(finalResponse);
        if (plan) {
          this.conversationManager.updatePlan(activeConversation.id, plan);
          // Remove plan JSON from cleaned response (already sanitized by sanitizeMessageContent)
        }
      }
      
      if (activeConversation && cleanedResponse && cleanedResponse.trim().length > 0) {
        // Use sanitizeMessageContent to remove plan JSON and tool results
        cleanedResponse = this.aiService.sanitizeMessageContent(cleanedResponse);
        if (cleanedResponse.trim().length > 0) {
          this.conversationManager.addAssistantMessage(activeConversation.id, cleanedResponse);
          this.conversationManager.completeStreaming(activeConversation.id);
        }
      }
      
      if (parsedToolCalls.length > 0) {
        try {
          // Execute tools serially - wait for all to complete sequentially
          await this.executeToolCallsWithPromise(newCalls);
        } catch (error) {
          console.error('[Component] Error waiting for tool executions:', error);
        }
        
        this.conversationState.updateStateForExecutionStatus();
        
        const activeConversation = this.activeConversation();
        if (activeConversation && newCalls.length > 0) {
          const summary = this.toolExecutionManager.getToolResultsSummary(newCalls);
          const toolNames = newCalls.map(c => c.tool).join(', ');
          const fallbackSummary = summary || `Tools executed: ${toolNames}. Continue with your response.`;
          
          if (summary) {
            this.ideStateService.addJsonOutput(
              'Tool Execution Summary',
              summary,
              'success'
            );
          }
          
          this.startContinuationStream(activeConversation.editorId, summary || fallbackSummary);
        } else {
          const state = this.conversationState.conversationState();
          if (state === 'idle' || state === 'results-ready') {
            this._isLoading.set(false);
            this._currentMessage.set('');
            this._currentSubscription = null;
          }
        }
      } else {
        this.conversationState.endStreaming();
        this._isLoading.set(false);
        this._currentMessage.set('');
        this._currentSubscription = null;
      }
      
      this._userScrolledUp = false;
      
      if (!this._intersectionObserver && this.scrollSentinel()) {
        this.setupScrollSentinelObserver();
      }
    }
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
