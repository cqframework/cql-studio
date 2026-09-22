// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom, Observable } from 'rxjs';
import { Bundle, Library, Resource } from 'fhir/r4';
import { EndpointHttpContext } from '../models/environment.model';
import { resourceTypeOf } from './fhir-resource-type.lib';
import { collectionBundleToTransaction, normalizeBundleForBasePost } from './fhir-bundle-transaction.lib';
import {
  cloneBundleEntriesWithHapiSafeClientIds,
  cloneResourcesWithHapiSafeClientIds
} from './fhir-hapi-client-id.lib';
import { describeFhirHttpFailure } from './fhir-http-error.lib';
import { normalizeFhirBaseUrlForBundlePost } from './fhir-server-base.lib';
import { isModelDefinitionLibrary, normalizeModelDefinitionLibrary } from './cql-model-info.lib';

const TERMINOLOGY_TYPES = new Set(['CodeSystem', 'ValueSet', 'ConceptMap', 'NamingSystem']);

const TERM_ORDER: Record<string, number> = {
  CodeSystem: 1,
  NamingSystem: 2,
  ValueSet: 3,
  ConceptMap: 4
};

export type ExportPublishChannel = 'terminology' | 'content' | 'data' | 'merged';

export interface ExportPublishOutcome {
  channel: ExportPublishChannel;
  success: boolean;
  message: string;
  response?: Bundle;
}

/** Explicit copy/publish destination; not the active/effective environment. */
export interface ExportPublishTarget {
  data: EndpointHttpContext;
  terminology: EndpointHttpContext;
  content: EndpointHttpContext;
}

export interface ExportPublishPartition {
  termRes: Resource[];
  contentRes: Resource[];
  dataRes: Resource[];
}

interface PublishLeg {
  channel: Exclude<ExportPublishChannel, 'merged'>;
  ctx: EndpointHttpContext;
  resources: Resource[];
}

@Injectable({
  providedIn: 'root'
})
export class ExportPublishService {
  private readonly http = inject(HttpClient);

  /**
   * Terminology → terminology endpoint; Library → content endpoint; everything else → data.
   * Does not rewrite Library bodies — callers must {@link prepareContentResources} before POST
   * so conditional-create entry lookup by id/url still matches the original Bundle.
   */
  partitionResources(resources: Resource[]): ExportPublishPartition {
    const termRes: Resource[] = [];
    const contentRes: Resource[] = [];
    const dataRes: Resource[] = [];
    for (const r of resources) {
      const rt = resourceTypeOf(r) ?? '';
      if (TERMINOLOGY_TYPES.has(rt)) {
        termRes.push(r);
      } else if (rt === 'Library') {
        contentRes.push(r);
      } else {
        dataRes.push(r);
      }
    }
    return {
      termRes: this.sortTerm(termRes),
      contentRes,
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
    const partition = this.partitionResources(resources);
    this.assertTargetConfigured(target, partition);
    const legs = this.mergeLegsByAddress(this.buildLegs(partition, target));
    if (legs.length === 0) {
      return [
        {
          channel: 'content',
          success: false,
          message: 'No resources to copy.'
        }
      ];
    }

    const outcomes: ExportPublishOutcome[] = [];
    for (const leg of legs) {
      const label =
        leg.channel === 'merged'
          ? `Copying ${leg.resources.length} resources (merged endpoint)…`
          : `Copying ${leg.resources.length} ${leg.channel} resources…`;
      onProgress?.(label);
      const resources =
        leg.channel === 'content' || leg.channel === 'merged'
          ? this.prepareContentResources(leg.resources)
          : leg.resources;
      const bundle = this.toUnconditionalTransaction(resources);
      outcomes.push(await this.postChannel(bundle, leg.channel, leg.ctx));
    }
    return outcomes;
  }

  private async publishPartitionedBundles(
    resources: Resource[],
    fullBundle: Bundle,
    target: ExportPublishTarget,
    onProgress?: (message: string) => void
  ): Promise<ExportPublishOutcome[]> {
    const partition = this.partitionResources(resources);
    this.assertTargetConfigured(target, partition);
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

    const legs = this.mergeLegsByAddress(this.buildLegs(partition, target));
    const outcomes: ExportPublishOutcome[] = [];
    for (const leg of legs) {
      const label =
        leg.channel === 'merged'
          ? 'Copying transaction (merged endpoint)…'
          : `Copying ${leg.channel} transaction…`;
      onProgress?.(label);
      // Look up with pre-normalize keys, then rewrite model-definition bodies on the content leg.
      const entries = pickEntries(leg.resources).map((entry) => {
        if (
          (leg.channel === 'content' || leg.channel === 'merged') &&
          entry.resource &&
          resourceTypeOf(entry.resource) === 'Library' &&
          isModelDefinitionLibrary(entry.resource as Library)
        ) {
          return {
            ...entry,
            resource: normalizeModelDefinitionLibrary(entry.resource as Library)
          };
        }
        return entry;
      });
      const bundle: Bundle = {
        resourceType: 'Bundle',
        type: 'transaction',
        entry: cloneBundleEntriesWithHapiSafeClientIds(entries)
      };
      outcomes.push(await this.postChannel(bundle, leg.channel, leg.ctx));
    }
    return outcomes;
  }

  private prepareContentResources(resources: Resource[]): Resource[] {
    return resources.map((r) => {
      if (resourceTypeOf(r) === 'Library' && isModelDefinitionLibrary(r as Library)) {
        return normalizeModelDefinitionLibrary(r as Library);
      }
      return r;
    });
  }

  private buildLegs(partition: ExportPublishPartition, target: ExportPublishTarget): PublishLeg[] {
    const legs: PublishLeg[] = [];
    if (partition.termRes.length > 0) {
      legs.push({
        channel: 'terminology',
        ctx: target.terminology,
        resources: partition.termRes
      });
    }
    if (partition.contentRes.length > 0) {
      legs.push({
        channel: 'content',
        ctx: target.content,
        resources: partition.contentRes
      });
    }
    if (partition.dataRes.length > 0) {
      legs.push({
        channel: 'data',
        ctx: target.data,
        resources: partition.dataRes
      });
    }
    return legs;
  }

  /**
   * Collapse legs that share the same effective base URL into a single POST
   * (term → content → data order preserved within the merged payload).
   */
  private mergeLegsByAddress(
    legs: PublishLeg[]
  ): Array<{ channel: ExportPublishChannel; ctx: EndpointHttpContext; resources: Resource[] }> {
    const byAddress = new Map<
      string,
      { channel: ExportPublishChannel; ctx: EndpointHttpContext; resources: Resource[]; labels: Set<string> }
    >();
    for (const leg of legs) {
      const key = leg.ctx.address.replace(/\/+$/, '');
      const existing = byAddress.get(key);
      if (!existing) {
        byAddress.set(key, {
          channel: leg.channel,
          ctx: leg.ctx,
          resources: [...leg.resources],
          labels: new Set([leg.channel])
        });
        continue;
      }
      existing.resources.push(...leg.resources);
      existing.labels.add(leg.channel);
      if (existing.labels.size > 1) {
        existing.channel = 'merged';
      }
    }
    return [...byAddress.values()].map(({ channel, ctx, resources }) => ({
      channel,
      ctx,
      resources
    }));
  }

  private assertTargetConfigured(
    target: ExportPublishTarget,
    partition: ExportPublishPartition
  ): void {
    if (partition.termRes.length > 0 && !target.terminology.address.trim()) {
      throw new Error('Target environment has no terminology FHIR endpoint configured.');
    }
    if (partition.contentRes.length > 0 && !target.content.address.trim()) {
      throw new Error('Target environment has no content FHIR endpoint configured.');
    }
    if (partition.dataRes.length > 0 && !target.data.address.trim()) {
      throw new Error('Target environment has no data FHIR endpoint configured.');
    }
    if (
      partition.termRes.length === 0 &&
      partition.contentRes.length === 0 &&
      partition.dataRes.length === 0
    ) {
      return;
    }
    if (
      !target.data.address.trim() &&
      !target.terminology.address.trim() &&
      !target.content.address.trim()
    ) {
      throw new Error(
        'Target environment has no data, terminology, or content FHIR endpoint configured.'
      );
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
    channel: ExportPublishChannel,
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
