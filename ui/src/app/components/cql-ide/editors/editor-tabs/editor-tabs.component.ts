// Author: Preston Lee

import {Component, ChangeDetectionStrategy, output, OnInit, inject, signal} from '@angular/core';
import { IdeStateService } from '../../../../services/ide-state.service';
import { LibraryResource } from '../../shared/ide-types';

@Component({
  selector: 'app-editor-tabs',
  templateUrl: './editor-tabs.component.html',

  styleUrls: ['./editor-tabs.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EditorTabsComponent implements OnInit {
  selectLibrary = output<string>();
  closeLibrary = output<string>();
  reorderTabs = output<{ fromIndex: number; toIndex: number }>();

  protected readonly ideStateService = inject(IdeStateService);
  protected readonly isDragOver = signal(false);

  protected readonly libraryResources = this.ideStateService.libraryResources;
  protected readonly activeLibraryId = this.ideStateService.activeLibraryId;

  ngOnInit(): void {
    // Component initialization
  }

  onSelectLibrary(libraryId: string): void {
    this.selectLibrary.emit(libraryId);
  }

  onCloseLibrary(libraryId: string, event: Event): void {
    event.stopPropagation();
    this.closeLibrary.emit(libraryId);
  }

  onTabDragStart(event: DragEvent, libraryId: string): void {
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', libraryId);
    }
  }

  onTabDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  onTabDragEnter(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(true);
  }

  onTabDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(false);
  }

  onTabDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(false);
    
    try {
      const libraryId = event.dataTransfer?.getData('text/plain');
      if (!libraryId) return;

      const currentResources = this.libraryResources();
      const fromIndex = currentResources.findIndex(lib => lib.id === libraryId);
      if (fromIndex === -1) return;

      // Find the target index based on the drop position
      const targetIndex = this.getDropTargetIndex(event, fromIndex);
      if (targetIndex === fromIndex) return; // No change needed

      // Reorder the libraries
      this.ideStateService.reorderLibraryResources(fromIndex, targetIndex);
    } catch (error) {
      console.error('Error handling tab drop:', error);
    }
  }

  onTabDropAtPosition(event: DragEvent, targetPosition: number): void {
    event.preventDefault();
    this.isDragOver.set(false);
    
    try {
      const libraryId = event.dataTransfer?.getData('text/plain');
      if (!libraryId) return;

      const currentResources = this.libraryResources();
      const fromIndex = currentResources.findIndex(lib => lib.id === libraryId);
      if (fromIndex === -1) return;

      // Handle special positions
      let toIndex: number;
      if (targetPosition === -1) {
        // Drop at the end - insert after the last item
        toIndex = currentResources.length;
        // If already at the end, no change needed
        if (fromIndex === currentResources.length - 1) return;
      } else {
        // Drop at the beginning
        toIndex = 0;
        // If already at the beginning, no change needed
        if (fromIndex === 0) return;
      }

      // Reorder the libraries
      this.ideStateService.reorderLibraryResources(fromIndex, toIndex);
    } catch (error) {
      console.error('Error handling tab drop at position:', error);
    }
  }

  private getDropTargetIndex(event: DragEvent, fromIndex: number): number {
    // Get all tab elements
    const tabElements = Array.from(document.querySelectorAll('.editor-tab'));
    const targetElement = event.target as HTMLElement;
    
    // Find the closest tab element
    const closestTab = targetElement.closest('.editor-tab');
    if (!closestTab) return fromIndex;

    // Find the index of the target tab
    const targetTabIndex = tabElements.indexOf(closestTab);
    if (targetTabIndex === -1) return fromIndex;

    // Determine if we should insert before or after the target
    const rect = closestTab.getBoundingClientRect();
    const mouseX = event.clientX;
    const tabCenter = rect.left + rect.width / 2;
    
    // If mouse is in the left half, insert before; otherwise insert after
    return mouseX < tabCenter ? targetTabIndex : targetTabIndex + 1;
  }

  trackByLibraryId(index: number, library: LibraryResource): string {
    return library.id;
  }
}
