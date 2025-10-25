// Author: Preston Lee

import { Injectable } from '@angular/core';
import { BaseService } from './base.service';
import { ValueSet, CodeSystem, ConceptMap, Bundle, Parameters, OperationOutcome } from 'fhir/r4';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { SettingsService } from './settings.service';
// import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class TerminologyService extends BaseService {

  constructor(protected override http: HttpClient, protected settingsService: SettingsService) {
    super(http);
  }

  private getTerminologyBaseUrl(): string {
    const baseUrl = this.settingsService.getEffectiveTerminologyBaseUrl();
    // For VSAC, we might need to use a CORS proxy in development
    if (baseUrl.includes('cts.nlm.nih.gov') && this.isDevelopment()) {
      console.warn('VSAC CORS Issue: VSAC does not allow direct browser requests. Consider using a CORS proxy for development.');
    }
    return baseUrl;
  }

  private isDevelopment(): boolean {
    return true; // Assume development for now
  }

  private getAuthHeaders(): HttpHeaders {
    const username = this.settingsService.getEffectiveTerminologyBasicAuthUsername();
    const password = this.settingsService.getEffectiveTerminologyBasicAuthPassword();
    let headers = new HttpHeaders({
      'Content-Type': 'application/fhir+json',
      'Accept': 'application/fhir+json'
    });

    if (username && username.trim() !== '' && password && password.trim() !== '') {
      // Basic Auth: username:password
      const authString = btoa(`${username}:${password}`);
      headers = headers.set('Authorization', `Basic ${authString}`);
      
      // Debug logging for authentication troubleshooting
      console.log('Terminology Authentication Debug:', {
        username: username,
        passwordLength: password.length,
        passwordPrefix: password.substring(0, 8) + '...',
        authStringLength: authString.length,
        authStringPrefix: authString.substring(0, 12) + '...'
      });
    }
    // If no credentials provided, requests will be made without authentication

    return headers;
  }

  // ValueSet Operations
  searchValueSets(params: {
    name?: string;
    title?: string;
    url?: string;
    status?: string;
    _count?: number;
    _offset?: number;
  } = {}): Observable<Bundle<ValueSet>> {
    const queryParams = new URLSearchParams();
    
    if (params.name) queryParams.append('name', params.name);
    if (params.title) queryParams.append('title', params.title);
    if (params.url) queryParams.append('url', params.url);
    if (params.status) queryParams.append('status', params.status);
    if (params._count) queryParams.append('_count', params._count.toString());
    if (params._offset) queryParams.append('_offset', params._offset.toString());

    const url = `${this.getTerminologyBaseUrl()}/ValueSet?${queryParams.toString()}`;
    return this.http.get<Bundle<ValueSet>>(url, { headers: this.getAuthHeaders() });
  }

  getValueSet(id: string): Observable<ValueSet> {
    const url = `${this.getTerminologyBaseUrl()}/ValueSet/${id}`;
    return this.http.get<ValueSet>(url, { headers: this.getAuthHeaders() });
  }

  expandValueSet(params: {
    url?: string;
    valueSet?: string;
    filter?: string;
    count?: number;
    offset?: number;
    includeDesignations?: boolean;
    includeDefinition?: boolean;
    activeOnly?: boolean;
    excludeNested?: boolean;
    excludeNotForUI?: boolean;
    excludePostCoordinated?: boolean;
    displayLanguage?: string;
  } = {}): Observable<ValueSet> {
    const operationParams: Parameters = {
      resourceType: 'Parameters',
      parameter: []
    };

    if (params.url) {
      operationParams.parameter!.push({
        name: 'url',
        valueUri: params.url
      });
    }
    if (params.valueSet) {
      operationParams.parameter!.push({
        name: 'valueSet',
        valueString: params.valueSet
      });
    }
    if (params.filter) {
      operationParams.parameter!.push({
        name: 'filter',
        valueString: params.filter
      });
    }
    if (params.count) {
      operationParams.parameter!.push({
        name: 'count',
        valueInteger: params.count
      });
    }
    if (params.offset) {
      operationParams.parameter!.push({
        name: 'offset',
        valueInteger: params.offset
      });
    }
    if (params.includeDesignations !== undefined) {
      operationParams.parameter!.push({
        name: 'includeDesignations',
        valueBoolean: params.includeDesignations
      });
    }
    if (params.includeDefinition !== undefined) {
      operationParams.parameter!.push({
        name: 'includeDefinition',
        valueBoolean: params.includeDefinition
      });
    }
    if (params.activeOnly !== undefined) {
      operationParams.parameter!.push({
        name: 'activeOnly',
        valueBoolean: params.activeOnly
      });
    }
    if (params.excludeNested !== undefined) {
      operationParams.parameter!.push({
        name: 'excludeNested',
        valueBoolean: params.excludeNested
      });
    }
    if (params.excludeNotForUI !== undefined) {
      operationParams.parameter!.push({
        name: 'excludeNotForUI',
        valueBoolean: params.excludeNotForUI
      });
    }
    if (params.excludePostCoordinated !== undefined) {
      operationParams.parameter!.push({
        name: 'excludePostCoordinated',
        valueBoolean: params.excludePostCoordinated
      });
    }
    if (params.displayLanguage) {
      operationParams.parameter!.push({
        name: 'displayLanguage',
        valueCode: params.displayLanguage
      });
    }

    const url = `${this.getTerminologyBaseUrl()}/ValueSet/$expand`;
    return this.http.post<ValueSet>(url, operationParams, { headers: this.getAuthHeaders() });
  }

  validateCode(params: {
    url?: string;
    valueSet?: string;
    code?: string;
    system?: string;
    version?: string;
    display?: string;
    coding?: any;
    codeableConcept?: any;
    date?: string;
    abstract?: boolean;
    displayLanguage?: string;
  } = {}): Observable<Parameters> {
    const operationParams: Parameters = {
      resourceType: 'Parameters',
      parameter: []
    };

    if (params.url) {
      operationParams.parameter!.push({
        name: 'url',
        valueUri: params.url
      });
    }
    if (params.valueSet) {
      operationParams.parameter!.push({
        name: 'valueSet',
        valueString: params.valueSet
      });
    }
    if (params.code) {
      operationParams.parameter!.push({
        name: 'code',
        valueCode: params.code
      });
    }
    if (params.system) {
      operationParams.parameter!.push({
        name: 'system',
        valueUri: params.system
      });
    }
    if (params.version) {
      operationParams.parameter!.push({
        name: 'version',
        valueString: params.version
      });
    }
    if (params.display) {
      operationParams.parameter!.push({
        name: 'display',
        valueString: params.display
      });
    }
    if (params.coding) {
      operationParams.parameter!.push({
        name: 'coding',
        valueCoding: params.coding
      });
    }
    if (params.codeableConcept) {
      operationParams.parameter!.push({
        name: 'codeableConcept',
        valueCodeableConcept: params.codeableConcept
      });
    }
    if (params.date) {
      operationParams.parameter!.push({
        name: 'date',
        valueDateTime: params.date
      });
    }
    if (params.abstract !== undefined) {
      operationParams.parameter!.push({
        name: 'abstract',
        valueBoolean: params.abstract
      });
    }
    if (params.displayLanguage) {
      operationParams.parameter!.push({
        name: 'displayLanguage',
        valueCode: params.displayLanguage
      });
    }

    const url = `${this.getTerminologyBaseUrl()}/ValueSet/$validate-code`;
    return this.http.post<Parameters>(url, operationParams, { headers: this.getAuthHeaders() });
  }


  getCodeSystem(id: string): Observable<CodeSystem> {
    const url = `${this.getTerminologyBaseUrl()}/CodeSystem/${id}`;
    return this.http.get<CodeSystem>(url, { headers: this.getAuthHeaders() });
  }

  // Get CodeSystem by URL
  getCodeSystemByUrl(systemUrl: string): Observable<CodeSystem> {
    const queryParams = new URLSearchParams();
    queryParams.append('url', systemUrl);
    
    const url = `${this.getTerminologyBaseUrl()}/CodeSystem?${queryParams.toString()}`;
    console.log('Getting CodeSystem by URL:', url);
    
    return this.http.get<Bundle<CodeSystem>>(url, { headers: this.getAuthHeaders() })
      .pipe(
        map(bundle => {
          if (bundle.entry && bundle.entry.length > 0) {
            return bundle.entry[0].resource!;
          }
          throw new Error('CodeSystem not found');
        })
      );
  }

  lookupCode(params: {
    code?: string;
    system?: string;
    version?: string;
    coding?: any;
    codeableConcept?: any;
    date?: string;
    displayLanguage?: string;
    property?: string[];
  } = {}): Observable<Parameters> {
    const operationParams: Parameters = {
      resourceType: 'Parameters',
      parameter: []
    };

    if (params.code) {
      operationParams.parameter!.push({
        name: 'code',
        valueCode: params.code
      });
    }
    if (params.system) {
      operationParams.parameter!.push({
        name: 'system',
        valueUri: params.system
      });
    }
    if (params.version) {
      operationParams.parameter!.push({
        name: 'version',
        valueString: params.version
      });
    }
    if (params.coding) {
      operationParams.parameter!.push({
        name: 'coding',
        valueCoding: params.coding
      });
    }
    if (params.codeableConcept) {
      operationParams.parameter!.push({
        name: 'codeableConcept',
        valueCodeableConcept: params.codeableConcept
      });
    }
    if (params.date) {
      operationParams.parameter!.push({
        name: 'date',
        valueDateTime: params.date
      });
    }
    if (params.displayLanguage) {
      operationParams.parameter!.push({
        name: 'displayLanguage',
        valueCode: params.displayLanguage
      });
    }
    if (params.property && params.property.length > 0) {
      params.property.forEach(prop => {
        operationParams.parameter!.push({
          name: 'property',
          valueCode: prop
        });
      });
    }

    const url = `${this.getTerminologyBaseUrl()}/CodeSystem/$lookup`;
    return this.http.post<Parameters>(url, operationParams, { headers: this.getAuthHeaders() });
  }

  // ConceptMap Operations
  searchConceptMaps(params: {
    name?: string;
    title?: string;
    url?: string;
    status?: string;
    _count?: number;
    _offset?: number;
  } = {}): Observable<Bundle<ConceptMap>> {
    const queryParams = new URLSearchParams();
    
    if (params.name) queryParams.append('name', params.name);
    if (params.title) queryParams.append('title', params.title);
    if (params.url) queryParams.append('url', params.url);
    if (params.status) queryParams.append('status', params.status);
    if (params._count) queryParams.append('_count', params._count.toString());
    if (params._offset) queryParams.append('_offset', params._offset.toString());

    const url = `${this.getTerminologyBaseUrl()}/ConceptMap?${queryParams.toString()}`;
    return this.http.get<Bundle<ConceptMap>>(url, { headers: this.getAuthHeaders() });
  }

  getConceptMap(id: string): Observable<ConceptMap> {
    const url = `${this.getTerminologyBaseUrl()}/ConceptMap/${id}`;
    return this.http.get<ConceptMap>(url, { headers: this.getAuthHeaders() });
  }

  translateConcept(params: {
    url?: string;
    conceptMap?: string;
    system?: string;
    version?: string;
    code?: string;
    coding?: any;
    codeableConcept?: any;
    target?: string[];
    reverse?: boolean;
  } = {}): Observable<Parameters> {
    const operationParams: Parameters = {
      resourceType: 'Parameters',
      parameter: []
    };

    if (params.url) {
      operationParams.parameter!.push({
        name: 'url',
        valueUri: params.url
      });
    }
    if (params.conceptMap) {
      operationParams.parameter!.push({
        name: 'conceptMap',
        valueString: params.conceptMap
      });
    }
    if (params.system) {
      operationParams.parameter!.push({
        name: 'system',
        valueUri: params.system
      });
    }
    if (params.version) {
      operationParams.parameter!.push({
        name: 'version',
        valueString: params.version
      });
    }
    if (params.code) {
      operationParams.parameter!.push({
        name: 'code',
        valueCode: params.code
      });
    }
    if (params.coding) {
      operationParams.parameter!.push({
        name: 'coding',
        valueCoding: params.coding
      });
    }
    if (params.codeableConcept) {
      operationParams.parameter!.push({
        name: 'codeableConcept',
        valueCodeableConcept: params.codeableConcept
      });
    }
    if (params.target && params.target.length > 0) {
      params.target.forEach(target => {
        operationParams.parameter!.push({
          name: 'target',
          valueUri: target
        });
      });
    }
    if (params.reverse !== undefined) {
      operationParams.parameter!.push({
        name: 'reverse',
        valueBoolean: params.reverse
      });
    }

    const url = `${this.getTerminologyBaseUrl()}/ConceptMap/$translate`;
    return this.http.post<Parameters>(url, operationParams, { headers: this.getAuthHeaders() });
  }


  // Search for CodeSystems (list all available)
  searchCodeSystems(params: {
    name?: string;
    title?: string;
    url?: string;
    status?: string;
    _count?: number;
    _offset?: number;
  } = {}): Observable<Bundle<CodeSystem>> {
    const queryParams = new URLSearchParams();
    
    if (params.name) queryParams.append('name', params.name);
    if (params.title) queryParams.append('title', params.title);
    if (params.url) queryParams.append('url', params.url);
    if (params.status) queryParams.append('status', params.status);
    if (params._count) queryParams.append('_count', params._count.toString());
    if (params._offset) queryParams.append('_offset', params._offset.toString());

    const url = `${this.getTerminologyBaseUrl()}/CodeSystem?${queryParams.toString()}`;
    return this.http.get<Bundle<CodeSystem>>(url, { headers: this.getAuthHeaders() });
  }

  // Search for codes using $lookup operation
  searchCodes(params: {
    text?: string;
    system?: string;
    code?: string;
  } = {}): Observable<Bundle<any>> {
    // If no text provided, get available CodeSystems first
    if (!params.text && !params.code) {
      const url = `${this.getTerminologyBaseUrl()}/CodeSystem`;
      console.log('Getting all CodeSystems with URL:', url);
      return this.http.get<Bundle<any>>(url, { headers: this.getAuthHeaders() });
    }

    // For text search, find CodeSystems that might contain the text
    const queryParams = new URLSearchParams();
    
    if (params.text) {
      queryParams.append('name', params.text);
    }
    if (params.code) {
      queryParams.append('code', params.code);
    }
    if (params.system) {
      queryParams.append('url', params.system);
    }

    const url = `${this.getTerminologyBaseUrl()}/CodeSystem?${queryParams.toString()}`;
    console.log('Searching CodeSystems with URL:', url);
    console.log('Search parameters:', params);
    
    return this.http.get<Bundle<any>>(url, { headers: this.getAuthHeaders() });
  }


  // Test what resources are available on the server
  testServerResources(): Observable<any> {
    const url = `${this.getTerminologyBaseUrl()}/metadata`;
    console.log('Testing server resources at:', url);
    return this.http.get(url, { headers: this.getAuthHeaders() });
  }

  // Delete a CodeSystem
  deleteCodeSystem(id: string): Observable<any> {
    const url = `${this.getTerminologyBaseUrl()}/CodeSystem/${id}`;
    return this.http.delete(url, { headers: this.getAuthHeaders() });
  }


}
