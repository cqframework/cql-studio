// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { BaseService } from './base.service';

@Injectable({
  providedIn: 'root'
})
export class TranslationService extends BaseService {

  /**
   * Translate CQL to ELM using the cql-translation-service
   * @param cql The CQL code to translate
   * @param baseUrl The base URL of the translation service
   * @returns Observable containing the ELM XML response
   */
  translateCqlToElm(cql: string, baseUrl: string): Observable<string> {
    const url = `${baseUrl}/cql/translator`;
    
    // Set headers for CQL content with CORS-friendly headers
    const headers = new HttpHeaders({
      'Content-Type': 'application/cql',
      'Accept': 'application/elm+xml'
    });

    return this.http.post(url, cql, { 
      headers: headers,
      responseType: 'text',
      withCredentials: false
    });
  }

  /**
   * Translate CQL to ELM with additional options
   * @param cql The CQL code to translate
   * @param baseUrl The base URL of the translation service
   * @param options Translation options as query parameters
   * @returns Observable containing the ELM XML response
   */
  translateCqlToElmWithOptions(cql: string, baseUrl: string, options: any = {}): Observable<string> {
    let url = `${baseUrl}/cql/translator`;
    
    // Add query parameters if any options are provided
    const queryParams = new URLSearchParams();
    Object.keys(options).forEach(key => {
      if (options[key] !== null && options[key] !== undefined) {
        queryParams.append(key, options[key].toString());
      }
    });
    
    if (queryParams.toString()) {
      url += `?${queryParams.toString()}`;
    }
    
    // Set headers for CQL content with CORS-friendly headers
    const headers = new HttpHeaders({
      'Content-Type': 'application/cql',
      'Accept': 'application/elm+xml',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept'
    });

    return this.http.post(url, cql, { 
      headers: headers,
      responseType: 'text',
      withCredentials: false
    });
  }
}
