// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { BaseService } from './base.service';
import { SettingsService } from './settings.service';
import { Bundle, Resource } from 'fhir/r4';

@Injectable({
  providedIn: 'root'
})
export class FhirSearchService extends BaseService {
  private readonly settingsService = inject(SettingsService);

  private getBaseUrl(): string {
    const url = this.settingsService.getEffectiveFhirBaseUrl();
    return url?.trim()?.replace(/\/+$/, '') ?? '';
  }

  search(
    resourceType: string,
    params: Record<string, string>,
    options?: { count?: number; offset?: number }
  ): Observable<Bundle<Resource>> {
    const baseUrl = this.getBaseUrl();
    if (!baseUrl) {
      return new Observable((subscriber) => {
        subscriber.error(new Error('FHIR base URL is not configured'));
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

    return this.http.get<Bundle<Resource>>(url, { headers: this.headers() });
  }

  fetchFromUrl(url: string): Observable<Bundle<Resource>> {
    const baseUrl = this.getBaseUrl();
    let resolvedUrl: string;
    if (url.startsWith('http://') || url.startsWith('https://')) {
      resolvedUrl = url;
    } else {
      const cleanBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
      const cleanRelative = url.startsWith('/') ? url : '/' + url;
      resolvedUrl = cleanBase + cleanRelative;
    }
    return this.http.get<Bundle<Resource>>(resolvedUrl, { headers: this.headers() });
  }
}
