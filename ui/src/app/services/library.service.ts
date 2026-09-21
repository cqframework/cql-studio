// Author: Preston Lee

import { Injectable, inject, signal } from '@angular/core';
import { BaseService } from './base.service';
import { Library, Parameters, Bundle } from 'fhir/r4';
import { decodeUtf8Base64 } from './utf8-encoding.lib';
import { Observable, of, throwError } from 'rxjs';
import { map, catchError, tap } from 'rxjs/operators';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { SettingsService } from './settings.service';
import { buildHttpHeaders } from './endpoint-config.lib';
import { appendEvaluateEndpointParameters } from './cql-evaluate-parameters.lib';
import {
	LOGIC_LIBRARY_TYPE_CODE,
	MODEL_DEFINITION_TYPE_CODE,
	libraryTypeSearchToken
} from './cql-model-info.lib';

@Injectable({
	providedIn: 'root'
})
export class LibraryService extends BaseService {

  readonly deletedLibraryIds = signal<ReadonlySet<string>>(new Set());

	public static readonly LIBRARY_PATH = '/Library';

	public libraryId: string = '';

	protected settingsService = inject(SettingsService);

	private evaluationHeaders(extra?: Record<string, string>): HttpHeaders {
		const ctx = this.settingsService.getEndpointHttpContext('evaluation', {
			'Content-Type': 'application/fhir+json',
			Accept: 'application/fhir+json',
			// Cache-Control is CORS-allowed by HAPI; do not send Pragma (not in Allow-Headers).
			'Cache-Control': 'no-cache, no-store',
			...(extra ?? {})
		});
		return buildHttpHeaders(
			{ ...this.settingsService.getActiveEnvironment().evaluationServer, address: ctx.address },
			ctx.headers
		);
	}

	private contentHeaders(): HttpHeaders {
		const ctx = this.settingsService.getEndpointHttpContext('content', {
			'Content-Type': 'application/fhir+json',
			Accept: 'application/fhir+json',
			'Cache-Control': 'no-cache, no-store'
		});
		return buildHttpHeaders(
			{ ...this.settingsService.getActiveEnvironment().contentEndpoint, address: ctx.address },
			ctx.headers
		);
	}

	private evaluationBaseUrl(): string {
		return this.settingsService.getEffectiveEvaluationServerUrl();
	}

	private contentBaseUrl(): string {
		return this.settingsService.getEffectiveContentEndpointAddress();
	}

	public order: 'asc' | 'desc' = 'asc';
	public pageSize = 10;
	public offset = 0;

	url(): string {
		return this.evaluationBaseUrl() + LibraryService.LIBRARY_PATH;
	}

	contentUrl(): string {
		return this.contentBaseUrl() + LibraryService.LIBRARY_PATH;
	}

	contentUrlFor(id: string): string {
		return this.contentBaseUrl() + '/Library/' + id;
	}

	search(searchTerm: string): Observable<Bundle> {
		const type = encodeURIComponent(libraryTypeSearchToken(LOGIC_LIBRARY_TYPE_CODE));
		return this.http.get<Bundle>(
			this.url() + `?type=${type}&title:contains=` + encodeURIComponent(searchTerm),
			{ headers: this.evaluationHeaders() }
		);
	}

	// Search logic-library Libraries with pagination and sorting
	// Uses title:contains for searching (searches the human-friendly title field)
	searchPaginated(searchTerm: string, page: number = 1, pageSize: number = 10, sortBy: string = 'name', order: 'asc' | 'desc' = 'asc'): Observable<Bundle> {
		const offset = (page - 1) * pageSize;
		const type = encodeURIComponent(libraryTypeSearchToken(LOGIC_LIBRARY_TYPE_CODE));
		let url = this.url() + `?type=${type}&_count=${pageSize}&_offset=${offset}`;
		
		// Add search parameter - search on title field
		const encodedTerm = encodeURIComponent(searchTerm);
		url += `&title:contains=${encodedTerm}`;
		
		// Add sorting parameters
		if (sortBy === 'name') {
			url += `&_sort=${order === 'asc' ? 'name' : '-name'}`;
		} else if (sortBy === 'version') {
			url += `&_sort=${order === 'asc' ? 'version' : '-version'}`;
		} else if (sortBy === 'date') {
			url += `&_sort=${order === 'asc' ? 'date' : '-date'}`;
		}
		
		return this.http.get<Bundle>(url, { headers: this.evaluationHeaders() });
	}

	// Get paginated list of logic-library Libraries (excludes model-definition, etc.)
	getAll(page: number = 1, pageSize: number = 10, sortBy: string = 'name', order: 'asc' | 'desc' = 'asc'): Observable<Bundle> {
		const offset = (page - 1) * pageSize;
		const type = encodeURIComponent(libraryTypeSearchToken(LOGIC_LIBRARY_TYPE_CODE));
		let url = this.url() + `?type=${type}&_count=${pageSize}&_offset=${offset}`;
		
		// Add sorting parameters
		if (sortBy === 'name') {
			url += `&_sort=${order === 'asc' ? 'name' : '-name'}`;
		} else if (sortBy === 'version') {
			url += `&_sort=${order === 'asc' ? 'version' : '-version'}`;
		} else if (sortBy === 'date') {
			url += `&_sort=${order === 'asc' ? 'date' : '-date'}`;
		}
		
		return this.http.get<Bundle>(url, { headers: this.evaluationHeaders() });
	}

	urlFor(id: string) {
		return this.evaluationBaseUrl() + '/Library/' + id;
	}

	/**
	 * Bypass HTTP cache for instance reads. HAPI ETags restart after DB reset/reimport
	 * (often still W/"1"), so a conditional GET can 304 and return a stale Library body
	 * while search bundles (different URL) show the new version — e.g. Navigation v1.0.1
	 * vs editor CQL still on 1.0.0 after a hard refresh of the SPA alone.
	 */
	private uncachedUrl(url: string): string {
		const sep = url.includes('?') ? '&' : '?';
		return `${url}${sep}_=${Date.now()}`;
	}

	get(id: string) {
		return this.http.get<Library>(this.uncachedUrl(this.urlFor(id)), { headers: this.evaluationHeaders() });
	}

	findByNameAndVersion(
		name: string,
		version?: string,
		useContentEndpoint = false,
		typeCode?: string
	): Observable<Library | null> {
		const base = useContentEndpoint ? this.contentUrl() : this.url();
		let url = base + `?name=${encodeURIComponent(name)}&_count=1`;
		if (version) {
			url += `&version=${encodeURIComponent(version)}`;
		}
		if (typeCode) {
			url += `&type=${encodeURIComponent(libraryTypeSearchToken(typeCode))}`;
		}
		return this.http.get<Bundle>(url, { headers: useContentEndpoint ? this.contentHeaders() : this.evaluationHeaders() }).pipe(
			map(bundle => {
				const entry = bundle.entry?.[0]?.resource;
				return entry?.resourceType === 'Library' ? entry as Library : null;
			}),
			catchError(() => of(null))
		);
	}

	/**
	 * Search model-definition Libraries on the content endpoint (paginated).
	 * Falls back to evaluation when content address is empty (effective-address rules).
	 */
	searchModelDefinitions(
		searchTerm: string,
		page: number = 1,
		pageSize: number = 10,
		useContentEndpoint = true
	): Observable<Bundle> {
		const offset = (page - 1) * pageSize;
		const base = useContentEndpoint ? this.contentUrl() : this.url();
		let url =
			base +
			`?type=${encodeURIComponent(libraryTypeSearchToken(MODEL_DEFINITION_TYPE_CODE))}` +
			`&_count=${pageSize}&_offset=${offset}&_sort=name`;
		const term = searchTerm.trim();
		if (term) {
			url += `&name:contains=${encodeURIComponent(term)}`;
		}
		return this.http.get<Bundle>(url, {
			headers: useContentEndpoint ? this.contentHeaders() : this.evaluationHeaders()
		});
	}

	getOnContent(id: string): Observable<Library> {
		return this.http.get<Library>(this.uncachedUrl(this.contentUrlFor(id)), {
			headers: this.contentHeaders()
		});
	}

	postOnContent(library: Library): Observable<Library> {
		return this.http.post<Library>(this.contentUrl(), JSON.stringify(library), {
			headers: this.contentHeaders()
		});
	}

	putOnContent(library: Library): Observable<Library> {
		return this.http.put<Library>(this.contentUrlFor(library.id!), JSON.stringify(library), {
			headers: this.contentHeaders()
		});
	}

	deleteOnContent(library: Library): Observable<Library> {
		return this.http.delete<Library>(this.contentUrlFor(library.id!), {
			headers: this.contentHeaders()
		}).pipe(
			tap(() => {
				if (library.id) {
					this.deletedLibraryIds.update((ids) => new Set(ids).add(library.id!));
				}
			})
		);
	}

	getElmXml(library: Library): Observable<string> {
		const content = library.content?.find(c => c.contentType === 'application/elm+xml');
		if (!content) {
			return of('');
		}
		if (content.data) {
			try {
				return of(decodeUtf8Base64(content.data));
			} catch {
				return of('');
			}
		}
		if (content.url) {
			const headers = new HttpHeaders({ 'Accept': 'application/xml, text/xml' });
			return this.http.get(content.url, { headers, responseType: 'text' }).pipe(
				catchError(() => of(''))
			);
		}
		return of('');
	}

	getCqlContent(library: Library): Observable<{ cqlContent: string; fromUrl: boolean }> {
		const content = library.content?.find(c => c.contentType === 'text/cql');
		if (!content) {
			return of({ cqlContent: '', fromUrl: false });
		}
		if (content.data) {
			try {
				const cqlContent = decodeUtf8Base64(content.data);
				return of({ cqlContent, fromUrl: false });
			} catch {
				return of({ cqlContent: '', fromUrl: false });
			}
		}
		if (content.url) {
			const headers = new HttpHeaders({ 'Accept': 'text/plain, text/cql' });
			return this.http.get(content.url, { headers, responseType: 'text' }).pipe(
				map(body => ({ cqlContent: body, fromUrl: true })),
				catchError(err => {
					const message = err?.message ?? err?.statusText ?? String(err);
					const status = err?.status;
					return throwError(() => new Error(status ? `HTTP ${status}: ${message}` : message));
				})
			);
		}
		return of({ cqlContent: '', fromUrl: false });
	}

	getExampleCql(url: string) {
		let headers = new HttpHeaders({ 'Accept': 'text/plain' });
		return this.http.get<string>(url, { headers: headers, responseType: 'text' as 'json' });
	}

	post(Library: Library) {
		return this.http.post<Library>(this.url(), JSON.stringify(Library), { headers: this.evaluationHeaders() });
	}

	put(Library: Library) {
		return this.http.put<Library>(this.urlFor(Library.id!), JSON.stringify(Library), { headers: this.evaluationHeaders() });
	}

	delete(Library: Library) {
		return this.http.delete<Library>(this.urlFor(Library.id!), { headers: this.evaluationHeaders() }).pipe(tap(() => {
      this.deletedLibraryIds.update(ids => new Set(ids).add(Library.id!));
    }));
	}

    evaluate(libraryId: string, parameters: Parameters) {
		appendEvaluateEndpointParameters(parameters, this.settingsService.getActiveEnvironment());
        return this.http.post<Parameters>(
			this.urlFor(libraryId) + '/$evaluate',
			JSON.stringify(parameters),
			{ headers: this.evaluationHeaders() }
		);
    }
}
