// Author: Preston Lee

import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CodeSystem, ConceptMap, ValueSet } from 'fhir/r4';
import { TerminologyService } from './terminology.service';
import { isResourceType } from './fhir-resource-type.lib';
import {
  TERMINOLOGY_QUERY_ID,
  TERMINOLOGY_QUERY_URL,
  TerminologyOpenResourceType,
  terminologyResourcePath,
} from './terminology-resource-opener.deep-link';

export type { TerminologyOpenResourceType } from './terminology-resource-opener.deep-link';

export interface TerminologyOpenRequest {
  resourceType: TerminologyOpenResourceType;
  id: string;
  url?: string;
}

export type TerminologyOpenedResource = ValueSet | CodeSystem | ConceptMap;

@Injectable({
  providedIn: 'root',
})
export class TerminologyResourceOpenerService {
  private readonly router = inject(Router);
  private readonly terminologyService = inject(TerminologyService);

  private readonly _pending = signal<TerminologyOpenRequest | null>(null);

  readonly pending = this._pending.asReadonly();

  async requestOpen(request: TerminologyOpenRequest): Promise<boolean> {
    const id = request.id.trim();
    if (!id) {
      return false;
    }
    const normalized: TerminologyOpenRequest = {
      resourceType: request.resourceType,
      id,
      url: request.url?.trim() || undefined,
    };
    this._pending.set(normalized);
    const path = terminologyResourcePath(request.resourceType);
    const queryParams: Record<string, string> = { [TERMINOLOGY_QUERY_ID]: id };
    if (normalized.url) {
      queryParams[TERMINOLOGY_QUERY_URL] = normalized.url;
    }
    const navigated = await this.router.navigate([path], { queryParams });
    if (!navigated) {
      this._pending.set(null);
    }
    return navigated;
  }

  consumePending(expectedType: TerminologyOpenResourceType): TerminologyOpenRequest | null {
    const current = this._pending();
    if (!current || current.resourceType !== expectedType) {
      return null;
    }
    this._pending.set(null);
    return current;
  }

  async fetchResource(request: TerminologyOpenRequest): Promise<TerminologyOpenedResource | null> {
    const id = request.id.trim();
    if (!id) {
      return null;
    }
    const url = request.url?.trim() || undefined;
    switch (request.resourceType) {
      case 'ValueSet':
        return this.fetchValueSet(id, url);
      case 'CodeSystem':
        return this.fetchCodeSystem(id, url);
      case 'ConceptMap':
        return this.fetchConceptMap(id, url);
    }
  }

  private async fetchValueSet(id: string, url?: string): Promise<ValueSet | null> {
    try {
      return await firstValueFrom(this.terminologyService.getValueSet(id));
    } catch {
      if (!url) {
        return null;
      }
      try {
        const bundle = await firstValueFrom(
          this.terminologyService.searchValueSets({ url, _count: 1 })
        );
        return (
          bundle.entry
            ?.map((e) => e.resource)
            .find((r): r is ValueSet => isResourceType(r, 'ValueSet')) ?? null
        );
      } catch {
        return null;
      }
    }
  }

  private async fetchCodeSystem(id: string, url?: string): Promise<CodeSystem | null> {
    try {
      return await firstValueFrom(this.terminologyService.getCodeSystem(id));
    } catch {
      if (!url) {
        return null;
      }
      try {
        return await firstValueFrom(this.terminologyService.getCodeSystemByUrl(url));
      } catch {
        try {
          const bundle = await firstValueFrom(
            this.terminologyService.searchCodeSystems({ url, _count: 1 })
          );
          return (
            bundle.entry
              ?.map((e) => e.resource)
              .find((r): r is CodeSystem => isResourceType(r, 'CodeSystem')) ?? null
          );
        } catch {
          return null;
        }
      }
    }
  }

  private async fetchConceptMap(id: string, url?: string): Promise<ConceptMap | null> {
    try {
      return await firstValueFrom(this.terminologyService.getConceptMap(id));
    } catch {
      if (!url) {
        return null;
      }
      try {
        const bundle = await firstValueFrom(
          this.terminologyService.searchConceptMaps({ url, _count: 1 })
        );
        return (
          bundle.entry
            ?.map((e) => e.resource)
            .find((r): r is ConceptMap => isResourceType(r, 'ConceptMap')) ?? null
        );
      } catch {
        return null;
      }
    }
  }
}
