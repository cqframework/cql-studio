// Author: Preston Lee

import { Component, ChangeDetectionStrategy, input, output, viewChild, ElementRef, inject, computed } from '@angular/core';
import { CdkDropList, CdkDrag, CdkDragDrop } from '@angular/cdk/drag-drop';
import { firstValueFrom } from 'rxjs';
import { IdePanel, IdePanelTab } from './ide-panel-tab.interface';
import { IdeStateService, TabDataScope } from '../../../services/ide-state.service';

export interface PanelTabListData {
  panelId: string;
  tabs: IdePanelTab[];
}
import { LibraryService } from '../../../services/library.service';
import { TranslationService } from '../../../services/translation.service';
import { LibraryTranslationContextBuilder } from '../../../services/library-translation-context.lib';
import { ToastService } from '../../../services/toast.service';

// Import all tab components
import { NavigationTabComponent } from '../tabs/navigation-tab/navigation-tab.component';
import { OutlineTabComponent } from '../tabs/outline-tab/outline-tab.component';
import { FhirTabComponent } from '../tabs/fhir-tab/fhir-tab.component';
import { ElmTabComponent } from '../tabs/elm-tab/elm-tab.component';
import { ProblemsTabComponent } from '../tabs/problems-tab/problems-tab.component';
import { ConsoleTabComponent } from '../tabs/console-tab/console-tab.component';
import { AiTabComponent } from '../tabs/ai-tab/ai-tab.component';
import { ClipboardTabComponent } from '../tabs/clipboard-tab/clipboard-tab.component';
import { ReferencesTabComponent } from '../tabs/references-tab/references-tab.component';
import { ValuesetPeekTabComponent } from '../tabs/valueset-peek-tab/valueset-peek-tab.component';
import { OpenCodeLibraryChange } from '../../../models/opencode.model';

@Component({
  selector: 'app-ide-panel',
  imports: [
    CdkDropList,
    CdkDrag,
    NavigationTabComponent,
    OutlineTabComponent,
    FhirTabComponent,
    ElmTabComponent,
    ProblemsTabComponent,
    ConsoleTabComponent,
    AiTabComponent,
    ClipboardTabComponent,
    ReferencesTabComponent,
    ValuesetPeekTabComponent
  ],
  templateUrl: './ide-panel.component.html',

  styleUrls: ['./ide-panel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(window:mousemove)': 'onMouseMove($event)',
    '(window:mouseup)': 'onMouseUp($event)',
  },
})
export class IdePanelComponent {
  panel = input.required<IdePanel>();
  position = input.required<'left' | 'right' | 'bottom'>();
  
  togglePanel = output<string>();
  setActiveTab = output<string>();
  startResize = output<{ type: string; event: MouseEvent; newSize?: number }>();
  moveTab = output<{ tabId: string; fromPanelId: string; toPanelId: string }>();
  reorderTab = output<{ panelId: string; fromIndex: number; toIndex: number }>();
  dragOver = output<string>();
  dragLeave = output<string>();
  executeAll = output<void>();
  navigateToLine = output<number>();
  applyLibraryChange = output<OpenCodeLibraryChange>();

  panelElement = viewChild<ElementRef<HTMLDivElement>>('panelElement');
  navigationTab = viewChild(NavigationTabComponent);

  public ideStateService = inject(IdeStateService);

  panelTabsData = computed<PanelTabListData>(() => ({
    panelId: this.panel().id,
    tabs: this.panel().tabs
  }));

  connectedPanelIds = computed(() =>
    (['left', 'right', 'bottom'] as const)
      .filter(id => id !== this.panel().id)
      .map(id => `panel-${id}`)
  );
  private libraryService = inject(LibraryService);
  private translationService = inject(TranslationService);
  private libraryTranslationContextBuilder = inject(LibraryTranslationContextBuilder);
  private toastService = inject(ToastService);

  private isResizing: boolean = false;
  private resizeType: string = '';
  private startX: number = 0;
  private startY: number = 0;
  private startWidth: number = 0;
  private startHeight: number = 0;
  private resizeAnimationFrame: number | null = null;

  get panelClasses(): string {
    const classes = ['ide-panel'];
    
    if (this.position() === 'left') {
      classes.push('sidebar', 'bg-body', 'border-end');
    } else if (this.position() === 'right') {
      classes.push('right-panel', 'bg-body', 'border-start');
    } else if (this.position() === 'bottom') {
      classes.push('bottom-panel', 'bg-body', 'border-top');
    }
    
    if (this.panel().isVisible) {
      classes.push('visible');
    }
    
    return classes.join(' ');
  }

  get panelStyles(): { [key: string]: string } {
    const styles: { [key: string]: string } = {};
    
    if (this.position() === 'left' || this.position() === 'right') {
      styles['width'] = this.panel().size.toString() + 'px !important';
    } else if (this.position() === 'bottom') {
      styles['height'] = this.panel().size.toString() + 'px !important';
    }
    
    return styles;
  }

  onTogglePanel(): void {
    this.togglePanel.emit(this.panel().id);
  }

  onSetActiveTab(tabId: string): void {
    this.setActiveTab.emit(tabId);
  }

  onExecuteAll(): void {
    // Emit event to parent component to handle execution
    this.executeAll.emit();
  }

  onNavigateToLine(lineNumber: number): void {
    // Emit event to parent component to handle navigation
    this.navigateToLine.emit(lineNumber);
  }

  onClearOutput(): void {
    this.ideStateService.clearOutputSections();
  }

  onCopyOutput(): void {
    const sections = this.ideStateService.outputSections();
    if (sections.length === 0) {
      this.toastService.showWarning('No console output to copy.', 'Copy');
      return;
    }
    const text = sections
      .map(s => `--- ${s.title} ---\n${s.content}`)
      .join('\n\n');
    navigator.clipboard?.writeText(text).then(
      () => this.toastService.showSuccess('Console output copied to clipboard.', 'Copy'),
      () => this.toastService.showError('Failed to copy to clipboard.', 'Copy')
    );
  }

  onPreserveLogsChange(value: boolean): void {
    this.ideStateService.setPreserveLogs(value);
  }

  async onDeleteLibraryFromServer(): Promise<void> {
    const activeLibraryId = this.ideStateService.activeLibraryId();
    if (activeLibraryId) {
      // Get the active library resource
      const activeLibrary = this.ideStateService.getActiveLibraryResource();
      if (activeLibrary && activeLibrary.library) {
        try {
          await firstValueFrom(this.libraryService.delete(activeLibrary.library));
          this.ideStateService.removeLibraryResource(activeLibraryId);
          this.ideStateService.selectLibraryResource('');
          this.ideStateService.invalidateTabData(TabDataScope.LibraryList);
          if (this.navigationTab()) {
            this.navigationTab()!.loadLibraries();
          }
        } catch (error) {
          console.error('Error deleting library from server:', error);
          // You might want to show an error message to the user here
        }
      }
    }
  }

  onStartResize(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isResizing = true;
    this.resizeType = this.position();
    this.startX = event.clientX;
    this.startY = event.clientY;
    
    if (this.position() === 'left' || this.position() === 'right') {
      this.startWidth = this.panel().size;
    } else {
      this.startHeight = this.panel().size;
    }
    
    this.startResize.emit({ type: this.position(), event });
  }

  onMouseMove(event: MouseEvent): void {
    if (this.isResizing) {
      if (this.resizeAnimationFrame !== null) {
        cancelAnimationFrame(this.resizeAnimationFrame);
      }
      
      this.resizeAnimationFrame = requestAnimationFrame(() => {
        this.handleResize(event);
        this.resizeAnimationFrame = null;
      });
    }
  }

  onMouseUp(event: MouseEvent): void {
    if (this.isResizing) {
      this.stopResize();
    }
  }

  private handleResize(event: MouseEvent): void {
    if (!this.isResizing) return;

    let newSize = this.panel().size;

    if (this.position() === 'left') {
      const deltaX = event.clientX - this.startX;
      newSize = Math.max(this.panel().minSize, Math.min(this.panel().maxSize, this.startWidth + deltaX));
    } else if (this.position() === 'right') {
      const deltaX = this.startX - event.clientX;
      newSize = Math.max(this.panel().minSize, Math.min(this.panel().maxSize, this.startWidth + deltaX));
    } else if (this.position() === 'bottom') {
      const deltaY = this.startY - event.clientY;
      newSize = Math.max(this.panel().minSize, Math.min(this.panel().maxSize, this.startHeight + deltaY));
    }

    // Emit resize event to parent component
    this.startResize.emit({ 
      type: this.position(), 
      event: event,
      newSize: newSize
    });
  }

  private stopResize(): void {
    this.isResizing = false;
    
    if (this.resizeAnimationFrame !== null) {
      cancelAnimationFrame(this.resizeAnimationFrame);
      this.resizeAnimationFrame = null;
    }
  }

  onTabClick(tab: IdePanelTab): void {
    this.onSetActiveTab(tab.id);
  }

  onTabKeydown(event: KeyboardEvent, tab: IdePanelTab): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.onSetActiveTab(tab.id);
    }
  }

  onPanelTabDrop(event: CdkDragDrop<PanelTabListData>): void {
    const prev = event.previousContainer.data;
    const curr = event.container.data;
    if (event.previousContainer === event.container) {
      if (event.previousIndex !== event.currentIndex) {
        this.reorderTab.emit({
          panelId: curr.panelId,
          fromIndex: event.previousIndex,
          toIndex: event.currentIndex
        });
      }
    } else {
      const tab = prev.tabs[event.previousIndex];
      if (tab) {
        this.moveTab.emit({
          tabId: tab.id,
          fromPanelId: prev.panelId,
          toPanelId: curr.panelId
        });
      }
    }
  }

  getActiveTab(): IdePanelTab | undefined {
    const panel = this.panel();
    if (panel.activeTabId) {
      return panel.tabs.find(tab => tab.id === panel.activeTabId);
    }
    return panel.tabs.find(tab => tab.isActive);
  }

  hasTabType(type: string): boolean {
    return this.panel().tabs.some(tab => tab.type === type);
  }

  getActiveLibraryCqlContent(): string {
    // Always get the current content from the active library resource
    // This is updated in real-time by the editor via contentChange events
    const activeLibrary = this.ideStateService.getActiveLibraryResource();
    return activeLibrary?.cqlContent || '';
  }

  async onTranslateCqlToElm(): Promise<void> {
    // Always get the latest content from the active library resource
    // This ensures we translate whatever is currently in the editor, even if dirty
    const cqlContent = this.getActiveLibraryCqlContent();
    if (!cqlContent) {
      return;
    }

    this.ideStateService.setTranslating(true);
    try {
      const translationResult = await this.translationService.translateCqlToElmAsync(
        cqlContent,
        this.libraryTranslationContextBuilder.fromLibraryResource(this.ideStateService.getActiveLibraryResource())
      );

      // Update translation state with errors/warnings
      this.ideStateService.setTranslationErrors(translationResult.errors);
      this.ideStateService.setTranslationWarnings(translationResult.warnings);
      this.ideStateService.setTranslationMessages(translationResult.messages);
      this.ideStateService.setElmTranslationResults(translationResult.elmXml);

      if (translationResult.hasErrors) {
        console.error('Translation failed with errors:', translationResult.errors);

        // Add error to output section for user feedback
        const errorContent = translationResult.errors.join('\n');
        this.ideStateService.addOutputSection({
          id: `output_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          title: 'ELM Translation Error',
          content: `Translation failed:\n${errorContent}`,
          type: 'error',
          status: 'error',
          executionTime: 0,
          expanded: false,
          timestamp: new Date()
        });
      } else {
        // Add success message to output section
        const warningText = translationResult.warnings.length > 0
          ? `\n\nWarnings:\n${translationResult.warnings.join('\n')}`
          : '';
        this.ideStateService.addOutputSection({
          id: `output_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          title: 'ELM Translation Success',
          content: `CQL successfully translated to ELM${warningText}`,
          type: 'info',
          status: 'success',
          executionTime: 0,
          expanded: false,
          timestamp: new Date()
        });
      }
    } catch (error) {
      console.error('ELM translation threw:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.ideStateService.setTranslationErrors([errorMessage]);
      this.ideStateService.setElmTranslationResults(null);
      this.ideStateService.addOutputSection({
        id: `output_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        title: 'ELM Translation Error',
        content: `Translation failed:\n${errorMessage}`,
        type: 'error',
        status: 'error',
        executionTime: 0,
        expanded: false,
        timestamp: new Date()
      });
    } finally {
      this.ideStateService.setTranslating(false);
    }
  }

  onClearElmTranslation(): void {
    this.ideStateService.setElmTranslationResults(null);
  }

  insertCqlCode = output<string>();
  replaceCqlCode = output<string>();

  // AI Tab event handlers
  onInsertCqlCode(code: string): void {
    this.insertCqlCode.emit(code);
  }

  onReplaceCqlCode(code: string): void {
    this.replaceCqlCode.emit(code);
  }

  onApplyLibraryChange(change: OpenCodeLibraryChange): void {
    this.applyLibraryChange.emit(change);
  }
}
