// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { BaseService } from './base.service';
import { ValueSet, CodeSystem, ConceptMap, Bundle, Parameters, OperationOutcome, Resource } from 'fhir/r4';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { SettingsService } from './settings.service';
import { buildHttpHeaders } from './endpoint-config.lib';
import { normalizeBundleForBasePost } from './fhir-bundle-transaction.lib';
import { isResourceType, resourceTypeOf } from './fhir-resource-type.lib';
import { normalizeFhirBaseUrlForBundlePost } from './fhir-server-base.lib';

@Injectable({
  providedIn: 'root'
})
export class TerminologyService extends BaseService {

  protected settingsService = inject(SettingsService);

  private getTerminologyBaseUrl(): string {
    return this.settingsService.getEffectiveTerminologyEndpointAddress();
  }

  private getAuthHeaders(): HttpHeaders {
    const ctx = this.settingsService.getEndpointHttpContext('terminology', {
      'Content-Type': 'application/fhir+json',
      Accept: 'application/fhir+json'
    });
    return buildHttpHeaders(
      { ...this.settingsService.getActiveEnvironment().terminologyEndpoint, address: ctx.address },
      ctx.headers
    );
  }

  private isCodeSystemResource(resource: Resource | undefined): resource is CodeSystem {
    return isResourceType(resource, 'CodeSystem');
  }

  // ValueSet Operations
  searchValueSets(params: {
    name?: string;
    title?: string;
    url?: string;
    status?: string;
    _count?: number;
  } = {}): Observable<Bundle> {
    const queryParams = new URLSearchParams();
    
    if (params.name) queryParams.append('name', params.name);
    if (params.title) queryParams.append('title', params.title);
    if (params.url) queryParams.append('url', params.url);
    if (params.status) queryParams.append('status', params.status);
    if (params._count) queryParams.append('_count', params._count.toString());

    const url = `${this.getTerminologyBaseUrl()}/ValueSet?${queryParams.toString()}`;
    return this.http.get<Bundle>(url, { headers: this.getAuthHeaders() });
  }

  // Fetch from a URL (for pagination via Bundle links)
  // Handles both absolute and relative URLs
  fetchFromUrl<T>(url: string): Observable<T> {
    // Resolve relative URLs against the base URL
    let resolvedUrl: string;
    
    // Check if URL is absolute (starts with http:// or https://)
    if (url.startsWith('http://') || url.startsWith('https://')) {
      resolvedUrl = url;
    } else {
      // It's a relative URL - resolve against base URL
      const baseUrl = this.getTerminologyBaseUrl();
      // Remove trailing slash from base URL if present
      const cleanBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
      // Ensure relative URL starts with / (FHIR servers typically return paths like /ValueSet?...)
      const cleanRelativeUrl = url.startsWith('/') ? url : '/' + url;
      resolvedUrl = cleanBaseUrl + cleanRelativeUrl;
    }
    
    return this.http.get<T>(resolvedUrl, { headers: this.getAuthHeaders() });
  }

  getValueSet(id: string): Observable<ValueSet> {
    const url = `${this.getTerminologyBaseUrl()}/ValueSet/${id}`;
    return this.http.get<ValueSet>(url, { headers: this.getAuthHeaders() });
  }

  expandValueSet(params: {
    url?: string;
    valueSet?: string;
    id?: string;
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
    
    // If we have an ID, use the GET approach with ID in path
    if (params.id) {
      let url = `${this.getTerminologyBaseUrl()}/ValueSet/${params.id}/$expand`;
      const queryParams: string[] = [];
      
      if (params.filter) queryParams.push(`filter=${encodeURIComponent(params.filter)}`);
      if (params.count) queryParams.push(`count=${params.count}`);
      if (params.offset) queryParams.push(`offset=${params.offset}`);
      if (params.includeDesignations !== undefined) queryParams.push(`includeDesignations=${params.includeDesignations}`);
      if (params.includeDefinition !== undefined) queryParams.push(`includeDefinition=${params.includeDefinition}`);
      if (params.activeOnly !== undefined) queryParams.push(`activeOnly=${params.activeOnly}`);
      if (params.excludeNested !== undefined) queryParams.push(`excludeNested=${params.excludeNested}`);
      if (params.excludeNotForUI !== undefined) queryParams.push(`excludeNotForUI=${params.excludeNotForUI}`);
      if (params.excludePostCoordinated !== undefined) queryParams.push(`excludePostCoordinated=${params.excludePostCoordinated}`);
      if (params.displayLanguage) queryParams.push(`displayLanguage=${encodeURIComponent(params.displayLanguage)}`);
      
      if (queryParams.length > 0) {
        url += `?${queryParams.join('&')}`;
      }
      
      return this.http.get<ValueSet>(url, { headers: this.getAuthHeaders() });
    }
    
    // Otherwise, use POST approach with Parameters body
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
    
    return this.http.get<Bundle>(url, { headers: this.getAuthHeaders() })
      .pipe(
        map(bundle => {
          const firstResource = bundle.entry?.[0]?.resource;
          if (this.isCodeSystemResource(firstResource)) {
            return firstResource;
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
  } = {}): Observable<Bundle> {
    const queryParams = new URLSearchParams();
    
    if (params.name) queryParams.append('name', params.name);
    if (params.title) queryParams.append('title', params.title);
    if (params.url) queryParams.append('url', params.url);
    if (params.status) queryParams.append('status', params.status);
    if (params._count) queryParams.append('_count', params._count.toString());

    const url = `${this.getTerminologyBaseUrl()}/ConceptMap?${queryParams.toString()}`;
    return this.http.get<Bundle>(url, { headers: this.getAuthHeaders() });
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
  } = {}): Observable<Bundle> {
    const queryParams = new URLSearchParams();
    
    if (params.name) queryParams.append('name', params.name);
    if (params.title) queryParams.append('title', params.title);
    if (params.url) queryParams.append('url', params.url);
    if (params.status) queryParams.append('status', params.status);
    if (params._count) queryParams.append('_count', params._count.toString());
    if (params._offset) queryParams.append('_offset', params._offset.toString());

    const url = `${this.getTerminologyBaseUrl()}/CodeSystem?${queryParams.toString()}`;
    return this.http.get<Bundle>(url, { headers: this.getAuthHeaders() });
  }

  // Search for codes using $lookup operation
  searchCodes(params: {
    text?: string;
    system?: string;
    code?: string;
  } = {}): Observable<Bundle> {
    // If no text provided, get available CodeSystems first
    if (!params.text && !params.code) {
      const url = `${this.getTerminologyBaseUrl()}/CodeSystem`;
      return this.http.get<Bundle>(url, { headers: this.getAuthHeaders() });
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
    
    return this.http.get<Bundle>(url, { headers: this.getAuthHeaders() });
  }


  // Test what resources are available on the server
  testServerResources(): Observable<any> {
    const url = `${this.getTerminologyBaseUrl()}/metadata`;
    return this.http.get(url, { headers: this.getAuthHeaders() });
  }

  // Delete a CodeSystem
  deleteCodeSystem(id: string): Observable<any> {
    const url = `${this.getTerminologyBaseUrl()}/CodeSystem/${id}`;
    return this.http.delete(url, { headers: this.getAuthHeaders() });
  }

  // Delete a ValueSet
  deleteValueSet(id: string): Observable<any> {
    const url = `${this.getTerminologyBaseUrl()}/ValueSet/${id}`;
    return this.http.delete(url, { headers: this.getAuthHeaders() });
  }

  /**
   * POST a Bundle to the terminology server root.
   * `Bundle.type` `collection` is normalized via `normalizeBundleForBasePost` (same as FHIR data client).
   */
  postBundle(bundle: Bundle | string): Observable<Bundle> {
    const url = normalizeFhirBaseUrlForBundlePost(this.getTerminologyBaseUrl());
    if (!url) {
      return new Observable((subscriber) => {
        subscriber.error(new Error('Terminology endpoint is not configured'));
      });
    }
    const payload: object | string =
      typeof bundle === 'string' ? bundle : normalizeBundleForBasePost(bundle);
    return this.http.post<Bundle>(url, payload, {
      headers: this.getAuthHeaders().set('Content-Type', 'application/fhir+json')
    });
  }

  /**
   * POST a single resource (e.g. ValueSet) to the terminology server.
   */
  postResource<T extends Resource>(resource: T): Observable<T> {
    const rt = resourceTypeOf(resource);
    if (!rt) {
      throw new Error('resourceType is required for POST');
    }
    const url = `${this.getTerminologyBaseUrl()}/${rt}`;
    return this.http.post<T>(url, resource, {
      headers: this.getAuthHeaders().set('Content-Type', 'application/fhir+json')
    });
  }

}
