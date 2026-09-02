// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Bundle, Resource } from 'fhir/r4';
import { BaseService } from './base.service';
import { SettingsService } from './settings.service';
import { normalizeBundleForBasePost } from './fhir-bundle-transaction.lib';
import { normalizeFhirBaseUrlForBundlePost } from './fhir-server-base.lib';
import { buildHttpHeaders } from './endpoint-config.lib';

export type FhirHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

@Injectable({
  providedIn: 'root'
})
export class FhirClientService extends BaseService {
  private readonly settingsService = inject(SettingsService);

  getBaseUrl(): string {
    return this.settingsService.getEffectiveDataEndpointAddress();
  }

  private fhirHeaders(): HttpHeaders {
    const ctx = this.settingsService.getEndpointHttpContext('data', {
      'Content-Type': 'application/fhir+json',
      Accept: 'application/fhir+json'
    });
    return buildHttpHeaders(
      { ...this.settingsService.getActiveEnvironment().dataEndpoint, address: ctx.address },
      ctx.headers
    );
  }

  request(method: FhirHttpMethod, path: string, body?: object): Observable<unknown> {
    const baseUrl = this.getBaseUrl();
    let url: string;
    if (path.startsWith('http://') || path.startsWith('https://')) {
      url = path;
    } else {
      const cleanPath = path.startsWith('/') ? path.slice(1) : path;
      url = baseUrl ? `${baseUrl}/${cleanPath}` : path;
    }
    if (!url.startsWith('http')) {
      return new Observable((subscriber) => {
        subscriber.error(new Error('FHIR data endpoint is not configured'));
      });
    }
    return this.http.request<unknown>(method, url, {
      body: body ?? undefined,
      headers: this.fhirHeaders()
    });
  }

  postBundle(bundle: Bundle): Observable<Bundle> {
    const baseUrl = normalizeFhirBaseUrlForBundlePost(this.getBaseUrl());
    if (!baseUrl) {
      return new Observable((subscriber) => {
        subscriber.error(new Error('FHIR data endpoint is not configured'));
      });
    }
    const payload = normalizeBundleForBasePost(bundle);
    return this.http.post<Bundle>(baseUrl, payload, {
      headers: this.fhirHeaders()
    });
  }
}
