// Author: Preston Lee

import { Component, input, output, OnInit, AfterViewInit, AfterViewChecked, viewChild, ElementRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IdeStateService } from '../../../../services/ide-state.service';
import { OutputSection, OutputType } from '../../shared/ide-types';
import { SyntaxHighlighterComponent } from '../../../shared/syntax-highlighter/syntax-highlighter.component';
import { CustomOutputCardComponent } from './custom-output-card.component';

@Component({
  selector: 'app-console-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, SyntaxHighlighterComponent, CustomOutputCardComponent],
  templateUrl: './console-tab.component.html',
  styleUrls: ['./console-tab.component.scss']
})
export class ConsoleTabComponent implements OnInit, AfterViewInit, AfterViewChecked {
  preserveLogs = input<boolean>(true);
  isEvaluating = input<boolean>(false);
  executionProgress = input<number>(0);
  executionStatus = input<string>('');
  
  // Autoscroll control
  public autoscrollEnabled: boolean = true;
  
  clearOutput = output<void>();
  copyOutput = output<void>();
  toggleAllSections = output<void>();
  preserveLogsChange = output<boolean>();
  autoscrollChange = output<boolean>();

  consoleContent = viewChild<ElementRef>('consoleContent');
  
  get outputSections() {
    return this.ideStateService.outputSections;
  }
  public allSectionsExpanded = false;
  private shouldAutoScroll = true;
  private previousOutputCount = 0;

  public ideStateService = inject(IdeStateService);

  ngOnInit(): void {
    // Component initialization
    this.updateAllSectionsExpandedState();
    this.previousOutputCount = this.outputSections().length;
  }

  ngAfterViewInit(): void {
    // Initialize previous count after view is ready
    this.previousOutputCount = this.outputSections().length;
    
    // Set up MutationObserver to watch for DOM changes
    if (this.consoleContent()) {
      const observer = new MutationObserver(() => {
        if (this.shouldAutoScroll && this.autoscrollEnabled) {
          setTimeout(() => {
            this.scrollToBottom();
          }, 0);
        }
      });
      
      observer.observe(this.consoleContent()!.nativeElement, {
        childList: true,
        subtree: true
      });
    }
  }

  ngAfterViewChecked(): void {
    // Check if new content was added and scroll if needed
    const currentCount = this.outputSections().length;
    if (currentCount > this.previousOutputCount && this.shouldAutoScroll && this.autoscrollEnabled) {
      this.previousOutputCount = currentCount;
      // Use setTimeout to ensure DOM is fully rendered
      setTimeout(() => {
        this.scrollToBottom();
      }, 0);
    }
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

  onToggleAllSections(): void {
    this.allSectionsExpanded = !this.allSectionsExpanded;
    
    // Update all sections with the new expanded state
    const sections = this.outputSections().map(section => ({
      ...section,
      expanded: this.allSectionsExpanded
    }));
    
    this.ideStateService.setOutputSections(sections);
    this.toggleAllSections.emit();
  }

  onToggleSection(index: number): void {
    if (index >= 0 && index < this.outputSections().length) {
      const sections = [...this.outputSections()];
      sections[index] = { ...sections[index], expanded: !sections[index].expanded };
      this.ideStateService.setOutputSections(sections);
      
      // Update allSectionsExpanded state based on current sections
      this.updateAllSectionsExpandedState();
    }
  }

  private updateAllSectionsExpandedState(): void {
    const sections = this.outputSections();
    if (sections.length === 0) {
      this.allSectionsExpanded = false;
    } else {
      this.allSectionsExpanded = sections.every(section => section.expanded);
    }
  }

  onPreserveLogsChange(value: boolean): void {
    this.preserveLogsChange.emit(value);
  }

  onAutoscrollChange(value: boolean): void {
    this.autoscrollEnabled = value;
    this.autoscrollChange.emit(value);
    
    // If autoscroll is enabled and user is at bottom, scroll to bottom
    if (value && this.shouldAutoScroll) {
      setTimeout(() => {
        this.scrollToBottom();
      }, 0);
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

  getOutputClass(section: OutputSection): string {
    const baseClass = 'console-section';
    const typeClass = `console-section-${section.type}`;
    const statusClass = `console-section-${section.status}`;
    return `${baseClass} ${typeClass} ${statusClass}`;
  }
}
