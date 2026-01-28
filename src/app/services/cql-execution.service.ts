// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { BaseService } from './base.service';
import { Observable, forkJoin, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { SettingsService } from './settings.service';
import { Parameters, Endpoint, Library } from 'fhir/r4';
import { LibraryResource } from '../components/cql-ide/shared/ide-types';

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
  cqlContent?: string;
  elmXml?: string;
  libraryResource?: LibraryResource; // Current library resource from IDE (preferred)
  // Legacy fields for backward compatibility - used only if libraryResource is not provided
  libraryName?: string;
  libraryTitle?: string;
  libraryVersion?: string;
  libraryUrl?: string;
  libraryDescription?: string;
  library?: Library; // Original Library resource to preserve all fields
}

@Injectable({
  providedIn: 'root'
})
export class CqlExecutionService extends BaseService {

  protected settingsService = inject(SettingsService);

  /**
   * Execute a single library using the specified operation ($evaluate or $cql)
   */
  executeLibrary(libraryId: string, patientIds?: string[], options?: CqlExecutionOptions): Observable<CqlExecutionResult[]> {
    const operation = options?.operation || '$evaluate';
    
    if (operation === '$cql') {
      return this.executeLibraryWithCqlOperation(libraryId, patientIds, options);
    } else {
      return this.executeLibraryWithEvaluateOperation(libraryId, patientIds, options);
    }
  }

  /**
   * Execute library using $evaluate operation
   */
  private executeLibraryWithEvaluateOperation(libraryId: string, patientIds?: string[], options?: CqlExecutionOptions): Observable<CqlExecutionResult[]> {
    if (!patientIds || patientIds.length === 0) {
      return this.executeLibraryWithoutPatient(libraryId, options);
    } else {
      return this.executeLibraryForPatients(libraryId, patientIds, options);
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
  private executeLibraryWithoutPatient(libraryId: string, options?: CqlExecutionOptions): Observable<CqlExecutionResult[]> {
    const parameters = this.createBaseParameters();
    return this.executeHttpRequest(
      this.getLibraryEvaluateUrl(libraryId),
      parameters,
      { libraryId, libraryName: options?.libraryName || libraryId }
    ).pipe(
      map(result => [result])
    );
  }

  /**
   * Execute library for multiple patients using $evaluate
   */
  private executeLibraryForPatients(libraryId: string, patientIds: string[], options?: CqlExecutionOptions): Observable<CqlExecutionResult[]> {
    const executions = patientIds
      .filter(patientId => patientId && patientId.trim().length > 0) // Filter out empty/invalid patient IDs
      .map(patientId => {
        const parameters = this.createBaseParameters();
        this.addSubjectParameter(parameters, patientId);
        return this.executeHttpRequest(
          this.getLibraryEvaluateUrl(libraryId),
          parameters,
          { libraryId, libraryName: options?.libraryName || libraryId, patientId, patientName: `Patient ${patientId}` }
        );
      });

    return forkJoin(executions);
  }

  /**
   * Execute CQL without patient context using $cql operation
   */
  private executeCqlWithoutPatient(libraryId: string, options?: CqlExecutionOptions): Observable<CqlExecutionResult[]> {
    const parameters = this.createBaseParameters();
    this.addLibraryParameter(parameters, libraryId);
    this.addExpressionParameter(parameters, options);
    return this.executeHttpRequest(
      this.getCqlOperationUrl(),
      parameters,
      { libraryId, libraryName: libraryId, functionName: options?.functionName }
    ).pipe(
      map(result => [result])
    );
  }

  /**
   * Execute CQL for multiple patients using $cql operation
   */
  private executeCqlForPatients(libraryId: string, patientIds: string[], options?: CqlExecutionOptions): Observable<CqlExecutionResult[]> {
    const executions = patientIds.map(patientId => {
      const parameters = this.createBaseParameters();
      this.addLibraryParameter(parameters, libraryId);
      this.addSubjectParameter(parameters, patientId);
      this.addExpressionParameter(parameters, options);
      return this.executeHttpRequest(
        this.getCqlOperationUrl(),
        parameters,
        { libraryId, libraryName: libraryId, patientId, patientName: `Patient ${patientId}`, functionName: options?.functionName }
      );
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
   * Get the evaluate URL for a library (instance-level operation)
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

  /**
   * Get the terminology endpoint parameter for CQL operations
   */
  private getTerminologyEndpoint(): Endpoint | null {
    const terminologyBaseUrl = this.settingsService.getEffectiveTerminologyBaseUrl();
    if (!terminologyBaseUrl || terminologyBaseUrl.trim() === '') {
      return null;
    }

    return {
      resourceType: 'Endpoint',
      address: terminologyBaseUrl,
      status: 'active',
      connectionType: {
        system: 'http://terminology.hl7.org/CodeSystem/endpoint-connection-type',
        code: 'hl7-fhir-rest'
      }
    } as Endpoint;
  }

  /**
   * Create base Parameters object with terminology endpoint if available
   */
  private createBaseParameters(): Parameters {
    const parameters: Parameters = {
      resourceType: 'Parameters',
      parameter: []
    };
    this.addTerminologyEndpoint(parameters);
    return parameters;
  }

  /**
   * Add terminology endpoint to parameters if available
   */
  private addTerminologyEndpoint(parameters: Parameters): void {
    const terminologyEndpoint = this.getTerminologyEndpoint();
    if (terminologyEndpoint) {
      parameters.parameter!.push({
        name: 'terminologyEndpoint',
        resource: terminologyEndpoint
      });
    }
  }

  /**
   * Add subject parameter for patient context
   */
  private addSubjectParameter(parameters: Parameters, patientId: string): void {
    parameters.parameter!.push({
      name: 'subject',
      valueString: `Patient/${patientId}`
    });
  }

  /**
   * Add library parameter for $cql operation
   */
  private addLibraryParameter(parameters: Parameters, libraryId: string): void {
    parameters.parameter!.push({
      name: 'library',
      valueString: libraryId
    });
  }

  /**
   * Add expression parameter (functionName or cqlExpression) if provided
   */
  private addExpressionParameter(parameters: Parameters, options?: CqlExecutionOptions): void {
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
  }

  /**
   * Execute HTTP request and create CqlExecutionResult observable
   */
  private executeHttpRequest(
    url: string,
    parameters: Parameters,
    metadata: Partial<CqlExecutionResult>
  ): Observable<CqlExecutionResult> {
    const startTime = Date.now();
    const baseResult: Partial<CqlExecutionResult> = {
      libraryName: metadata.libraryName || metadata.libraryId || 'Unknown',
      ...metadata
    };
    
    return new Observable<CqlExecutionResult>(observer => {
      // Use FHIR content type headers for FHIR operations
      const fhirHeaders = new HttpHeaders({
        'Content-Type': 'application/fhir+json',
        'Accept': 'application/fhir+json'
      });
      
      // Pass the object directly - HttpClient will serialize it correctly
      this.http.post<Parameters>(url, parameters, { headers: fhirHeaders })
        .subscribe({
          next: (response: any) => {
            observer.next({
              result: response,
              ...baseResult,
              executionTime: Date.now() - startTime
            } as CqlExecutionResult);
            observer.complete();
          },
          error: (error: any) => {
            observer.next({
              error: error,
              ...baseResult,
              executionTime: Date.now() - startTime
            } as CqlExecutionResult);
            observer.complete();
          }
        });
    });
  }
}
