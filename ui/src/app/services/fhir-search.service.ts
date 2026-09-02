// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { BaseService } from './base.service';
import { SettingsService } from './settings.service';
import { Bundle } from 'fhir/r4';
import { buildHttpHeaders } from './endpoint-config.lib';

@Injectable({
  providedIn: 'root'
})
export class FhirSearchService extends BaseService {
  private readonly settingsService = inject(SettingsService);

  private getBaseUrl(): string {
    return this.settingsService.getEffectiveDataEndpointAddress();
  }

  private searchHeaders() {
    const ctx = this.settingsService.getEndpointHttpContext('data', {
      Accept: 'application/fhir+json'
    });
    return buildHttpHeaders(
      { ...this.settingsService.getActiveEnvironment().dataEndpoint, address: ctx.address },
      ctx.headers
    );
  }

  search(
    resourceType: string,
    params: Record<string, string>,
    options?: { count?: number; offset?: number }
  ): Observable<Bundle> {
    const baseUrl = this.getBaseUrl();
    if (!baseUrl) {
      return new Observable((subscriber) => {
        subscriber.error(new Error('FHIR data endpoint is not configured'));
      });
    }

    const queryParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value != null && String(value).trim() !== '') {
        queryParams.set(key, String(value).trim());
      }
    }
    if (options?.count != null) {
      queryParams.set('_count', String(options.count));
    }
    if (options?.offset != null) {
      queryParams.set('_offset', String(options.offset));
    }

    const queryString = queryParams.toString();
    const url = queryString
      ? `${baseUrl}/${resourceType}?${queryString}`
      : `${baseUrl}/${resourceType}`;

    return this.http.get<Bundle>(url, { headers: this.searchHeaders() });
  }

  fetchFromUrl(url: string): Observable<Bundle> {
    return this.http.get<Bundle>(url, { headers: this.searchHeaders() });
  }
}
