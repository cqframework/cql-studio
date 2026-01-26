// Author: Preston Lee

import { Component, input, output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

@Component({
  selector: 'app-ide-header',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ide-header.component.html',
  styleUrls: ['./ide-header.component.scss']
})
export class IdeHeaderComponent {
  libraryResources = input<any[]>([]);
  activeLibraryId = input<string | null>(null);
  isExecuting = input<boolean>(false);
  isEvaluating = input<boolean>(false);
  isTranslating = input<boolean>(false);
  
  libraryIdChange = output<string>();
  libraryVersionChange = output<string>();
  libraryDescriptionChange = output<string>();
  saveLibrary = output<void>();
  deleteLibrary = output<string>();
  translateCqlToElm = output<void>();
  clearElmTranslation = output<void>();
  executeAll = output<void>();

  router = inject(Router);

  onLibraryIdChange(libraryId: string): void {
    this.libraryIdChange.emit(libraryId);
  }

  onLibraryVersionChange(version: string): void {
    this.libraryVersionChange.emit(version);
  }

  onLibraryDescriptionChange(description: string): void {
    this.libraryDescriptionChange.emit(description);
  }

  onSaveLibrary(): void {
    this.saveLibrary.emit();
  }

  onDeleteLibrary(libraryId: string): void {
    this.deleteLibrary.emit(libraryId);
  }

  onTranslateCqlToElm(): void {
    this.translateCqlToElm.emit();
  }

  onClearElmTranslation(): void {
    this.clearElmTranslation.emit();
  }

  onExecuteAll(): void {
    this.executeAll.emit();
  }

  onNavigateToSettings(): void {
    this.router.navigate(['/settings']);
  }
}
