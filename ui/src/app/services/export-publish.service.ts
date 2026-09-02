// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom, Observable } from 'rxjs';
import { Bundle, Resource } from 'fhir/r4';
import { EndpointHttpContext } from '../models/environment.model';
import { resourceTypeOf } from './fhir-resource-type.lib';
import { collectionBundleToTransaction, normalizeBundleForBasePost } from './fhir-bundle-transaction.lib';
import {
  cloneBundleEntriesWithHapiSafeClientIds,
  cloneResourcesWithHapiSafeClientIds
} from './fhir-hapi-client-id.lib';
import { describeFhirHttpFailure } from './fhir-http-error.lib';
import { normalizeFhirBaseUrlForBundlePost } from './fhir-server-base.lib';

const TERMINOLOGY_TYPES = new Set(['CodeSystem', 'ValueSet', 'ConceptMap', 'NamingSystem']);

const TERM_ORDER: Record<string, number> = {
  CodeSystem: 1,
  NamingSystem: 2,
  ValueSet: 3,
  ConceptMap: 4
};

export interface ExportPublishOutcome {
  channel: 'terminology' | 'data' | 'merged';
  success: boolean;
  message: string;
  response?: Bundle;
}

/** Explicit copy/publish destination; not the active/effective environment. */
export interface ExportPublishTarget {
  data: EndpointHttpContext;
  terminology: EndpointHttpContext;
}

@Injectable({
  providedIn: 'root'
})
export class ExportPublishService {
  private readonly http = inject(HttpClient);

  partitionResources(resources: Resource[]): { termRes: Resource[]; dataRes: Resource[] } {
    const termRes: Resource[] = [];
    const dataRes: Resource[] = [];
    for (const r of resources) {
      const rt = resourceTypeOf(r) ?? '';
      if (TERMINOLOGY_TYPES.has(rt)) {
        termRes.push(r);
      } else {
        dataRes.push(r);
      }
    }
    return {
      termRes: this.sortTerm(termRes),
      dataRes
    };
  }

  /**
   * Publish a pre-built Bundle (e.g. CRMI transaction with ifNoneExist).
   * Entries that already have `request` are preserved; collection bundles with
   * requests are promoted to transaction before POST.
   */
  async publishBundle(
    bundle: Bundle,
    target: ExportPublishTarget,
    onProgress?: (message: string) => void
  ): Promise<ExportPublishOutcome[]> {
    const resources = (bundle.entry ?? [])
      .map((e) => e.resource)
      .filter((r): r is Resource => !!r);

    const hasRequests = (bundle.entry ?? []).some((e) => !!e.request);
    if (hasRequests) {
      const transactionBundle: Bundle =
        bundle.type === 'transaction'
          ? bundle
          : {
              ...bundle,
              type: 'transaction'
            };
      return this.publishPartitionedBundles(resources, transactionBundle, target, onProgress);
    }

    return this.publishResources(resources, target, onProgress);
  }

  /**
   * Publish a flat resource list via unconditional PUT/POST transactions. For conditional-create
   * (CRMI) semantics, build a Bundle with `request` entries and call `publishBundle` instead.
   */
  async publishResources(
    resources: Resource[],
    target: ExportPublishTarget,
    onProgress?: (message: string) => void
  ): Promise<ExportPublishOutcome[]> {
    const { termRes, dataRes } = this.partitionResources(resources);
    this.assertTargetConfigured(target, termRes, dataRes);
    const outcomes: ExportPublishOutcome[] = [];
    const tu = target.terminology.address.replace(/\/+$/, '');
    const fu = target.data.address.replace(/\/+$/, '');
    const merged = termRes.length > 0 && dataRes.length > 0 && tu === fu;

    if (merged) {
      onProgress?.(`Copying ${termRes.length + dataRes.length} resources (merged endpoint)…`);
      const bundle = this.toUnconditionalTransaction([...termRes, ...dataRes]);
      outcomes.push(await this.postChannel(bundle, 'merged', target.terminology));
      return outcomes;
    }

    if (termRes.length > 0) {
      onProgress?.(`Copying ${termRes.length} terminology resources…`);
      const bundle = this.toUnconditionalTransaction(termRes);
      outcomes.push(await this.postChannel(bundle, 'terminology', target.terminology));
    }
    if (dataRes.length > 0) {
      onProgress?.(`Copying ${dataRes.length} data resources…`);
      const bundle = this.toUnconditionalTransaction(dataRes);
      outcomes.push(await this.postChannel(bundle, 'data', target.data));
    }

    if (outcomes.length === 0) {
      outcomes.push({
        channel: 'data',
        success: false,
        message: 'No resources to copy.'
      });
    }
    return outcomes;
  }

  private async publishPartitionedBundles(
    resources: Resource[],
    fullBundle: Bundle,
    target: ExportPublishTarget,
    onProgress?: (message: string) => void
  ): Promise<ExportPublishOutcome[]> {
    const { termRes, dataRes } = this.partitionResources(resources);
    this.assertTargetConfigured(target, termRes, dataRes);
    const entryByKey = new Map<string, NonNullable<Bundle['entry']>[number]>();
    for (const e of fullBundle.entry ?? []) {
      if (e.resource) {
        entryByKey.set(this.resourceKey(e.resource), e);
      }
    }

    const pickEntries = (list: Resource[]) =>
      list
        .map((r) => entryByKey.get(this.resourceKey(r)))
        .filter((e): e is NonNullable<Bundle['entry']>[number] => !!e);

    const outcomes: ExportPublishOutcome[] = [];
    const tu = target.terminology.address.replace(/\/+$/, '');
    const fu = target.data.address.replace(/\/+$/, '');
    const merged = termRes.length > 0 && dataRes.length > 0 && tu === fu;

    if (merged) {
      onProgress?.('Copying transaction (merged endpoint)…');
      const bundle: Bundle = {
        resourceType: 'Bundle',
        type: 'transaction',
        entry: cloneBundleEntriesWithHapiSafeClientIds(pickEntries([...termRes, ...dataRes]))
      };
      outcomes.push(await this.postChannel(bundle, 'merged', target.terminology));
      return outcomes;
    }

    if (termRes.length > 0) {
      onProgress?.('Copying terminology transaction…');
      const bundle: Bundle = {
        resourceType: 'Bundle',
        type: 'transaction',
        entry: cloneBundleEntriesWithHapiSafeClientIds(pickEntries(termRes))
      };
      outcomes.push(await this.postChannel(bundle, 'terminology', target.terminology));
    }
    if (dataRes.length > 0) {
      onProgress?.('Copying data transaction…');
      const bundle: Bundle = {
        resourceType: 'Bundle',
        type: 'transaction',
        entry: cloneBundleEntriesWithHapiSafeClientIds(pickEntries(dataRes))
      };
      outcomes.push(await this.postChannel(bundle, 'data', target.data));
    }
    return outcomes;
  }

  private assertTargetConfigured(
    target: ExportPublishTarget,
    termRes: Resource[],
    dataRes: Resource[]
  ): void {
    if (termRes.length > 0 && !target.terminology.address.trim()) {
      throw new Error('Target environment has no terminology FHIR endpoint configured.');
    }
    if (dataRes.length > 0 && !target.data.address.trim()) {
      throw new Error('Target environment has no data FHIR endpoint configured.');
    }
    if (termRes.length === 0 && dataRes.length === 0) {
      return;
    }
    if (!target.data.address.trim() && !target.terminology.address.trim()) {
      throw new Error('Target environment has no data or terminology FHIR endpoint configured.');
    }
  }

  private toUnconditionalTransaction(resources: Resource[]): Bundle {
    // HAPI (HAPI-0960) rejects client-assigned logical ids made only of digits (common in
    // registry packages such as hl7.fhir.r4.core); rewrite them before building PUT entries.
    const safe = cloneResourcesWithHapiSafeClientIds(resources);
    return collectionBundleToTransaction({
      resourceType: 'Bundle',
      type: 'collection',
      entry: safe.map((resource) => ({ resource }))
    });
  }

  private postBundleToContext(bundle: Bundle, ctx: EndpointHttpContext): Observable<Bundle> {
    const baseUrl = normalizeFhirBaseUrlForBundlePost(ctx.address);
    if (!baseUrl) {
      return new Observable((subscriber) => {
        subscriber.error(new Error('FHIR endpoint is not configured for the target environment'));
      });
    }
    const payload = normalizeBundleForBasePost(bundle);
    const headers = new HttpHeaders({
      'Content-Type': 'application/fhir+json',
      Accept: 'application/fhir+json',
      ...ctx.headers
    });
    return this.http.post<Bundle>(baseUrl, payload, { headers });
  }

  private async postChannel(
    bundle: Bundle,
    channel: ExportPublishOutcome['channel'],
    ctx: EndpointHttpContext
  ): Promise<ExportPublishOutcome> {
    try {
      const response = await firstValueFrom(this.postBundleToContext(bundle, ctx));
      return {
        channel,
        success: true,
        message: `Copied ${bundle.entry?.length ?? 0} resources via ${channel}.`,
        response
      };
    } catch (err) {
      return {
        channel,
        success: false,
        message: `Copy failed (${channel}): ${describeFhirHttpFailure(err)}`
      };
    }
  }

  private sortTerm(list: Resource[]): Resource[] {
    return [...list].sort((a, b) => {
      const oa = TERM_ORDER[resourceTypeOf(a) ?? ''] ?? 99;
      const ob = TERM_ORDER[resourceTypeOf(b) ?? ''] ?? 99;
      return oa - ob;
    });
  }

  private resourceKey(resource: Resource): string {
    const rt = resourceTypeOf(resource) ?? 'Resource';
    const meta = resource as unknown as { url?: string; id?: string };
    const id = typeof meta.id === 'string' ? meta.id : '';
    const url = typeof meta.url === 'string' ? meta.url : '';
    return `${rt}|${id}|${url}`;
  }
}
