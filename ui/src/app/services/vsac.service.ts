// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { SettingsService } from './settings.service';
import { Bundle, CapabilityStatement, Parameters, ValueSet } from 'fhir/r4';
import { isResourceType } from './fhir-resource-type.lib';

const FHIR_JSON = 'application/fhir+json';
const VSAC_FHIR_BASE_HEADER = 'X-VSAC-FHIR-Base-URL';

/** Parameters for GET ValueSet?… against CTS/VSAC (see server CapabilityStatement). */
export interface ValueSetSearchParams {
  /** FHIR `name` with `:contains` (machine-oriented id / label). */
  nameContains?: string;
  /** FHIR `title` with `:contains` (maps to VSAC display name per NLM). */
  titleContains?: string;
  url?: string;
  identifier?: string;
  version?: string;
  status?: string;
  publisherContains?: string;
  descriptionContains?: string;
  /** Expansion / release business identifier (e.g. eCQM or C-CDA release label). */
  expansion?: string;
  /** Composite usage token (e.g. <code>VSAC$covid</code>). */
  usage?: string;
  keyword?: string;
  /** Find value sets that include this code (server-specific semantics). */
  code?: string;
  codesystem?: string;
  measure?: string;
  library?: string;
  artifact?: string;
  reference?: string;
  valueset?: string;
  /** FHIR date parameter (supports prefixes such as <code>ge2020</code>). */
  date?: string;
  _id?: string;
  _lastUpdated?: string;
  /** When the server advertises `_sort` for ValueSet search (see CapabilityStatement). */
  _sort?: string;
  _count?: number;
}

/**
 * True when the CapabilityStatement lists `_sort` for ValueSet search (REST-wide or on the ValueSet type).
 */
export function capabilityStatementSupportsValueSetSort(cap: CapabilityStatement | null | undefined): boolean {
  if (!cap?.rest?.length) return false;
  for (const rest of cap.rest) {
    for (const sp of rest.searchParam ?? []) {
      if (sp.name === '_sort') return true;
    }
    for (const r of rest.resource ?? []) {
      if (r.type !== 'ValueSet') continue;
      for (const sp of r.searchParam ?? []) {
        if (sp.name === '_sort') return true;
      }
    }
  }
  return false;
}

/**
 * ValueSet `searchParam` names suitable as `_sort` keys (no chained/modifier syntax).
 */
export function valueSetSortFieldChoicesFromCapability(cap: CapabilityStatement | null | undefined): string[] {
  if (!cap?.rest?.length) return [];
  const names = new Set<string>();
  for (const rest of cap.rest) {
    for (const r of rest.resource ?? []) {
      if (r.type !== 'ValueSet') continue;
      for (const sp of r.searchParam ?? []) {
        const n = sp.name;
        if (typeof n === 'string' && n.length > 0 && !n.includes(':')) {
          names.add(n);
        }
      }
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

@Injectable({
  providedIn: 'root'
})
export class VsacService {
  private http = inject(HttpClient);
  private settingsService = inject(SettingsService);

  private authHeader(): string {
    const user = this.settingsService.getEffectiveVsacApiUsername();
    const pass = this.settingsService.getEffectiveVsacApiPassword();
    // HTTP Basic credentials (RFC 7617 Latin-1), not FHIR Library.content — do not use encodeUtf8Base64.
    const token = btoa(`${user}:${pass}`);
    return `Basic ${token}`;
  }

  private studioServerBaseUrl(): string {
    return this.settingsService.getEffectiveServerBaseUrl().replace(/\/+$/, '');
  }

  private fhirHeaders(extra?: Record<string, string>): HttpHeaders {
    let h = new HttpHeaders({
      Accept: FHIR_JSON,
      'Content-Type': FHIR_JSON,
      Authorization: this.authHeader()
    });
    h = h.set(VSAC_FHIR_BASE_HEADER, this.settingsService.getEffectiveVsacFhirBaseUrl());
    if (extra) {
      for (const [k, v] of Object.entries(extra)) {
        h = h.set(k, v);
      }
    }
    return h;
  }

  private fhirUrl(suffix: string): string {
    const path = suffix.startsWith('/') ? suffix : `/${suffix}`;
    return `${this.studioServerBaseUrl()}/api/vsac/fhir${path}`;
  }

  /**
   * Maps an absolute Bundle.link URL from CTS/UAT-CTS to a path+query for the studio `/api/vsac/fhir` proxy.
   * Returns null if the link host does not match the configured VSAC FHIR base.
   */
  fhirPathAndQueryFromBundleLink(linkUrl: string): string | null {
    const baseStr = this.settingsService.getEffectiveVsacFhirBaseUrl().replace(/\/+$/, '');
    let link: URL;
    let base: URL;
    try {
      link = new URL(linkUrl.trim());
      base = new URL(baseStr);
    } catch {
      return null;
    }
    const allowed = new Set(['cts.nlm.nih.gov', 'uat-cts.nlm.nih.gov']);
    if (!allowed.has(link.hostname) || link.hostname !== base.hostname) {
      return null;
    }
    const basePath = base.pathname.replace(/\/+$/, '') || '/';
    if (!link.pathname.startsWith(basePath)) {
      return null;
    }
    let rest = link.pathname.slice(basePath.length);
    if (rest === '') {
      rest = '/';
    } else if (!rest.startsWith('/')) {
      rest = `/${rest}`;
    }
    return `${rest}${link.search}`;
  }

  /** GET a searchset page using a Bundle.link URL from a prior ValueSet search response. */
  getValueSetSearchByBundleLink(linkUrl: string): Observable<Bundle> {
    const pq = this.fhirPathAndQueryFromBundleLink(linkUrl);
    if (!pq) {
      throw new Error('Pagination link does not match the configured VSAC FHIR base URL host.');
    }
    return this.http.get<Bundle>(this.fhirUrl(pq), {
      headers: this.fhirHeaders()
    });
  }

  /** GET /metadata CapabilityStatement */
  getMetadata(): Observable<CapabilityStatement> {
    return this.http.get<CapabilityStatement>(this.fhirUrl('/metadata'), {
      headers: this.fhirHeaders()
    });
  }

  searchValueSets(params: ValueSetSearchParams): Observable<Bundle> {
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
    const pubC = t(params.publisherContains);
    if (pubC) q.set('publisher:contains', pubC);
    const descC = t(params.descriptionContains);
    if (descC) q.set('description:contains', descC);
    set('url', params.url);
    set('identifier', params.identifier);
    set('version', params.version);
    set('status', params.status);
    set('expansion', params.expansion);
    set('usage', params.usage);
    set('keyword', params.keyword);
    set('code', params.code);
    set('codesystem', params.codesystem);
    set('measure', params.measure);
    set('library', params.library);
    set('artifact', params.artifact);
    set('reference', params.reference);
    set('valueset', params.valueset);
    set('date', params.date);
    set('_id', params._id);
    set('_lastUpdated', params._lastUpdated);
    set('_sort', params._sort);
    const count = params._count ?? 50;
    q.set('_count', String(Math.min(200, Math.max(1, count))));
    const qs = q.toString();
    return this.http.get<Bundle>(this.fhirUrl(`/ValueSet?${qs}`), {
      headers: this.fhirHeaders()
    });
  }

  /**
   * VSAC exposes value sets by OID as logical id for many resources.
   */
  getValueSetById(id: string): Observable<ValueSet> {
    const enc = encodeURIComponent(id);
    return this.http.get<ValueSet>(this.fhirUrl(`/ValueSet/${enc}`), {
      headers: this.fhirHeaders()
    });
  }

  /**
   * Read by logical id / OID, or resolve by canonical `url` when the input is an absolute http(s) URL.
   */
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
    const path = qs ? `/ValueSet/${encodeURIComponent(id)}/$expand?${qs}` : `/ValueSet/${encodeURIComponent(id)}/$expand`;
    return this.http.get<ValueSet>(this.fhirUrl(path), {
      headers: this.fhirHeaders()
    });
  }

  /**
   * Proxied GET under https://vsac.nlm.nih.gov — path must start with /vsac/.
   */
  getVsacSite(pathAndQuery: string): Observable<string> {
    const path = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`;
    if (!path.startsWith('/vsac/')) {
      throw new Error('VSAC site path must start with /vsac/');
    }
    const url = `${this.studioServerBaseUrl()}/api/vsac/site${path}`;
    return this.http.get(url, {
      headers: new HttpHeaders({
        Accept: 'application/json, application/xml, text/xml, */*',
        Authorization: this.authHeader()
      }),
      responseType: 'text'
    });
  }

  listPrograms(): Observable<string> {
    return this.getVsacSite('/vsac/programs');
  }

  listTagNames(): Observable<string> {
    return this.getVsacSite('/vsac/tagNames');
  }

  /** SVS RetrieveMultipleValueSets — returns XML by default. */
  retrieveMultipleValueSets(query: Record<string, string>): Observable<string> {
    const q = new URLSearchParams(query);
    return this.getVsacSite(`/vsac/svs/RetrieveMultipleValueSets?${q.toString()}`);
  }
}
