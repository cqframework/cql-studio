// Author: Preston Lee

import { Injectable } from '@angular/core';
import { BaseService } from './base.service';
import { Observable, forkJoin, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { SettingsService } from './settings.service';
import { Parameters } from 'fhir/r4';

export type CqlOperationType = '$evaluate' | '$cql';

export interface CqlExecutionResult {
  result?: any;
  error?: any;
  executionTime: number;
  libraryId?: string;
  libraryName: string;
  patientId?: string;
  patientName?: string;
  functionName?: string;
}

export interface CqlExecutionOptions {
  operation?: CqlOperationType;
  functionName?: string;
  cqlExpression?: string;
}

@Injectable({
  providedIn: 'root'
})
export class CqlExecutionService extends BaseService {

  constructor(protected override http: HttpClient, protected settingsService: SettingsService) { 
    super(http);
  }

  /**
   * Execute a single library using the specified operation ($evaluate or $cql)
   */
  executeLibrary(libraryId: string, patientIds?: string[], options?: CqlExecutionOptions): Observable<CqlExecutionResult[]> {
    const operation = options?.operation || '$evaluate';
    
    if (operation === '$cql') {
      return this.executeLibraryWithCqlOperation(libraryId, patientIds, options);
    } else {
      return this.executeLibraryWithEvaluateOperation(libraryId, patientIds);
    }
  }

  /**
   * Execute library using $evaluate operation
   */
  private executeLibraryWithEvaluateOperation(libraryId: string, patientIds?: string[]): Observable<CqlExecutionResult[]> {
    if (!patientIds || patientIds.length === 0) {
      return this.executeLibraryWithoutPatient(libraryId);
    } else {
      return this.executeLibraryForPatients(libraryId, patientIds);
    }
  }

  /**
   * Execute library using $cql operation
   */
  private executeLibraryWithCqlOperation(libraryId: string, patientIds?: string[], options?: CqlExecutionOptions): Observable<CqlExecutionResult[]> {
    if (!patientIds || patientIds.length === 0) {
      return this.executeCqlWithoutPatient(libraryId, options);
    } else {
      return this.executeCqlForPatients(libraryId, patientIds, options);
    }
  }

  /**
   * Execute library without patient context using $evaluate
   */
  private executeLibraryWithoutPatient(libraryId: string): Observable<CqlExecutionResult[]> {
    const parameters: Parameters = {
      resourceType: 'Parameters',
      parameter: []
    };

    const startTime = Date.now();
    
    return new Observable(observer => {
      this.http.post<Parameters>(this.getLibraryEvaluateUrl(libraryId), JSON.stringify(parameters), { headers: this.headers() })
        .subscribe({
          next: (response: any) => {
            observer.next([{
              result: response,
              executionTime: Date.now() - startTime,
              libraryId: libraryId,
              libraryName: libraryId
            }]);
            observer.complete();
          },
          error: (error: any) => {
            observer.next([{
              error: error,
              executionTime: Date.now() - startTime,
              libraryId: libraryId,
              libraryName: libraryId
            }]);
            observer.complete();
          }
        });
    });
  }

  /**
   * Execute library for multiple patients using $evaluate
   */
  private executeLibraryForPatients(libraryId: string, patientIds: string[]): Observable<CqlExecutionResult[]> {
    const executions = patientIds.map(patientId => {
      const parameters: Parameters = {
        resourceType: 'Parameters',
        parameter: [
          {
            name: 'subject',
            valueString: `Patient/${patientId}`
          }
        ]
      };

      const startTime = Date.now();
      
      return new Observable<CqlExecutionResult>(observer => {
        this.http.post<Parameters>(this.getLibraryEvaluateUrl(libraryId), JSON.stringify(parameters), { headers: this.headers() })
          .subscribe({
            next: (response: any) => {
              observer.next({
                result: response,
                executionTime: Date.now() - startTime,
                libraryId: libraryId,
                libraryName: libraryId,
                patientId: patientId,
                patientName: `Patient ${patientId}`
              });
              observer.complete();
            },
            error: (error: any) => {
              observer.next({
                error: error,
                executionTime: Date.now() - startTime,
                libraryId: libraryId,
                libraryName: libraryId,
                patientId: patientId,
                patientName: `Patient ${patientId}`
              });
              observer.complete();
            }
          });
      });
    });

    return forkJoin(executions);
  }

  /**
   * Execute CQL without patient context using $cql operation
   */
  private executeCqlWithoutPatient(libraryId: string, options?: CqlExecutionOptions): Observable<CqlExecutionResult[]> {
    const parameters: Parameters = {
      resourceType: 'Parameters',
      parameter: [
        {
          name: 'library',
          valueString: libraryId
        }
      ]
    };

    if (options?.functionName) {
      parameters.parameter!.push({
        name: 'expression',
        valueString: options.functionName
      });
    } else if (options?.cqlExpression) {
      parameters.parameter!.push({
        name: 'expression',
        valueString: options.cqlExpression
      });
    }

    const startTime = Date.now();
    
    return new Observable(observer => {
      this.http.post<Parameters>(this.getCqlOperationUrl(), JSON.stringify(parameters), { headers: this.headers() })
        .subscribe({
          next: (response: any) => {
            observer.next([{
              result: response,
              executionTime: Date.now() - startTime,
              libraryId: libraryId,
              libraryName: libraryId,
              functionName: options?.functionName
            }]);
            observer.complete();
          },
          error: (error: any) => {
            observer.next([{
              error: error,
              executionTime: Date.now() - startTime,
              libraryId: libraryId,
              libraryName: libraryId,
              functionName: options?.functionName
            }]);
            observer.complete();
          }
        });
    });
  }

  /**
   * Execute CQL for multiple patients using $cql operation
   */
  private executeCqlForPatients(libraryId: string, patientIds: string[], options?: CqlExecutionOptions): Observable<CqlExecutionResult[]> {
    const executions = patientIds.map(patientId => {
      const parameters: Parameters = {
        resourceType: 'Parameters',
        parameter: [
          {
            name: 'library',
            valueString: libraryId
          },
          {
            name: 'subject',
            valueString: `Patient/${patientId}`
          }
        ]
      };

      if (options?.functionName) {
        parameters.parameter!.push({
          name: 'expression',
          valueString: options.functionName
        });
      } else if (options?.cqlExpression) {
        parameters.parameter!.push({
          name: 'expression',
          valueString: options.cqlExpression
        });
      }

      const startTime = Date.now();
      
      return new Observable<CqlExecutionResult>(observer => {
        this.http.post<Parameters>(this.getCqlOperationUrl(), JSON.stringify(parameters), { headers: this.headers() })
          .subscribe({
            next: (response: any) => {
              observer.next({
                result: response,
                executionTime: Date.now() - startTime,
                libraryId: libraryId,
                libraryName: libraryId,
                patientId: patientId,
                patientName: `Patient ${patientId}`,
                functionName: options?.functionName
              });
              observer.complete();
            },
            error: (error: any) => {
              observer.next({
                error: error,
                executionTime: Date.now() - startTime,
                libraryId: libraryId,
                libraryName: libraryId,
                patientId: patientId,
                patientName: `Patient ${patientId}`,
                functionName: options?.functionName
              });
              observer.complete();
            }
          });
      });
    });

    return forkJoin(executions);
  }

  /**
   * Execute all libraries
   */
  executeAllLibraries(libraries: Array<{id: string, name: string}>, patientIds?: string[], options?: CqlExecutionOptions): Observable<CqlExecutionResult[]> {
    const executions = libraries.map(library => 
      this.executeLibrary(library.id, patientIds, options)
    );

    return forkJoin(executions).pipe(
      map(results => results.flat())
    );
  }

  /**
   * Get the evaluate URL for a library
   */
  private getLibraryEvaluateUrl(libraryId: string): string {
    const baseUrl = this.settingsService.getEffectiveFhirBaseUrl();
    return `${baseUrl}/Library/${libraryId}/$evaluate`;
  }

  /**
   * Get the $cql operation URL
   */
  private getCqlOperationUrl(): string {
    const baseUrl = this.settingsService.getEffectiveFhirBaseUrl();
    return `${baseUrl}/$cql`;
  }
}
