// Author: Preston Lee

import { Component, signal, ElementRef, HostBinding, AfterViewInit, viewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { SettingsService } from '../../services/settings.service';
import { Library } from 'fhir/r4';

interface BundleFile {
  id: string;
  file: File;
  name: string;
  size: number;
  isValid: boolean;
  error?: string;
  enabled: boolean;
  uploadResult?: {
    success: boolean;
    error?: string;
    result?: any;
  };
}

interface CqlFile {
  id: string;
  file: File;
  name: string;
  size: number;
  isValid: boolean;
  error?: string;
  enabled: boolean;
  cqlContent?: string;
  fhirLibrary?: any;
  uploadResult?: {
    success: boolean;
    error?: string;
    result?: any;
  };
}

@Component({
  selector: 'app-fhir-uploader',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './fhir-uploader.component.html',
  styleUrl: './fhir-uploader.component.scss'
})
export class FhirUploaderComponent implements AfterViewInit {
  protected readonly files = signal<BundleFile[]>([]);
  protected readonly cqlFiles = signal<CqlFile[]>([]);
  protected readonly fhirBaseUrl = signal<string>('');
  protected readonly continueOnError = signal<boolean>(false);
  protected readonly isUploading = signal<boolean>(false);
  protected readonly uploadProgress = signal<number>(0);
  protected readonly isDragOver = signal<boolean>(false);
  protected readonly isCqlDragOver = signal<boolean>(false);
  protected readonly draggedFileId = signal<string | null>(null);
  protected readonly expandedResult = signal<string | null>(null);
  protected readonly isExpunging = signal<boolean>(false);
  protected readonly isPurging = signal<boolean>(false);
  protected readonly showExpungeModal = signal<boolean>(false);
  protected readonly showPurgeModal = signal<boolean>(false);
  protected readonly showUploadModal = signal<boolean>(false);
  protected readonly modalMessage = signal<string>('');
  protected readonly modalTitle = signal<string>('');
  protected readonly modalType = signal<'success' | 'error' | 'warning'>('success');

  @HostBinding('class.modal-open')
  get hasModalOpen(): boolean {
    return this.showExpungeModal() || this.showPurgeModal() || this.showUploadModal();
  }

  expungeConfirmButton = viewChild<ElementRef<HTMLButtonElement>>('expungeConfirmButton');
  purgeConfirmButton = viewChild<ElementRef<HTMLButtonElement>>('purgeConfirmButton');
  resultModalButton = viewChild<ElementRef<HTMLButtonElement>>('resultModalButton');

  protected settingsService = inject(SettingsService);
  private router = inject(Router);

  constructor() {
    // Initialize with the effective FHIR base URL from settings
    this.fhirBaseUrl.set(this.settingsService.getEffectiveFhirBaseUrl());
  }

  getEffectiveFhirBaseUrl(): string {
    return this.settingsService.getEffectiveFhirBaseUrl();
  }

  navigateToSettings(event: Event): void {
    event.preventDefault();
    this.router.navigate(['/settings']);
  }

  ngAfterViewInit(): void {
    // Focus management will be handled by the template
  }

  private focusModalButton(buttonRef: ElementRef<HTMLButtonElement> | undefined): void {
    if (buttonRef?.nativeElement) {
      // Use setTimeout to ensure the DOM is updated
      setTimeout(() => {
        buttonRef.nativeElement.focus();
      }, 0);
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(false);

    const files = event.dataTransfer?.files;
    if (files) {
      this.addFiles(Array.from(files));
    }
  }

  onFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files) {
      this.addFiles(Array.from(input.files));
    }
  }

  onCqlDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isCqlDragOver.set(true);
  }

  onCqlDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isCqlDragOver.set(false);
  }

  onCqlDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isCqlDragOver.set(false);

    const files = event.dataTransfer?.files;
    if (files) {
      this.addCqlFiles(Array.from(files));
    }
  }

  onCqlFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files) {
      this.addCqlFiles(Array.from(input.files));
    }
  }

  private addFiles(files: File[]): void {
    const newFiles: BundleFile[] = files
      .filter(file => file.name.toLowerCase().endsWith('.json'))
      .map(file => {
        const id = Math.random().toString(36).substr(2, 9);
        return {
          id,
          file,
          name: file.name,
          size: file.size,
          isValid: false,
          error: undefined,
          enabled: true
        };
      });

    // Validate each file
    newFiles.forEach(bundleFile => {
      this.validateBundleFile(bundleFile);
    });

    this.files.set([...this.files(), ...newFiles]);
  }

  private addCqlFiles(files: File[]): void {
    const newCqlFiles: CqlFile[] = files
      .filter(file => file.name.toLowerCase().endsWith('.cql'))
      .map(file => {
        const id = Math.random().toString(36).substr(2, 9);
        return {
          id,
          file,
          name: file.name,
          size: file.size,
          isValid: false,
          error: undefined,
          enabled: true
        };
      });

    // Process each CQL file
    newCqlFiles.forEach(cqlFile => {
      this.processCqlFile(cqlFile);
    });

    this.cqlFiles.set([...this.cqlFiles(), ...newCqlFiles]);
  }

  private async validateBundleFile(bundleFile: BundleFile): Promise<void> {
    try {
      const text = await this.readFileAsText(bundleFile.file);
      const json = JSON.parse(text);
      
      // Check if it's a valid FHIR Bundle
      if (json.resourceType === 'Bundle' && Array.isArray(json.entry)) {
        bundleFile.isValid = true;
        bundleFile.error = undefined;
      } else {
        bundleFile.isValid = false;
        bundleFile.error = 'Not a valid FHIR Bundle resource';
      }
    } catch (error) {
      bundleFile.isValid = false;
      bundleFile.error = 'Invalid JSON or file read error';
    }
  }

  private async processCqlFile(cqlFile: CqlFile): Promise<void> {
    try {
      const cqlContent = await this.readFileAsText(cqlFile.file);
      cqlFile.cqlContent = cqlContent;
      
      // Convert CQL to FHIR Library resource
      const fhirLibrary = this.convertCqlToFhirLibrary(cqlContent, cqlFile.name);
      cqlFile.fhirLibrary = fhirLibrary;
      cqlFile.isValid = true;
      cqlFile.error = undefined;
    } catch (error) {
      cqlFile.isValid = false;
      cqlFile.error = 'Error reading or processing CQL file';
    }
  }

  private convertCqlToFhirLibrary(cqlContent: string, fileName: string): any {
    // Extract library name from CQL content or use filename
    const libraryNameMatch = cqlContent.match(/library\s+(\w+)/i);
    const libraryName = libraryNameMatch ? libraryNameMatch[1] : fileName.replace('.cql', '');
    
    // Extract version if present
    const versionMatch = cqlContent.match(/using\s+FHIR\s+version\s+['"]([^'"]+)['"]/i);
    const fhirVersion = versionMatch ? versionMatch[1] : '4.0.1';
    
    // Extract description from comments
    const descriptionMatch = cqlContent.match(/\/\*\*([^*]+)\*\//s);
    const description = descriptionMatch ? descriptionMatch[1].trim() : `CQL Library: ${libraryName}`;
    
    // Extract version from CQL content if present
    const cqlVersionMatch = cqlContent.match(/version\s+['"]([^'"]+)['"]/i);
    const cqlVersion = cqlVersionMatch ? cqlVersionMatch[1] : '0.0.0';
    
    // Create a canonical URL for the library using the effective FHIR server base URL from settings
    // const libraryId = libraryName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const effectiveFhirBaseUrl = this.settingsService.getEffectiveFhirBaseUrl();
    const canonicalUrl = `${effectiveFhirBaseUrl}/Library/${libraryName}`;
    
    // Create FHIR Library resource
    const library: Library = {
      resourceType: 'Library',
      type: {      },
      id: libraryName,
      version: cqlVersion,
      name: libraryName,
      title: libraryName,
      status: 'active',
      description: description,
      url: canonicalUrl,
      content: [
        {
          contentType: 'text/cql',
          data: btoa(cqlContent)
        }
      ],
    };
    console.log(library); 
    return library;
  }

  private readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  removeFile(id: string): void {
    this.files.set(this.files().filter(file => file.id !== id));
  }

  moveFileUp(id: string): void {
    const currentFiles = [...this.files()];
    const index = currentFiles.findIndex(file => file.id === id);
    if (index > 0) {
      [currentFiles[index - 1], currentFiles[index]] = [currentFiles[index], currentFiles[index - 1]];
      this.files.set(currentFiles);
    }
  }

  moveFileDown(id: string): void {
    const currentFiles = [...this.files()];
    const index = currentFiles.findIndex(file => file.id === id);
    if (index < currentFiles.length - 1) {
      [currentFiles[index], currentFiles[index + 1]] = [currentFiles[index + 1], currentFiles[index]];
      this.files.set(currentFiles);
    }
  }

  onFileDragStart(event: DragEvent, fileId: string): void {
    this.draggedFileId.set(fileId);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', fileId);
    }
  }

  onFileDragOver(event: DragEvent, targetFileId: string): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  onFileDrop(event: DragEvent, targetFileId: string): void {
    event.preventDefault();
    const draggedId = this.draggedFileId();
    
    if (draggedId && draggedId !== targetFileId) {
      // Check if it's a JSON file
      const currentFiles = [...this.files()];
      const draggedIndex = currentFiles.findIndex(file => file.id === draggedId);
      const targetIndex = currentFiles.findIndex(file => file.id === targetFileId);
      
      if (draggedIndex !== -1 && targetIndex !== -1) {
        // Remove the dragged file from its current position
        const draggedFile = currentFiles.splice(draggedIndex, 1)[0];
        // Insert it at the target position
        currentFiles.splice(targetIndex, 0, draggedFile);
        this.files.set(currentFiles);
      } else {
        // Check if it's a CQL file
        const currentCqlFiles = [...this.cqlFiles()];
        const draggedCqlIndex = currentCqlFiles.findIndex(file => file.id === draggedId);
        const targetCqlIndex = currentCqlFiles.findIndex(file => file.id === targetFileId);
        
        if (draggedCqlIndex !== -1 && targetCqlIndex !== -1) {
          // Remove the dragged file from its current position
          const draggedFile = currentCqlFiles.splice(draggedCqlIndex, 1)[0];
          // Insert it at the target position
          currentCqlFiles.splice(targetCqlIndex, 0, draggedFile);
          this.cqlFiles.set(currentCqlFiles);
        }
      }
    }
    
    this.draggedFileId.set(null);
  }

  onFileDragEnd(): void {
    this.draggedFileId.set(null);
  }

  toggleFileEnabled(fileId: string): void {
    const currentFiles = [...this.files()];
    const fileIndex = currentFiles.findIndex(file => file.id === fileId);
    if (fileIndex !== -1) {
      currentFiles[fileIndex].enabled = !currentFiles[fileIndex].enabled;
      this.files.set(currentFiles);
    }
  }

  toggleAllFiles(): void {
    const currentFiles = [...this.files()];
    const currentCqlFiles = [...this.cqlFiles()];
    
    currentFiles.forEach(file => {
      file.enabled = !file.enabled;
    });
    
    currentCqlFiles.forEach(file => {
      file.enabled = !file.enabled;
    });
    
    this.files.set(currentFiles);
    this.cqlFiles.set(currentCqlFiles);
  }

  removeCqlFile(id: string): void {
    this.cqlFiles.set(this.cqlFiles().filter(file => file.id !== id));
  }

  moveCqlFileUp(id: string): void {
    const currentCqlFiles = [...this.cqlFiles()];
    const index = currentCqlFiles.findIndex(file => file.id === id);
    if (index > 0) {
      [currentCqlFiles[index - 1], currentCqlFiles[index]] = [currentCqlFiles[index], currentCqlFiles[index - 1]];
      this.cqlFiles.set(currentCqlFiles);
    }
  }

  moveCqlFileDown(id: string): void {
    const currentCqlFiles = [...this.cqlFiles()];
    const index = currentCqlFiles.findIndex(file => file.id === id);
    if (index < currentCqlFiles.length - 1) {
      [currentCqlFiles[index], currentCqlFiles[index + 1]] = [currentCqlFiles[index + 1], currentCqlFiles[index]];
      this.cqlFiles.set(currentCqlFiles);
    }
  }

  toggleCqlFileEnabled(fileId: string): void {
    const currentCqlFiles = [...this.cqlFiles()];
    const fileIndex = currentCqlFiles.findIndex(file => file.id === fileId);
    if (fileIndex !== -1) {
      currentCqlFiles[fileIndex].enabled = !currentCqlFiles[fileIndex].enabled;
      this.cqlFiles.set(currentCqlFiles);
    }
  }


  async uploadBundles(): Promise<void> {
    const enabledFiles = this.files().filter(file => file.enabled);
    const enabledCqlFiles = this.cqlFiles().filter(file => file.enabled);
    
    if (enabledFiles.length === 0 && enabledCqlFiles.length === 0) {
      alert('Please enable at least one file to upload.');
      return;
    }

    const invalidEnabledFiles = enabledFiles.filter(file => !file.isValid);
    const invalidEnabledCqlFiles = enabledCqlFiles.filter(file => !file.isValid);
    
    if (invalidEnabledFiles.length > 0 || invalidEnabledCqlFiles.length > 0) {
      alert(`Please fix ${invalidEnabledFiles.length + invalidEnabledCqlFiles.length} invalid enabled file(s) before uploading.`);
      return;
    }

    const effectiveFhirBaseUrl = this.settingsService.getEffectiveFhirBaseUrl();
    if (!effectiveFhirBaseUrl.trim()) {
      alert('Please configure a FHIR Base URL in Application Settings.');
      return;
    }

    this.isUploading.set(true);
    this.uploadProgress.set(0);

    const totalFiles = enabledFiles.length + enabledCqlFiles.length;
    let processedFiles = 0;

    try {
      // Upload JSON bundles first
      for (let i = 0; i < enabledFiles.length; i++) {
        const bundleFile = enabledFiles[i];
        this.uploadProgress.set((processedFiles / totalFiles) * 100);

        try {
          const result = await this.uploadSingleBundle(bundleFile);
          // Update the file with success result
          this.updateFileResult(bundleFile.id, {
            success: true,
            result
          });
        } catch (error) {
          // Update the file with error result
          this.updateFileResult(bundleFile.id, {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          });

          if (!this.continueOnError()) {
            break;
          }
        }
        processedFiles++;
      }

      // Upload CQL files as FHIR Library resources
      for (let i = 0; i < enabledCqlFiles.length; i++) {
        const cqlFile = enabledCqlFiles[i];
        this.uploadProgress.set((processedFiles / totalFiles) * 100);

        try {
          const result = await this.uploadSingleCqlFile(cqlFile);
          // Update the file with success result
          this.updateCqlFileResult(cqlFile.id, {
            success: true,
            result
          });
        } catch (error) {
          // Update the file with error result
          this.updateCqlFileResult(cqlFile.id, {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          });

          if (!this.continueOnError()) {
            break;
          }
        }
        processedFiles++;
      }

      this.uploadProgress.set(100);
    } finally {
      this.isUploading.set(false);
    }
  }

  private async uploadSingleBundle(bundleFile: BundleFile): Promise<any> {
    const text = await this.readFileAsText(bundleFile.file);
    const bundle = JSON.parse(text);

    const effectiveFhirBaseUrl = this.settingsService.getEffectiveFhirBaseUrl();
    const response = await fetch(effectiveFhirBaseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/fhir+json',
        'Accept': 'application/fhir+json'
      },
      body: text
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  }

  private async uploadSingleCqlFile(cqlFile: CqlFile): Promise<any> {
    if (!cqlFile.fhirLibrary) {
      throw new Error('CQL file has not been processed into a FHIR Library resource');
    }

    const effectiveFhirBaseUrl = this.settingsService.getEffectiveFhirBaseUrl();
    const libraryId = cqlFile.fhirLibrary.id;
    const response = await fetch(`${effectiveFhirBaseUrl}/Library/${libraryId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/fhir+json',
        'Accept': 'application/fhir+json'
      },
      body: JSON.stringify(cqlFile.fhirLibrary)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  getEnabledFilesCount(): number {
    return this.files().filter(file => file.enabled).length + this.cqlFiles().filter(file => file.enabled).length;
  }

  hasEnabledFiles(): boolean {
    return this.getEnabledFilesCount() > 0;
  }

  updateFileResult(fileId: string, result: { success: boolean; error?: string; result?: any }): void {
    const currentFiles = this.files().map(file => 
      file.id === fileId 
        ? { ...file, uploadResult: result }
        : file
    );
    this.files.set(currentFiles);
  }

  updateCqlFileResult(fileId: string, result: { success: boolean; error?: string; result?: any }): void {
    const currentCqlFiles = this.cqlFiles().map(file => 
      file.id === fileId 
        ? { ...file, uploadResult: result }
        : file
    );
    this.cqlFiles.set(currentCqlFiles);
  }

  toggleResultExpansion(fileId: string): void {
    if (this.expandedResult() === fileId) {
      this.expandedResult.set(null);
    } else {
      this.expandedResult.set(fileId);
    }
  }

  isResultExpanded(fileId: string): boolean {
    return this.expandedResult() === fileId;
  }

  formatJsonResponse(response: any): string {
    return JSON.stringify(response, null, 2);
  }

  showModal(title: string, message: string, type: 'success' | 'error' | 'warning' = 'success'): void {
    this.modalTitle.set(title);
    this.modalMessage.set(message);
    this.modalType.set(type);
    this.showUploadModal.set(true);
    // Focus the OK button after the modal is shown
    setTimeout(() => {
      this.focusModalButton(this.resultModalButton());
    }, 100);
  }

  closeModal(): void {
    this.showUploadModal.set(false);
    this.showExpungeModal.set(false);
    this.showPurgeModal.set(false);
  }

  showExpungeConfirmation(): void {
    this.showExpungeModal.set(true);
    // Focus the confirm button after the modal is shown
    setTimeout(() => {
      this.focusModalButton(this.expungeConfirmButton());
    }, 100);
  }

  showPurgeConfirmation(): void {
    this.showPurgeModal.set(true);
    // Focus the confirm button after the modal is shown
    setTimeout(() => {
      this.focusModalButton(this.purgeConfirmButton());
    }, 100);
  }

  confirmExpunge(): void {
    this.showExpungeModal.set(false);
    this.expungeServer();
  }

  confirmPurge(): void {
    this.showPurgeModal.set(false);
    this.purgeAllServer();
  }

  async expungeServer(): Promise<void> {
    this.isExpunging.set(true);
    try {
      // HAPI FHIR expunge operation
      const effectiveFhirBaseUrl = this.settingsService.getEffectiveFhirBaseUrl();
      const response = await fetch(`${effectiveFhirBaseUrl}/$expunge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/fhir+json',
          'Accept': 'application/fhir+json'
        },
        body: JSON.stringify({
          resourceType: 'Parameters',
          parameter: [
            {
              name: 'expungeEverything',
              valueBoolean: true
            }
          ]
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      this.showModal('Success', 'Server expunged successfully!', 'success');
      console.log('Expunge result:', result);
    } catch (error) {
      this.showModal('Error', `Failed to expunge server: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
      console.error('Expunge error:', error);
    } finally {
      this.isExpunging.set(false);
    }
  }

  async purgeAllServer(): Promise<void> {
    this.isPurging.set(true);
    try {
      // WildFHIR purge operation
      const effectiveFhirBaseUrl = this.settingsService.getEffectiveFhirBaseUrl();
      const response = await fetch(`${effectiveFhirBaseUrl}/$purge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/fhir+json',
          'Accept': 'application/fhir+json'
        },
        body: JSON.stringify({
          resourceType: 'Parameters',
          parameter: [
            {
              name: 'purgeAll',
              valueBoolean: true
            }
          ]
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      this.showModal('Success', 'Server purged successfully!', 'success');
      console.log('Purge result:', result);
    } catch (error) {
      this.showModal('Error', `Failed to purge server: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
      console.error('Purge error:', error);
    } finally {
      this.isPurging.set(false);
    }
  }
}
