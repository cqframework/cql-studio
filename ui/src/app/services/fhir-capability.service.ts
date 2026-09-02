// Author: Preston Lee

import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { SettingsService } from './settings.service';
import { BaseService } from './base.service';
import { buildHttpHeaders } from './endpoint-config.lib';
import { describeFhirHttpFailure } from './fhir-http-error.lib';

export interface CapabilitySearchParam {
  name: string;
  type?: string;
}

export interface CapabilityResource {
  type: string;
  searchParam: CapabilitySearchParam[];
}

export interface CapabilityMetadata {
  rest?: Array<{
    resource?: CapabilityResource[];
  }>;
}

export interface ResourceSearchParams {
  resourceType: string;
  searchParams: CapabilitySearchParam[];
}

@Injectable({
  providedIn: 'root'
})
export class FhirCapabilityService extends BaseService {
  private readonly settingsService = inject(SettingsService);

  private readonly _loading = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);
  private readonly _loaded = signal<boolean>(false);
  private readonly _resourceTypes = signal<string[]>([]);
  private readonly _searchParamsByType = signal<Map<string, CapabilitySearchParam[]>>(new Map());
  private loadPromise: Promise<void> | null = null;

  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly loaded = this._loaded.asReadonly();
  readonly resourceTypes = this._resourceTypes.asReadonly();
  readonly searchParamsByType = this._searchParamsByType.asReadonly();

  readonly searchParamsForResourceType = (resourceType: string) =>
    computed(() => this._searchParamsByType().get(resourceType) ?? []);

  private getBaseUrl(): string {
    return this.settingsService.getEffectiveDataEndpointAddress();
  }

  clearCache(): void {
    this._loading.set(false);
    this._error.set(null);
    this._loaded.set(false);
    this._resourceTypes.set([]);
    this._searchParamsByType.set(new Map());
    this.loadPromise = null;
  }

  private metadataHeaders(): HttpHeaders {
    const ctx = this.settingsService.getEndpointHttpContext('data', {
      Accept: 'application/fhir+json'
    });
    return buildHttpHeaders(
      { ...this.settingsService.getActiveEnvironment().dataEndpoint, address: ctx.address },
      ctx.headers
    );
  }

  loadMetadata(): void {
    void this.loadMetadataAsync();
  }

  async ensureMetadataLoaded(): Promise<void> {
    if (this._loaded()) {
      return;
    }
    await this.loadMetadataAsync();
  }

  loadMetadataAsync(): Promise<void> {
    if (this.loadPromise) {
      return this.loadPromise;
    }

    const baseUrl = this.getBaseUrl();
    if (!baseUrl) {
      this._error.set('FHIR data endpoint is not configured. Go to Settings to configure environments.');
      this._resourceTypes.set([]);
      this._searchParamsByType.set(new Map());
      this._loaded.set(true);
      return Promise.resolve();
    }

    this._loading.set(true);
    this._error.set(null);

    const metadataUrl = `${baseUrl}/metadata`;
    this.loadPromise = firstValueFrom(
      this.http.get<CapabilityMetadata>(metadataUrl, { headers: this.metadataHeaders() })
    )
      .then((body) => {
        this.parseMetadata(body);
      })
      .catch((err) => {
        this._error.set(describeFhirHttpFailure(err) || 'Failed to load server metadata');
        this._resourceTypes.set([]);
        this._searchParamsByType.set(new Map());
      })
      .finally(() => {
        this._loading.set(false);
        this._loaded.set(true);
      });

    return this.loadPromise;
  }

  private parseMetadata(body: CapabilityMetadata): void {
    const types: string[] = [];
    const paramsByType = new Map<string, CapabilitySearchParam[]>();

    const rest = body?.rest;
    if (!Array.isArray(rest) || rest.length === 0) {
      this._resourceTypes.set([]);
      this._searchParamsByType.set(new Map());
      return;
    }

    const resources = rest[0]?.resource;
    if (!Array.isArray(resources)) {
      this._resourceTypes.set([]);
      this._searchParamsByType.set(new Map());
      return;
    }

    for (const res of resources) {
      const type = res?.type;
      if (typeof type !== 'string' || !type) {
        continue;
      }
      types.push(type);
      const searchParam = Array.isArray(res.searchParam) ? res.searchParam : [];
      const params: CapabilitySearchParam[] = searchParam
        .filter((p): p is CapabilitySearchParam => p != null && typeof (p as CapabilitySearchParam).name === 'string')
        .map((p) => ({ name: (p as CapabilitySearchParam).name, type: (p as CapabilitySearchParam).type }));
      paramsByType.set(type, params);
    }

    this._resourceTypes.set(types);
    this._searchParamsByType.set(paramsByType);
  }

  getSearchParamsForType(resourceType: string): CapabilitySearchParam[] {
    return this._searchParamsByType().get(resourceType) ?? [];
  }
}
