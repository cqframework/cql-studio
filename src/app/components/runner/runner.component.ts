// Author: Preston Lee

import { Component, OnInit, signal, AfterViewInit, ElementRef, viewChild, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { RunnerService, CQLTestConfiguration, JobResponse, JobStatus } from '../../services/runner.service';
import { FileLoaderService } from '../../services/file-loader.service';
import { SettingsService } from '../../services/settings.service';
import { ToastService } from '../../services/toast.service';
import { interval, Subscription, firstValueFrom } from 'rxjs';
import { switchMap, takeWhile } from 'rxjs/operators';
import { SessionStorageKeys } from '../../constants/session-storage.constants';
import { SyntaxHighlighterComponent } from '../shared/syntax-highlighter/syntax-highlighter.component';

// Import CodeMirror
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { json } from '@codemirror/lang-json';

@Component({
  selector: 'app-runner',
  standalone: true,
  imports: [CommonModule, FormsModule, SyntaxHighlighterComponent],
  templateUrl: './runner.component.html',
  styleUrl: './runner.component.scss'
})
export class RunnerComponent implements OnInit, AfterViewInit, OnDestroy {
  // Configuration form data
  protected readonly config = signal<CQLTestConfiguration>({
    FhirServer: {
      BaseUrl: '', // Will be set from settings in ngOnInit
      CqlOperation: '$cql'
    },
    Build: {
      CqlFileVersion: '1.0.000',
      CqlOutputPath: './cql',
      CqlVersion: '1.5.3',
      testsRunDescription: 'Quick Test Run'
    },
    Debug: {
      QuickTest: true
    },
    Tests: {
      ResultsPath: './results',
      SkipList: []
    }
  });
  
  // UI state
  protected readonly isCreatingJob = signal(false);
  protected readonly isPolling = signal(false);
  protected readonly isCheckingHealth = signal(false);
  protected readonly currentJob = signal<JobResponse | null>(null);
  protected readonly jobStatus = signal<JobStatus | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly showJsonEditor = signal(false);
  protected readonly jsonConfig = signal<string>('');
  protected readonly healthStatus = signal<{ status: string; timestamp: string } | null>(null);
  
  // API availability state
  protected readonly apiUnavailable = signal(false);
  protected readonly lastApiCheck = signal<Date | null>(null);
  protected readonly connectionError = signal<string | null>(null);
  
  private pollingSubscription?: Subscription;
  private timerSubscription?: Subscription;
  private apiCheckTimerSubscription?: Subscription;
  private codeMirrorEditor?: EditorView;

  jsonEditorContainer = viewChild<ElementRef<HTMLDivElement>>('jsonEditorContainer');

  private runnerService = inject(RunnerService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private fileLoader = inject(FileLoaderService);
  private settingsService = inject(SettingsService);
  private toastService = inject(ToastService);

  ngOnInit(): void {
    // Initialize FHIR URL from settings
    const currentConfig = this.config();
    this.config.set({
      ...currentConfig,
      FhirServer: {
        ...currentConfig.FhirServer,
        BaseUrl: this.settingsService.getEffectiveRunnerFhirBaseUrl()
      }
    });
    
    // Check if there's a URL parameter to load configuration from
    const params = this.route.snapshot.queryParams;
    if (params['url']) {
      this.loadFromUrl(params['url']);
    } else {
      this.updateJsonConfig();
    }
    
    // Start API check timer if we have a last check time
    if (this.lastApiCheck()) {
      this.startApiCheckTimer();
    }
    
    // Automatically run health check on component load
    this.checkApiHealth();
  }

  ngAfterViewInit(): void {
    // Initialize CodeMirror when view is ready
    if (this.showJsonEditor()) {
      setTimeout(() => this.initializeCodeMirror(), 100);
    }
  }

  ngOnDestroy(): void {
    this.stopPolling();
    this.stopTimer();
    this.stopApiCheckTimer();
    this.destroyCodeMirror();
  }

  protected async createJob(): Promise<void> {
    this.error.set(null);
    this.connectionError.set(null);
    this.isCreatingJob.set(true);
    
    // Clear previous job state and results
    this.currentJob.set(null);
    this.jobStatus.set(null);
    this.stopPolling();
    this.isPolling.set(false);
    
    // Clear any previous results from sessionStorage
    sessionStorage.removeItem(SessionStorageKeys.CQL_TEST_RESULTS);
    sessionStorage.removeItem(SessionStorageKeys.ORIGINAL_FILENAME);
    sessionStorage.removeItem(SessionStorageKeys.VALIDATION_ERRORS);
    
    // Immediately show progress status with a temporary job
    const tempJobId = `temp-${Date.now()}`;
    const tempJob: JobResponse = {
      jobId: tempJobId,
      status: 'pending',
      message: 'Initializing test run...',
      createdAt: new Date().toISOString()
    };
    this.currentJob.set(tempJob);
    
    // Set initial pending status to show progress immediately
    this.jobStatus.set({
      jobId: tempJobId,
      status: 'pending',
      message: 'Queuing test run for execution...',
      createdAt: new Date().toISOString()
    });
    
    // Start timer immediately for elapsed time updates
    this.startTimer();
    
    try {
      const job = await firstValueFrom(this.runnerService.createJob(this.config()));
      if (job) {
        // Update with real job data
        this.currentJob.set(job);
        this.jobStatus.set({
          jobId: job.jobId,
          status: 'pending',
          message: 'Test run queued for execution and will run as quickly as possible...',
          createdAt: job.createdAt
        });
        
        // Show toast notification that tests are queued
        this.toastService.showWarning(
          'Your tests are queued for execution and will run as quickly as possible. Please do not leave this page.',
          'CQL Tests Queued for Execution'
        );
        
        this.startPolling(job.jobId);
        this.apiUnavailable.set(false); // API is working
      } else {
        this.error.set('Failed to create job - no response received');
        this.currentJob.set(null);
        this.jobStatus.set(null);
        this.stopTimer();
      }
    } catch (error: any) {
      this.handleApiError(error, 'Failed to create job');
      this.currentJob.set(null);
      this.jobStatus.set(null);
      this.stopTimer();
    } finally {
      this.isCreatingJob.set(false);
    }
  }

  private startPolling(jobId: string): void {
    this.isPolling.set(true);
    this.stopPolling(); // Stop any existing polling
    
    this.pollingSubscription = interval(2000) // Poll every 2 seconds
      .pipe(
        switchMap(() => this.runnerService.getJobStatus(jobId)),
        takeWhile((status) => status.status === 'pending' || status.status === 'running', true)
      )
      .subscribe({
        next: (status) => {
          // Update the job status with the real job ID
          this.jobStatus.set({
            ...status,
            jobId: jobId
          });
          
          if (status.status === 'completed' || status.status === 'failed') {
            this.isPolling.set(false);
            this.stopPolling();
            this.stopTimer(); // Stop timer when job completes
          }
        },
        error: (error) => {
          this.handleApiError(error, 'Failed to get job status');
          this.isPolling.set(false);
          this.stopPolling();
          this.stopTimer(); // Stop timer on error
        }
      });
  }

  private stopPolling(): void {
    if (this.pollingSubscription) {
      this.pollingSubscription.unsubscribe();
      this.pollingSubscription = undefined;
    }
  }

  private startTimer(): void {
    this.stopTimer(); // Stop any existing timer
    this.timerSubscription = interval(1000) // Update every second
      .subscribe(() => {
        // Trigger change detection for elapsed time
        // The getElapsedTime() method will be called by the template
      });
  }

  private stopTimer(): void {
    if (this.timerSubscription) {
      this.timerSubscription.unsubscribe();
      this.timerSubscription = undefined;
    }
  }

  private startApiCheckTimer(): void {
    this.stopApiCheckTimer(); // Stop any existing timer
    this.apiCheckTimerSubscription = interval(1000) // Update every second
      .subscribe(() => {
        // Trigger change detection for API check time
        // The getTimeSinceLastCheck() method will be called by the template
      });
  }

  private stopApiCheckTimer(): void {
    if (this.apiCheckTimerSubscription) {
      this.apiCheckTimerSubscription.unsubscribe();
      this.apiCheckTimerSubscription = undefined;
    }
  }

  protected reset(): void {
    this.config.set({
      FhirServer: {
        BaseUrl: this.settingsService.getEffectiveRunnerFhirBaseUrl(),
        CqlOperation: '$cql'
      },
      Build: {
        CqlFileVersion: '1.0.000',
        CqlOutputPath: './cql',
        CqlVersion: '1.5.3',
        testsRunDescription: 'Quick Test Run'
      },
      Debug: {
        QuickTest: true
      },
      Tests: {
        ResultsPath: './results',
        SkipList: []
      }
    });
    this.currentJob.set(null);
    this.jobStatus.set(null);
    this.healthStatus.set(null);
    this.error.set(null);
    this.apiUnavailable.set(false);
    this.connectionError.set(null);
    this.lastApiCheck.set(null);
    this.stopPolling();
    this.stopTimer();
    this.stopApiCheckTimer();
    this.isPolling.set(false);
    
    // Clear any previous results from sessionStorage
    sessionStorage.removeItem(SessionStorageKeys.CQL_TEST_RESULTS);
    sessionStorage.removeItem(SessionStorageKeys.ORIGINAL_FILENAME);
    sessionStorage.removeItem(SessionStorageKeys.VALIDATION_ERRORS);
    
    this.updateJsonConfig();
  }

  protected toggleJsonEditor(): void {
    this.showJsonEditor.set(!this.showJsonEditor());
    if (this.showJsonEditor()) {
      this.updateJsonConfig();
      // Initialize CodeMirror when switching to JSON editor
      setTimeout(() => this.initializeCodeMirror(), 200);
    } else {
      this.destroyCodeMirror();
    }
  }

  protected updateJsonConfig(): void {
    this.jsonConfig.set(JSON.stringify(this.config(), null, 2));
    // Update CodeMirror editor if it exists
    if (this.codeMirrorEditor) {
      this.updateCodeMirrorContent();
    }
  }

  protected loadFromJson(): void {
    if (this.codeMirrorEditor) {
      try {
        const content = this.codeMirrorEditor.state.doc.toString();
        const parsed = JSON.parse(content);
        this.config.set(parsed);
        this.jsonConfig.set(content);
        this.error.set(null);
      } catch (error) {
        this.error.set('Invalid JSON format');
      }
    }
  }

  protected async validateCurrentConfig(): Promise<void> {
    if (!this.codeMirrorEditor) {
      this.toastService.showError(
        'No configuration to validate. Please ensure the JSON editor is open.',
        'Validation Error'
      );
      return;
    }

    try {
      // Get content from CodeMirror editor
      const content = this.codeMirrorEditor.state.doc.toString();
      
      // Parse JSON
      let configData: CQLTestConfiguration;
      try {
        configData = JSON.parse(content);
      } catch (parseError) {
        this.toastService.showError(
          'Invalid JSON format. Please ensure the configuration contains valid JSON.',
          'Validation Error'
        );
        return;
      }

      // Validate configuration using server
      try {
        const validation = await firstValueFrom(this.runnerService.validateConfiguration(configData));
        
        if (validation.valid) {
          this.toastService.showSuccess(
            validation.message || 'Configuration is valid',
            'Validation Successful'
          );
        } else {
          // Validation failed
          let errorDetails: string;
          if (Array.isArray(validation.details)) {
            errorDetails = validation.details.join('; ');
          } else if (validation.details) {
            errorDetails = String(validation.details);
          } else if (validation.message) {
            errorDetails = validation.message;
          } else {
            errorDetails = 'Validation failed';
          }
          this.toastService.showError(
            `Configuration validation failed: ${errorDetails}`,
            'Validation Error'
          );
        }
      } catch (validationError: any) {
        // Handle validation error response
        if (validationError.valid === false) {
          let errorDetails: string;
          if (Array.isArray(validationError.details)) {
            errorDetails = validationError.details.join('; ');
          } else if (validationError.details) {
            errorDetails = String(validationError.details);
          } else if (validationError.message) {
            errorDetails = validationError.message;
          } else {
            errorDetails = 'Validation failed';
          }
          this.toastService.showError(
            `Configuration validation failed: ${errorDetails}`,
            'Validation Error'
          );
        } else {
          // Network or other error
          const errorMessage = validationError.message || 'Failed to validate configuration';
          this.toastService.showError(
            errorMessage,
            'Validation Error'
          );
        }
      }
    } catch (error: any) {
      this.toastService.showError(
        error.message || 'Failed to validate configuration',
        'Validation Error'
      );
    }
  }

  protected triggerFileSelection(): void {
    const fileInput = document.getElementById('config-file-input') as HTMLInputElement;
    if (fileInput) {
      fileInput.click();
    }
  }

  protected async onConfigFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    
    if (!file) {
      return;
    }

    try {
      // Read file content
      const fileContent = await this.readFileAsText(file);
      
      // Parse JSON
      let configData: CQLTestConfiguration;
      try {
        configData = JSON.parse(fileContent);
      } catch (parseError) {
        this.toastService.showError(
          'Invalid JSON format. Please ensure the file contains valid JSON.',
          'File Load Error'
        );
        return;
      }

      // Validate configuration using server
      try {
        const validation = await firstValueFrom(this.runnerService.validateConfiguration(configData));
        
        if (validation.valid) {
          // Load configuration into editor and update config signal
          this.config.set(configData);
          this.jsonConfig.set(fileContent);
          this.error.set(null);
          
          // Update CodeMirror editor if it exists
          if (this.codeMirrorEditor) {
            this.updateCodeMirrorContent();
          }
          
          this.toastService.showSuccess(
            'Configuration loaded and validated successfully',
            'File Loaded'
          );
        } else {
          // Validation failed
          let errorDetails: string;
          if (Array.isArray(validation.details)) {
            errorDetails = validation.details.join('; ');
          } else if (validation.details) {
            errorDetails = String(validation.details);
          } else if (validation.message) {
            errorDetails = validation.message;
          } else {
            errorDetails = 'Validation failed';
          }
          this.toastService.showError(
            `Configuration validation failed: ${errorDetails}`,
            'Validation Error'
          );
        }
      } catch (validationError: any) {
        // Handle validation error response
        if (validationError.valid === false) {
          let errorDetails: string;
          if (Array.isArray(validationError.details)) {
            errorDetails = validationError.details.join('; ');
          } else if (validationError.details) {
            errorDetails = String(validationError.details);
          } else if (validationError.message) {
            errorDetails = validationError.message;
          } else {
            errorDetails = 'Validation failed';
          }
          this.toastService.showError(
            `Configuration validation failed: ${errorDetails}`,
            'Validation Error'
          );
        } else {
          // Network or other error
          const errorMessage = validationError.message || 'Failed to validate configuration';
          this.toastService.showError(
            errorMessage,
            'Validation Error'
          );
        }
      }
    } catch (error: any) {
      this.toastService.showError(
        error.message || 'Failed to read file',
        'File Load Error'
      );
    } finally {
      // Reset file input so the same file can be selected again
      if (input) {
        input.value = '';
      }
    }
  }

  private readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        resolve(content);
      };
      reader.onerror = () => {
        reject(new Error('Error reading file'));
      };
      reader.readAsText(file);
    });
  }

  /**
   * Initialize CodeMirror editor
   */
  private initializeCodeMirror(): void {
    if (!this.jsonEditorContainer()?.nativeElement || this.codeMirrorEditor) {
      return;
    }

    try {
      const startState = EditorState.create({
        doc: this.jsonConfig(),
        extensions: [
          basicSetup,
          json(),
          EditorView.theme({
            '&': {
              height: '400px',
              fontSize: '14px',
              fontFamily: "'Courier New', Courier, monospace"
            },
            '.cm-content': {
              padding: '12px',
              minHeight: '400px'
            },
            '.cm-focused': {
              outline: 'none'
            },
            '.cm-editor': {
              border: '1px solid #dee2e6',
              borderRadius: '0.375rem',
              backgroundColor: '#ffffff'
            },
            '.cm-editor.cm-focused': {
              borderColor: '#0d6efd',
              boxShadow: '0 0 0 0.2rem rgba(13, 110, 253, 0.25)'
            }
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              this.jsonConfig.set(update.state.doc.toString());
            }
          })
        ]
      });

      this.codeMirrorEditor = new EditorView({
        state: startState,
        parent: this.jsonEditorContainer()!.nativeElement
      });
    } catch (error) {
      console.error('Failed to initialize CodeMirror:', error);
      this.error.set('Failed to initialize JSON editor');
    }
  }

  /**
   * Update CodeMirror content
   */
  private updateCodeMirrorContent(): void {
    if (this.codeMirrorEditor) {
      const currentContent = this.codeMirrorEditor.state.doc.toString();
      const newContent = this.jsonConfig();
      
      if (currentContent !== newContent) {
        this.codeMirrorEditor.dispatch({
          changes: {
            from: 0,
            to: currentContent.length,
            insert: newContent
          }
        });
      }
    }
  }

  /**
   * Destroy CodeMirror editor
   */
  private destroyCodeMirror(): void {
    if (this.codeMirrorEditor) {
      this.codeMirrorEditor.destroy();
      this.codeMirrorEditor = undefined;
    }
  }

  protected addSkipItem(): void {
    const currentConfig = this.config();
    const newSkipItem = {
      testsName: '',
      groupName: '',
      testName: '',
      reason: ''
    };
    
    this.config.set({
      ...currentConfig,
      Tests: {
        ...currentConfig.Tests,
        SkipList: [...currentConfig.Tests.SkipList, newSkipItem]
      }
    });
  }

  protected removeSkipItem(index: number): void {
    const currentConfig = this.config();
    const newSkipList = currentConfig.Tests.SkipList.filter((_, i) => i !== index);
    
    this.config.set({
      ...currentConfig,
      Tests: {
        ...currentConfig.Tests,
        SkipList: newSkipList
      }
    });
  }

  protected getStatusBadgeClass(status: string): string {
    switch (status) {
      case 'pending':
        return 'badge bg-warning';
      case 'running':
        return 'badge bg-info';
      case 'completed':
        return 'badge bg-success';
      case 'failed':
        return 'badge bg-danger';
      default:
        return 'badge bg-secondary';
    }
  }

  protected isJobInProgress(): boolean {
    const status = this.jobStatus();
    return status ? (status.status === 'pending' || status.status === 'running') : false;
  }

  protected isJobCompleted(): boolean {
    const status = this.jobStatus();
    return status ? status.status === 'completed' : false;
  }

  protected isJobFailed(): boolean {
    const status = this.jobStatus();
    return status ? status.status === 'failed' : false;
  }

  protected getElapsedTime(): string {
    const job = this.currentJob();
    if (!job) return '';

    const now = new Date();
    const created = new Date(job.createdAt);
    const elapsed = Math.floor((now.getTime() - created.getTime()) / 1000);

    if (elapsed < 60) {
      return `${elapsed} seconds`;
    } else if (elapsed < 3600) {
      const minutes = Math.floor(elapsed / 60);
      const seconds = elapsed % 60;
      return `${minutes}m ${seconds}s`;
    } else {
      const hours = Math.floor(elapsed / 3600);
      const minutes = Math.floor((elapsed % 3600) / 60);
      return `${hours}h ${minutes}m`;
    }
  }

  protected async checkApiHealth(): Promise<void> {
    this.isCheckingHealth.set(true);
    this.error.set(null);
    this.connectionError.set(null);
    this.healthStatus.set(null);
    this.lastApiCheck.set(new Date());
    
    // Start the API check timer to update the "last checked" time
    this.startApiCheckTimer();
    
    try {
      const health = await firstValueFrom(this.runnerService.checkHealth());
      if (health) {
        this.healthStatus.set(health);
        this.apiUnavailable.set(false);
        this.connectionError.set(null);
        this.toastService.showSuccess(
          `API is healthy! Status: ${health.status}`,
          'Health Check Successful'
        );
      } else {
        const errorMessage = 'No response received from health check';
        this.error.set(errorMessage);
        this.apiUnavailable.set(true);
        this.toastService.showError(errorMessage, 'Health Check Failed');
      }
    } catch (error: any) {
      this.handleApiError(error, 'Health check failed', true);
    } finally {
      this.isCheckingHealth.set(false);
    }
  }

  protected downloadResults(): void {
    const jobStatus = this.jobStatus();
    if (!jobStatus?.results) {
      this.error.set('No results available to download');
      return;
    }

    try {
      const jsonString = JSON.stringify(jobStatus.results, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `cql-test-results-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error: any) {
      this.error.set('Failed to download results: ' + (error.message || 'Unknown error'));
    }
  }

  protected viewResults(): void {
    const jobStatus = this.jobStatus();
    if (!jobStatus?.results) {
      this.error.set('No results available to view');
      return;
    }

    try {
      // Store the results in sessionStorage for the results viewer
      sessionStorage.setItem(SessionStorageKeys.CQL_TEST_RESULTS, JSON.stringify(jobStatus.results));
      
      // Store metadata about the source
      sessionStorage.setItem(SessionStorageKeys.ORIGINAL_FILENAME, `cql-test-results-${new Date().toISOString().split('T')[0]}.json`);
      
      // Navigate to the results viewer
      this.router.navigate(['/results']);
    } catch (error: any) {
      this.error.set('Failed to open results: ' + (error.message || 'Unknown error'));
    }
  }

  private async loadFromUrl(url: string): Promise<void> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load configuration: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      // Validate that the loaded data is a valid CQL test configuration
      if (this.isValidConfiguration(data)) {
        this.config.set(data as CQLTestConfiguration);
        this.updateJsonConfig();
        this.error.set(null);
        this.updateUrlWithPreservedParams();
      } else {
        this.error.set('Invalid configuration format. Please ensure the URL points to a valid CQL test configuration JSON file.');
      }
    } catch (error: any) {
      this.error.set('Failed to load configuration from URL: ' + (error.message || 'Unknown error'));
    }
  }

  private isValidConfiguration(data: any): boolean {
    try {
      // Check if the data has the required structure
      return data &&
        typeof data === 'object' &&
        data.FhirServer &&
        typeof data.FhirServer.BaseUrl === 'string' &&
        typeof data.FhirServer.CqlOperation === 'string' &&
        data.Build &&
        typeof data.Build.CqlFileVersion === 'string' &&
        typeof data.Build.CqlOutputPath === 'string' &&
        data.Debug &&
        typeof data.Debug.QuickTest === 'boolean' &&
        data.Tests &&
        typeof data.Tests.ResultsPath === 'string' &&
        Array.isArray(data.Tests.SkipList);
    } catch (error) {
      return false;
    }
  }

  private updateUrlWithPreservedParams(): void {
    const queryParams: any = {};
    
    // Get current query parameters
    const params = this.route.snapshot.queryParams;
    
    // Preserve the original URL parameter if it exists
    if (params['url']) {
      queryParams.url = params['url'];
    }
    
    // Update URL without triggering navigation
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: queryParams,
      queryParamsHandling: 'replace',
      replaceUrl: true
    });
  }

  private handleApiError(error: any, context: string, alwaysShowToast: boolean = false): void {
    console.error(`${context}:`, error);
    
    // Check if it's a connection error
    if (this.isConnectionError(error)) {
      const wasUnavailable = this.apiUnavailable();
      this.apiUnavailable.set(true);
      const connectionMessage = this.getConnectionErrorMessage(error);
      this.connectionError.set(connectionMessage);
      this.error.set(connectionMessage);
      
      // Show toast if alwaysShowToast is true, or if API wasn't already unavailable
      if (alwaysShowToast || !wasUnavailable) {
        this.toastService.showError(
          connectionMessage,
          'API Unavailable'
        );
      }
    } else {
      this.apiUnavailable.set(false);
      this.connectionError.set(null);
      this.error.set(`${context}: ${error.message || 'Unknown error'}`);
    }
  }

  private isConnectionError(error: any): boolean {
    // Check for common connection error patterns
    if (error.status === 0) return true; // Network error
    if (error.status === 404) return true; // Not found
    if (error.status === 500) return true; // Server error
    if (error.status === 502) return true; // Bad gateway
    if (error.status === 503) return true; // Service unavailable
    if (error.status === 504) return true; // Gateway timeout
    
    // Check error message patterns
    const message = error.message?.toLowerCase() || '';
    return message.includes('network') || 
           message.includes('connection') || 
           message.includes('refused') || 
           message.includes('timeout') ||
           message.includes('unreachable') ||
           message.includes('cors') ||
           message.includes('fetch') ||
           message.includes('server error: 0') ||
           message.includes('unknown error') ||
           message.includes('unable to connect');
  }

  private getConnectionErrorMessage(error: any): string {
    if (error.status === 0) {
      return 'Unable to connect to the CQL Tests Runner API. Please check if the service is running and accessible.';
    }
    if (error.status === 404) {
      return 'CQL Test Runner API endpoint not found. Please verify the API URL configuration.';
    }
    if (error.status === 500) {
      return 'CQL Test Runner API is experiencing internal errors. Please try again later.';
    }
    if (error.status === 502 || error.status === 503 || error.status === 504) {
      return 'CQL Test Runner API is temporarily unavailable. Please try again later.';
    }
    
    const message = error.message?.toLowerCase() || '';
    if (message.includes('cors')) {
      return 'CORS error: The CQL Test Runner API may not be configured to allow requests from this domain.';
    }
    if (message.includes('timeout')) {
      return 'Request timeout: The CQL Test Runner API is taking too long to respond.';
    }
    if (message.includes('server error: 0') || message.includes('unknown error') || message.includes('network error')) {
      return 'Unable to connect to the CQL Test Runner API. This usually means the service is not running or not accessible.';
    }
    
    return 'Unable to connect to the CQL Test Runner API. Please check your network connection and API configuration.';
  }

  protected getApiBaseUrl(): string {
    return this.runnerService['baseUrl'] || 'Not configured';
  }


  protected getTimeSinceLastCheck(): string {
    const lastCheck = this.lastApiCheck();
    if (!lastCheck) return '';
    
    const now = new Date();
    const diff = Math.floor((now.getTime() - lastCheck.getTime()) / 1000);
    
    if (diff < 60) return `${diff} seconds ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
    return `${Math.floor(diff / 3600)} hours ago`;
  }
}

