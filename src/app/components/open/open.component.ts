// Author: Preston Lee

import { Component, signal, OnInit, inject } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { FileLoaderService } from '../../services/file-loader.service';
import { SchemaValidationService } from '../../services/schema-validation.service';
import { SettingsService } from '../../services/settings.service';
import { SessionStorageKeys } from '../../constants/session-storage.constants';
import { CqlTestResults } from '../../models/cql-test-results.model';

@Component({
  selector: 'app-open',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './open.component.html',
  styleUrl: './open.component.scss'
})
export class OpenComponent implements OnInit {
  urlInput = signal('');
  isLoading = signal(false);
  errorMessage = signal('');
  validationErrors = signal<string[]>([]);
  selectedFile = signal<File | null>(null);
  lastLoadedData = signal<CqlTestResults | null>(null);
  
  // Index file related signals
  indexUrl = signal('');
  indexFiles = signal<string[]>([]);
  indexLoading = signal(false);
  indexError = signal('');

  private fileLoader = inject(FileLoaderService);
  private schemaValidation = inject(SchemaValidationService);
  public settingsService = inject(SettingsService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  ngOnInit(): void {
    // Check for URL query parameter
    const urlParam = this.route.snapshot.queryParams['url'];
    if (urlParam) {
      this.loadFromUrl(urlParam);
    }
    
    // Check for index query parameter
    const indexParam = this.route.snapshot.queryParams['index'];
    if (indexParam) {
      this.loadIndexFile(indexParam);
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    
    if (file) {
      this.loadFile(file);
    }
  }

  onUrlSubmit(): void {
    const url = this.urlInput().trim();
    if (url) {
      this.loadFromUrl(url);
    }
  }

  onLoadUrlExample(): void {
    this.loadFromUrl('/examples/results.json');
  }


  onLoadIndexFile(): void {
    const url = this.indexUrl().trim();
    if (url) {
      this.loadIndexFile(url);
    }
  }

  onLoadExampleIndex(): void {
    this.loadIndexFile(this.settingsService.getEffectiveTestResultsIndexUrl());
  }

  onLoadFileFromIndex(filename: string): void {
    const baseUrl = this.getBaseUrlFromIndexUrl();
    const fileUrl = `${baseUrl}/${filename}`;
    
    // Store the index URL for the "Back to Home" functionality
    sessionStorage.setItem(SessionStorageKeys.INDEX_URL, this.indexUrl());
    
    // Load the file and update URL with the specific file URL
    this.loadFromUrlWithIndex(fileUrl);
  }

  onOpenDashboard(): void {
    // Store the index URL and files for the dashboard
    sessionStorage.setItem(SessionStorageKeys.INDEX_URL, this.indexUrl());
    sessionStorage.setItem(SessionStorageKeys.INDEX_FILES, JSON.stringify(this.indexFiles()));
    
    // Navigate to dashboard with index query parameter preserved
    const queryParams: any = {};
    if (this.indexUrl()) {
      queryParams['index'] = this.indexUrl();
    }
    
    this.router.navigate(['/dashboard'], { queryParams });
  }

  onValidateSchemaChange(): void {
    this.settingsService.saveSettings();
  }

  clearSelectedFile(): void {
    this.selectedFile.set(null);
    this.lastLoadedData.set(null);
    this.errorMessage.set('');
    this.validationErrors.set([]);
    // Clear the file input
    const fileInput = document.getElementById('fileInput') as HTMLInputElement;
    if (fileInput) {
      fileInput.value = '';
    }
  }

  async rerunValidation(): Promise<void> {
    const file = this.selectedFile();
    if (file) {
      await this.loadFile(file);
    }
  }

  private async loadFile(file: File): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set('');
    this.validationErrors.set([]);
    this.selectedFile.set(file);

    try {
      const data = await this.fileLoader.loadFromFile(file);
      this.lastLoadedData.set(data);
      // Store the original filename
      sessionStorage.setItem(SessionStorageKeys.ORIGINAL_FILENAME, file.name);
      await this.validateAndNavigate(data);
    } catch (error) {
      this.errorMessage.set((error as Error).message);
    } finally {
      this.isLoading.set(false);
    }
  }

  private async loadFromUrl(url: string): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set('');
    this.validationErrors.set([]);

    try {
      const data = await this.fileLoader.loadFromUrl(url);
      // Extract filename from URL
      const filename = this.extractFilenameFromUrl(url);
      sessionStorage.setItem(SessionStorageKeys.ORIGINAL_FILENAME, filename);
      await this.validateAndNavigateWithUrl(data, url);
    } catch (error) {
      this.errorMessage.set((error as Error).message);
    } finally {
      this.isLoading.set(false);
    }
  }

  private async loadFromUrlWithIndex(url: string): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set('');
    this.validationErrors.set([]);

    try {
      const data = await this.fileLoader.loadFromUrl(url);
      // Extract filename from URL
      const filename = this.extractFilenameFromUrl(url);
      sessionStorage.setItem(SessionStorageKeys.ORIGINAL_FILENAME, filename);
      await this.validateAndNavigateWithUrl(data, url);
    } catch (error) {
      this.errorMessage.set((error as Error).message);
    } finally {
      this.isLoading.set(false);
    }
  }


  private async loadIndexFile(url: string): Promise<void> {
    this.indexLoading.set(true);
    this.indexError.set('');
    this.indexUrl.set(url);

    try {
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to load index file: ${response.statusText}`);
      }
      
      const indexData = await response.json();
      
      if (!indexData.files || !Array.isArray(indexData.files)) {
        throw new Error('Invalid index file format. Expected object with "files" array.');
      }
      
      this.indexFiles.set(indexData.files);
    } catch (error) {
      this.indexError.set((error as Error).message);
      this.indexFiles.set([]);
    } finally {
      this.indexLoading.set(false);
    }
  }

  private getBaseUrlFromIndexUrl(): string {
    const indexUrl = this.indexUrl();
    try {
      const urlObj = new URL(indexUrl);
      return `${urlObj.protocol}//${urlObj.host}${urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/'))}`;
    } catch (error) {
      // If URL parsing fails, try to extract base URL from the string
      const lastSlashIndex = indexUrl.lastIndexOf('/');
      return lastSlashIndex > 0 ? indexUrl.substring(0, lastSlashIndex) : indexUrl;
    }
  }

  private extractFilenameFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const filename = pathname.split('/').pop() || 'results.json';
      return filename;
    } catch (error) {
      // If URL parsing fails, try to extract filename from the end of the string
      const filename = url.split('/').pop() || 'results.json';
      return filename.includes('.') ? filename : 'results.json';
    }
  }

  private async validateAndNavigate(data: CqlTestResults): Promise<void> {
    // Clear indexUrl since this file is not loaded from an index
    sessionStorage.removeItem(SessionStorageKeys.INDEX_URL);
    
    // Check if schema validation is enabled
    if (this.settingsService.settings().validateSchema) {
      const validation = await this.schemaValidation.validateResults(data);
      
      if (validation.isValid) {
        // Store data in sessionStorage for the results viewer
        sessionStorage.setItem(SessionStorageKeys.CQL_TEST_RESULTS, JSON.stringify(data));
        this.router.navigate(['/results']);
      } else {
        this.validationErrors.set(validation.errors);
      }
    } else {
      // Skip validation, just store and navigate
      sessionStorage.setItem(SessionStorageKeys.CQL_TEST_RESULTS, JSON.stringify(data));
      this.router.navigate(['/results']);
    }
  }

  private async validateAndNavigateWithUrl(data: CqlTestResults, fileUrl: string): Promise<void> {
    // Check if schema validation is enabled
    if (this.settingsService.settings().validateSchema) {
      const validation = await this.schemaValidation.validateResults(data);
      
      if (validation.isValid) {
        // Store data in sessionStorage for the results viewer
        sessionStorage.setItem(SessionStorageKeys.CQL_TEST_RESULTS, JSON.stringify(data));
        // Navigate with the file URL and preserve all existing query parameters
        this.navigateToResultsWithParams(fileUrl);
      } else {
        this.validationErrors.set(validation.errors);
      }
    } else {
      // Skip validation, just store and navigate
      sessionStorage.setItem(SessionStorageKeys.CQL_TEST_RESULTS, JSON.stringify(data));
      // Navigate with the file URL and preserve all existing query parameters
      this.navigateToResultsWithParams(fileUrl);
    }
  }

  private navigateToResultsWithParams(fileUrl: string): void {
    // Get current query parameters and preserve them
    const currentParams = this.route.snapshot.queryParams;
    const queryParams = { ...currentParams, url: fileUrl };
    
    // Navigate to results page with all parameters
    this.router.navigate(['/results'], { queryParams });
  }
}
