// Author: Preston Lee

import {Component, ChangeDetectionStrategy, input, output, viewChild, ElementRef, inject, afterNextRender, Injector, signal} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IdeStateService } from '../../../../services/ide-state.service';
import { OutputSection, OutputType } from '../../shared/ide-types';
import { SyntaxHighlighterComponent } from '../../../shared/syntax-highlighter/syntax-highlighter.component';
import { CustomOutputCardComponent } from './custom-output-card.component';

@Component({
  selector: 'app-console-tab',
  imports: [FormsModule, DatePipe, SyntaxHighlighterComponent, CustomOutputCardComponent],
  templateUrl: './console-tab.component.html',

  styleUrls: ['./console-tab.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConsoleTabComponent {
  preserveLogs = input<boolean>(false);
  isEvaluating = input<boolean>(false);
  executionProgress = input<number>(0);
  executionStatus = input<string>('');
  
  // Autoscroll control
  public readonly autoscrollEnabled = signal(true);
  
  clearOutput = output<void>();
  copyOutput = output<void>();
  preserveLogsChange = output<boolean>();
  autoscrollChange = output<boolean>();

  consoleContent = viewChild<ElementRef>('consoleContent');

  public ideStateService = inject(IdeStateService);
  protected readonly outputSections = this.ideStateService.outputSections;
  private shouldAutoScroll = true;
  private mutationObserver: MutationObserver | null = null;
  private injector = inject(Injector);

  constructor() {
    afterNextRender(() => {
      this.setupMutationObserver();
      if (this.shouldAutoScroll && this.autoscrollEnabled()) {
        this.scrollToBottom();
      }
    }, { injector: this.injector });
  }

  private setupMutationObserver(): void {
    const element = this.consoleContent()?.nativeElement;
    if (!element || this.mutationObserver) {
      return;
    }

    this.mutationObserver = new MutationObserver(() => {
      if (this.shouldAutoScroll && this.autoscrollEnabled()) {
        this.scrollToBottom();
      }
    });

    this.mutationObserver.observe(element, {
      childList: true,
      subtree: true
    });
  }

  private scrollToBottom(): void {
    if (this.consoleContent()) {
      const element = this.consoleContent()!.nativeElement;
      
      try {
        // Use scrollIntoView on the last child for smooth scrolling
        const lastChild = element.lastElementChild;
        if (lastChild) {
          lastChild.scrollIntoView({ behavior: 'smooth', block: 'end' });
        } else {
          // Fallback to direct scrollTop assignment
          element.scrollTop = element.scrollHeight;
        }
      } catch (error) {
        // Silent fallback to basic scrolling
        element.scrollTop = element.scrollHeight;
      }
    }
  }

  onConsoleScroll(event: Event): void {
    const element = event.target as HTMLElement;
    const isAtBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 10;
    this.shouldAutoScroll = isAtBottom;
  }

  onClearOutput(): void {
    this.clearOutput.emit();
    this.shouldAutoScroll = true; // Reset autoscroll when clearing
  }

  // Force scroll to bottom (useful for external triggers)
  forceScrollToBottom(): void {
    this.shouldAutoScroll = true;
    this.scrollToBottom();
  }

  onCopyOutput(): void {
    this.copyOutput.emit();
  }

  private setAllSectionsExpandedState(expanded: boolean): void {
    // Update all sections with the new expanded state.
    const sections = this.outputSections().map(section => ({
      ...section,
      expanded
    }));

    this.ideStateService.setOutputSections(sections);
  }

  onExpandAllSections(): void {
    this.setAllSectionsExpandedState(true);
  }

  onCollapseAllSections(): void {
    this.setAllSectionsExpandedState(false);
  }

  onToggleSection(index: number): void {
    if (index >= 0 && index < this.outputSections().length) {
      const sections = [...this.outputSections()];
      sections[index] = { ...sections[index], expanded: !sections[index].expanded };
      this.ideStateService.setOutputSections(sections);
    }
  }

  onPreserveLogsChange(value: boolean): void {
    this.preserveLogsChange.emit(value);
  }

  onAutoscrollChange(value: boolean): void {
    this.autoscrollEnabled.set(value);
    this.autoscrollChange.emit(value);
    
    // If autoscroll is enabled and user is at bottom, scroll to bottom
    if (value && this.shouldAutoScroll) {
      afterNextRender(() => this.scrollToBottom(), { injector: this.injector });
    }
  }

  getOutputLanguage(section: OutputSection): string {
    switch (section.type) {
      case 'json':
        return 'json';
      case 'xml':
        return 'xml';
      case 'text':
        return 'text';
      case 'error':
        return 'text';
      case 'warning':
        return 'text';
      case 'info':
        return 'text';
      case 'custom':
        return section.metadata?.['language'] || 'text';
      default:
        return 'text';
    }
  }

  getOutputIcon(section: OutputSection): string {
    switch (section.type) {
      case 'error':
        return 'bi-exclamation-triangle-fill';
      case 'warning':
        return 'bi-exclamation-triangle';
      case 'info':
        return 'bi-info-circle';
      case 'json':
        return 'bi-code-square';
      case 'xml':
        return 'bi-file-code';
      case 'text':
        return 'bi-file-text';
      case 'custom':
        return section.metadata?.['icon'] || 'bi-card-text';
      default:
        return 'bi-card-text';
    }
  }
}
