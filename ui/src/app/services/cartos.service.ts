// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { SettingsService } from './settings.service';
import { Bundle, CapabilityStatement, CodeSystem, Parameters, ValueSet } from 'fhir/r4';
import { isResourceType } from './fhir-resource-type.lib';
import {
  appendStandardValueSetSearchParams,
  fhirPathAndQueryFromBundleLink as mapBundleLinkToProxyPath,
  StandardValueSetSearchParams,
} from './remote-fhir-terminology/remote-fhir-terminology.lib';

export {
  capabilityStatementSupportsValueSetSort,
  valueSetSortFieldChoicesFromCapability,
} from './remote-fhir-terminology/remote-fhir-terminology.lib';

const FHIR_JSON = 'application/fhir+json';
const CARTOS_FHIR_BASE_HEADER = 'X-Cartos-FHIR-Base-URL';
const CARTOS_FHIR_ALLOWED_HOSTS = new Set(['cartos.healthit.gov']);

export type CartosValueSetSearchParams = StandardValueSetSearchParams;

export interface CartosCodeSystemSearchParams {
  nameContains?: string;
  titleContains?: string;
  url?: string;
  identifier?: string;
  version?: string;
  status?: string;
  _count?: number;
  _sort?: string;
}

@Injectable({
  providedIn: 'root'
})
export class CartosService {
  private http = inject(HttpClient);
  private settingsService = inject(SettingsService);

  private studioServerBaseUrl(): string {
    return this.settingsService.getEffectiveServerBaseUrl().replace(/\/+$/, '');
  }

  private fhirHeaders(extra?: Record<string, string>): HttpHeaders {
    let h = new HttpHeaders({
      Accept: FHIR_JSON,
      'Content-Type': FHIR_JSON,
    });
    h = h.set(CARTOS_FHIR_BASE_HEADER, this.settingsService.getEffectiveCartosFhirBaseUrl());
    if (extra) {
      for (const [k, v] of Object.entries(extra)) {
        h = h.set(k, v);
      }
    }
    return h;
  }

  private fhirUrl(suffix: string): string {
    const path = suffix.startsWith('/') ? suffix : `/${suffix}`;
    return `${this.studioServerBaseUrl()}/api/cartos/fhir${path}`;
  }

  fhirPathAndQueryFromBundleLink(linkUrl: string): string | null {
    return mapBundleLinkToProxyPath(
      linkUrl,
      this.settingsService.getEffectiveCartosFhirBaseUrl(),
      CARTOS_FHIR_ALLOWED_HOSTS
    );
  }

  getValueSetSearchByBundleLink(linkUrl: string): Observable<Bundle> {
    const pq = this.fhirPathAndQueryFromBundleLink(linkUrl);
    if (!pq) {
      throw new Error('Pagination link does not match the configured Cartos FHIR base URL host.');
    }
    return this.http.get<Bundle>(this.fhirUrl(pq), {
      headers: this.fhirHeaders()
    });
  }

  getMetadata(): Observable<CapabilityStatement> {
    return this.http.get<CapabilityStatement>(this.fhirUrl('/metadata'), {
      headers: this.fhirHeaders()
    });
  }

  searchValueSets(params: CartosValueSetSearchParams): Observable<Bundle> {
    const q = new URLSearchParams();
    appendStandardValueSetSearchParams(q, params);
    return this.http.get<Bundle>(this.fhirUrl(`/ValueSet?${q.toString()}`), {
      headers: this.fhirHeaders()
    });
  }

  getValueSetById(id: string): Observable<ValueSet> {
    return this.http.get<ValueSet>(this.fhirUrl(`/ValueSet/${encodeURIComponent(id)}`), {
      headers: this.fhirHeaders()
    });
  }

  fetchValueSetByOidOrCanonicalUrl(idOrUrl: string): Observable<ValueSet> {
    const trimmed = idOrUrl.trim();
    if (/^https?:\/\//i.test(trimmed)) {
      return this.searchValueSets({ url: trimmed, _count: 1 }).pipe(
        map((bundle) => {
          const first = bundle.entry?.[0]?.resource;
          if (isResourceType(first, 'ValueSet')) {
            return first as ValueSet;
          }
          throw new Error('No ValueSet found for this canonical URL');
        })
      );
    }
    const id = trimmed.replace(/^urn:oid:/i, '');
    return this.getValueSetById(id);
  }

  expandValueSetPost(params: Parameters): Observable<ValueSet> {
    return this.http.post<ValueSet>(this.fhirUrl('/ValueSet/$expand'), params, {
      headers: this.fhirHeaders()
    });
  }

  expandValueSetGet(id: string, query: Record<string, string | number | boolean | undefined>): Observable<ValueSet> {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== '') q.set(k, String(v));
    }
    const qs = q.toString();
    const path = qs
      ? `/ValueSet/${encodeURIComponent(id)}/$expand?${qs}`
      : `/ValueSet/${encodeURIComponent(id)}/$expand`;
    return this.http.get<ValueSet>(this.fhirUrl(path), {
      headers: this.fhirHeaders()
    });
  }

  searchCodeSystems(params: CartosCodeSystemSearchParams): Observable<Bundle> {
    const q = new URLSearchParams();
    const t = (s: string | undefined) => (s == null ? '' : String(s).trim());
    const set = (key: string, value: string | undefined) => {
      const v = t(value);
      if (v) q.set(key, v);
    };
    const nameC = t(params.nameContains);
    if (nameC) q.set('name:contains', nameC);
    const titleC = t(params.titleContains);
    if (titleC) q.set('title:contains', titleC);
    set('url', params.url);
    set('identifier', params.identifier);
    set('version', params.version);
    set('status', params.status);
    set('_sort', params._sort);
    const count = params._count ?? 50;
    q.set('_count', String(Math.min(200, Math.max(1, count))));
    return this.http.get<Bundle>(this.fhirUrl(`/CodeSystem?${q.toString()}`), {
      headers: this.fhirHeaders()
    });
  }

  getCodeSystemById(id: string): Observable<CodeSystem> {
    return this.http.get<CodeSystem>(this.fhirUrl(`/CodeSystem/${encodeURIComponent(id)}`), {
      headers: this.fhirHeaders()
    });
  }
}
