// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { SettingsService } from './settings.service';

export interface CQLTestConfiguration {
  FhirServer: {
    BaseUrl: string;
    ogBaseUrl?: string;
    CqlOperation: string;
  };
  Build: {
    CqlFileVersion: string;
    CqlOutputPath: string;
    CqlVersion?: string;
    testsRunDescription?: string;
  };
  Debug: {
    QuickTest: boolean;
  };
  Tests: {
    ResultsPath: string;
    SkipList: Array<{
      testsName: string;
      groupName: string;
      testName: string;
      reason: string;
    }>;
  };
}

export interface JobResponse {
  jobId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  message: string;
  createdAt: string;
  completedAt?: string;
  results?: any;
  error?: string;
}

export interface JobStatus extends JobResponse {
  // JobStatus extends JobResponse with additional fields that might be present
}

@Injectable({
  providedIn: 'root'
})
export class RunnerService {
  private readonly settingsService = inject(SettingsService);

  constructor(private http: HttpClient) {}

  private get baseUrl(): string {
    return this.settingsService.getEffectiveRunnerApiBaseUrl();
  }

  /**
   * Create a new job to run CQL tests asynchronously
   */
  createJob(config: CQLTestConfiguration): Observable<JobResponse> {
    return this.http.post<JobResponse>(`${this.baseUrl}/jobs`, config)
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Get the status and results of a job by ID
   */
  getJobStatus(jobId: string): Observable<JobStatus> {
    return this.http.get<JobStatus>(`${this.baseUrl}/jobs/${jobId}`)
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Run CQL tests synchronously (for immediate results)
   */
  runTestsSync(config: CQLTestConfiguration): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/`, config)
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Check if the runner service is healthy
   */
  checkHealth(): Observable<{ status: string; timestamp: string }> {
    return this.http.get<{ status: string; timestamp: string }>(`${this.baseUrl}/health`)
      .pipe(
        catchError(this.handleError)
      );
  }

  /**
   * Get the default configuration template
   */
  getDefaultConfiguration(): CQLTestConfiguration {
    return {
      FhirServer: {
        BaseUrl: this.settingsService.getEffectiveFhirBaseUrl(),
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
    };
  }

  private handleError(error: HttpErrorResponse): Observable<never> {
    let errorMessage = 'An unknown error occurred';
    
    if (error.error instanceof ErrorEvent) {
      // Client-side error
      errorMessage = `Client Error: ${error.error.message}`;
    } else {
      // Server-side error
      if (error.error && typeof error.error === 'object') {
        // Handle structured error responses from the CQL Tests Runner service
        if (error.error.message) {
          errorMessage = error.error.message;
        } else if (error.error.error) {
          errorMessage = error.error.error;
        }
      }
      
      // Handle specific status codes with better messages
      if (error.status === 0) {
        errorMessage = 'Network Error: Unable to connect to the server';
      } else if (error.status === 400) {
        errorMessage = errorMessage || 'Bad Request: Invalid request data';
      } else if (error.status === 404) {
        errorMessage = errorMessage || 'Not Found: The requested resource was not found';
      } else if (error.status === 422) {
        errorMessage = errorMessage || 'Validation Error: Configuration validation failed';
      } else if (error.status === 503) {
        errorMessage = errorMessage || 'Service Unavailable: Cannot connect to the specified FHIR server';
      } else if (error.status >= 400 && error.status < 500) {
        errorMessage = errorMessage || `Client Error: ${error.status} - ${error.statusText}`;
      } else if (error.status >= 500) {
        errorMessage = errorMessage || `Server Error: ${error.status} - ${error.statusText}`;
      } else {
        errorMessage = `HTTP Error: ${error.status} - ${error.statusText}`;
      }
    }
    
    console.error('RunnerService Error:', error);
    return throwError(() => new Error(errorMessage));
  }
}

