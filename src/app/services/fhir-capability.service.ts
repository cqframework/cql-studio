// Author: Preston Lee

import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { SettingsService } from './settings.service';
import { BaseService } from './base.service';

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
  private readonly _resourceTypes = signal<string[]>([]);
  private readonly _searchParamsByType = signal<Map<string, CapabilitySearchParam[]>>(new Map());

  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly resourceTypes = this._resourceTypes.asReadonly();
  readonly searchParamsByType = this._searchParamsByType.asReadonly();

  readonly searchParamsForResourceType = (resourceType: string) =>
    computed(() => this._searchParamsByType().get(resourceType) ?? []);

  private getBaseUrl(): string {
    const url = this.settingsService.getEffectiveFhirBaseUrl();
    return url?.trim()?.replace(/\/+$/, '') ?? '';
  }

  loadMetadata(): void {
    const baseUrl = this.getBaseUrl();
    if (!baseUrl) {
      this._error.set('FHIR base URL is not configured. Go to Settings to set it.');
      this._resourceTypes.set([]);
      this._searchParamsByType.set(new Map());
      return;
    }

    this._loading.set(true);
    this._error.set(null);

    const metadataUrl = `${baseUrl}/metadata`;
    this.http.get<CapabilityMetadata>(metadataUrl, { headers: this.headers() }).subscribe({
      next: (body) => {
        this._loading.set(false);
        this.parseMetadata(body);
      },
      error: (err) => {
        this._loading.set(false);
        this._error.set(this.getErrorMessage(err));
        this._resourceTypes.set([]);
        this._searchParamsByType.set(new Map());
      }
    });
  }

  private getErrorMessage(err: unknown): string {
    if (err && typeof err === 'object' && 'error' in err) {
      const e = (err as { error?: unknown }).error;
      if (e && typeof e === 'object' && 'message' in e) {
        return String((e as { message: unknown }).message);
      }
    }
    if (err instanceof Error) {
      return err.message;
    }
    return 'Failed to load server metadata';
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
