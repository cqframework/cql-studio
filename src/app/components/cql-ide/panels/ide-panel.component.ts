// Author: Preston Lee

import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IdePanel, IdePanelTab } from './ide-panel-tab.interface';
import { IdeStateService } from '../../../services/ide-state.service';
import { LibraryService } from '../../../services/library.service';

// Import all tab components
import { NavigationTabComponent } from '../tabs/navigation-tab/navigation-tab.component';
import { OutlineTabComponent } from '../tabs/outline-tab/outline-tab.component';
import { FhirTabComponent } from '../tabs/fhir-tab/fhir-tab.component';
import { ElmTabComponent } from '../tabs/elm-tab/elm-tab.component';
import { ProblemsTabComponent } from '../tabs/problems-tab/problems-tab.component';
import { OutputTabComponent } from '../tabs/output-tab/output-tab.component';

@Component({
  selector: 'app-ide-panel',
  standalone: true,
  imports: [
    CommonModule,
    NavigationTabComponent,
    OutlineTabComponent,
    FhirTabComponent,
    ElmTabComponent,
    ProblemsTabComponent,
    OutputTabComponent
  ],
  templateUrl: './ide-panel.component.html',
  styleUrls: ['./ide-panel.component.scss']
})
export class IdePanelComponent {
  @Input() panel!: IdePanel;
  @Input() position!: 'left' | 'right' | 'bottom';
  
  @Output() togglePanel = new EventEmitter<string>();
  @Output() setActiveTab = new EventEmitter<string>();
  @Output() startResize = new EventEmitter<{ type: string; event: MouseEvent; newSize?: number }>();
  @Output() moveTab = new EventEmitter<{ tabId: string; fromPanelId: string; toPanelId: string }>();
  @Output() tabDrop = new EventEmitter<{ tab: any; targetPanelId: string }>();
  @Output() dragOver = new EventEmitter<string>();
  @Output() dragLeave = new EventEmitter<string>();
  @Output() executeAll = new EventEmitter<void>();

  @ViewChild('panelElement', { static: false }) panelElement?: ElementRef<HTMLDivElement>;

  constructor(
    public ideStateService: IdeStateService,
    private libraryService: LibraryService
  ) {}

  private isResizing: boolean = false;
  private resizeType: string = '';
  private startX: number = 0;
  private startY: number = 0;
  private startWidth: number = 0;
  private startHeight: number = 0;
  private resizeAnimationFrame: number | null = null;

  get panelClasses(): string {
    const classes = ['ide-panel'];
    
    if (this.position === 'left') {
      classes.push('sidebar', 'bg-dark', 'border-end');
    } else if (this.position === 'right') {
      classes.push('right-panel', 'bg-dark', 'border-start');
    } else if (this.position === 'bottom') {
      classes.push('bottom-panel', 'bg-dark', 'border-top');
    }
    
    if (this.panel.isVisible) {
      classes.push('visible');
    }
    
    return classes.join(' ');
  }

  get panelStyles(): { [key: string]: string } {
    const styles: { [key: string]: string } = {};
    
    if (this.position === 'left' || this.position === 'right') {
      styles['width'] = this.panel.size.toString() + 'px !important';
    } else if (this.position === 'bottom') {
      styles['height'] = this.panel.size.toString() + 'px !important';
    }
    
    return styles;
  }

  onTogglePanel(): void {
    this.togglePanel.emit(this.panel.id);
  }

  onSetActiveTab(tabId: string): void {
    this.setActiveTab.emit(tabId);
  }

  onExecuteAll(): void {
    // Emit event to parent component to handle execution
    this.executeAll.emit();
  }

  onClearOutput(): void {
    this.ideStateService.clearOutputSections();
  }

  onCopyOutput(): void {
    // TODO: Implement copy output functionality
    console.log('Copy output');
  }

  onToggleAllSections(): void {
    // TODO: Implement toggle all sections functionality
    console.log('Toggle all sections');
  }

  onPreserveLogsChange(value: boolean): void {
    this.ideStateService.setPreserveLogs(value);
  }

  onDeleteLibraryFromServer(): void {
    const activeLibraryId = this.ideStateService.activeLibraryId();
    if (activeLibraryId) {
      // Get the active library resource
      const activeLibrary = this.ideStateService.getActiveLibraryResource();
      if (activeLibrary && activeLibrary.library) {
        // Delete the library from the server
        this.libraryService.delete(activeLibrary.library).subscribe({
          next: () => {
            console.log('Library deleted from server successfully');
            // Remove it from the local state
            this.ideStateService.removeLibraryResource(activeLibraryId);
            // Clear the active library
            this.ideStateService.selectLibraryResource('');
          },
          error: (error) => {
            console.error('Error deleting library from server:', error);
            // You might want to show an error message to the user here
          }
        });
      }
    }
  }

  onStartResize(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isResizing = true;
    this.resizeType = this.position;
    this.startX = event.clientX;
    this.startY = event.clientY;
    
    if (this.position === 'left' || this.position === 'right') {
      this.startWidth = this.panel.size;
    } else {
      this.startHeight = this.panel.size;
    }
    
    this.startResize.emit({ type: this.position, event });
  }

  @HostListener('window:mousemove', ['$event'])
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

  @HostListener('window:mouseup', ['$event'])
  onMouseUp(event: MouseEvent): void {
    if (this.isResizing) {
      this.stopResize();
    }
  }

  private handleResize(event: MouseEvent): void {
    if (!this.isResizing) return;

    let newSize = this.panel.size;

    if (this.position === 'left') {
      const deltaX = event.clientX - this.startX;
      newSize = Math.max(this.panel.minSize, Math.min(this.panel.maxSize, this.startWidth + deltaX));
    } else if (this.position === 'right') {
      const deltaX = this.startX - event.clientX;
      newSize = Math.max(this.panel.minSize, Math.min(this.panel.maxSize, this.startWidth + deltaX));
    } else if (this.position === 'bottom') {
      const deltaY = this.startY - event.clientY;
      newSize = Math.max(this.panel.minSize, Math.min(this.panel.maxSize, this.startHeight + deltaY));
    }

    // Emit resize event to parent component
    this.startResize.emit({ 
      type: this.position, 
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

  private updateBottomPanelHeight(): void {
    if (this.position === 'bottom' && this.panel.size) {
      document.documentElement.style.setProperty('--bottom-panel-height', `${this.panel.size}px`);
    }
  }

  onTabClick(tab: IdePanelTab): void {
    this.onSetActiveTab(tab.id);
  }

  onTabDragStart(event: DragEvent, tab: IdePanelTab): void {
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', JSON.stringify({
        tabId: tab.id,
        fromPanelId: this.panel.id,
        tabType: tab.type
      }));
    }
  }

  onTabDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  onTabDrop(event: DragEvent): void {
    event.preventDefault();
    
    try {
      const data = JSON.parse(event.dataTransfer?.getData('text/plain') || '{}');
      if (data.tabId && data.fromPanelId && data.fromPanelId !== this.panel.id) {
        this.moveTab.emit({
          tabId: data.tabId,
          fromPanelId: data.fromPanelId,
          toPanelId: this.panel.id
        });
      }
    } catch (error) {
      console.error('Error handling tab drop:', error);
    }
  }

  getActiveTab(): IdePanelTab | undefined {
    return this.panel.tabs.find(tab => tab.isActive);
  }
}
