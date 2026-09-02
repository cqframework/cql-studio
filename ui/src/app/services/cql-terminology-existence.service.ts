// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Bundle, CodeSystem, Resource, ValueSet } from 'fhir/r4';
import { TerminologyService } from './terminology.service';
import {
  CqlTerminologyResourceKind,
  provisionalFhirIdFromUrl
} from './cql-terminology-symbols.lib';

export interface TerminologyExistenceHit {
  resourceType: CqlTerminologyResourceKind;
  id: string;
  url: string;
}

type CacheEntry =
  | { status: 'pending' }
  | { status: 'miss' }
  | { status: 'hit'; hit: TerminologyExistenceHit };

@Injectable({
  providedIn: 'root'
})
export class CqlTerminologyExistenceService {
  private readonly terminologyService = inject(TerminologyService);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<TerminologyExistenceHit | null>>();

  cacheKey(resourceType: CqlTerminologyResourceKind, url: string): string {
    return `${resourceType}|${url.trim()}`;
  }

  getCached(resourceType: CqlTerminologyResourceKind, url: string): TerminologyExistenceHit | null | undefined {
    const entry = this.cache.get(this.cacheKey(resourceType, url));
    if (!entry) {
      return undefined;
    }
    if (entry.status === 'pending') {
      return undefined;
    }
    if (entry.status === 'miss') {
      return null;
    }
    return entry.hit;
  }

  async resolve(
    resourceType: CqlTerminologyResourceKind,
    url: string
  ): Promise<TerminologyExistenceHit | null> {
    const key = this.cacheKey(resourceType, url);
    const cached = this.cache.get(key);
    if (cached?.status === 'hit') {
      return cached.hit;
    }
    if (cached?.status === 'miss') {
      return null;
    }

    const existing = this.inFlight.get(key);
    if (existing) {
      return existing;
    }

    this.cache.set(key, { status: 'pending' });
    const promise = this.lookup(resourceType, url)
      .then(hit => {
        this.cache.set(key, hit ? { status: 'hit', hit } : { status: 'miss' });
        this.inFlight.delete(key);
        return hit;
      })
      .catch(() => {
        this.cache.set(key, { status: 'miss' });
        this.inFlight.delete(key);
        return null;
      });
    this.inFlight.set(key, promise);
    return promise;
  }

  private async lookup(
    resourceType: CqlTerminologyResourceKind,
    url: string
  ): Promise<TerminologyExistenceHit | null> {
    const trimmed = url.trim();
    if (!trimmed) {
      return null;
    }

    if (resourceType === 'ValueSet') {
      const bundle = await firstValueFrom(
        this.terminologyService.searchValueSets({ url: trimmed, _count: 1 })
      );
      const resource = firstBundleResource<ValueSet>(bundle, 'ValueSet');
      if (!resource?.id) {
        return null;
      }
      return {
        resourceType: 'ValueSet',
        id: resource.id,
        url: resource.url ?? trimmed
      };
    }

    try {
      const byUrl = await firstValueFrom(this.terminologyService.getCodeSystemByUrl(trimmed));
      if (byUrl?.id) {
        return {
          resourceType: 'CodeSystem',
          id: byUrl.id,
          url: byUrl.url ?? trimmed
        };
      }
    } catch {
      // fall through to search
    }

    const bundle = await firstValueFrom(
      this.terminologyService.searchCodeSystems({ url: trimmed, _count: 1 })
    );
    const resource = firstBundleResource<CodeSystem>(bundle, 'CodeSystem');
    if (!resource?.id) {
      return null;
    }
    return {
      resourceType: 'CodeSystem',
      id: resource.id,
      url: resource.url ?? trimmed
    };
  }

  openRequestFromHit(hit: TerminologyExistenceHit): { resourceType: CqlTerminologyResourceKind; id: string; url: string } {
    return {
      resourceType: hit.resourceType,
      id: hit.id || provisionalFhirIdFromUrl(hit.url),
      url: hit.url
    };
  }
}

function firstBundleResource<T extends Resource>(
  bundle: Bundle | null | undefined,
  resourceType: string
): T | null {
  const entry = bundle?.entry?.find(e => e.resource?.resourceType === resourceType);
  return (entry?.resource as T | undefined) ?? null;
}
