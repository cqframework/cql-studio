// Author: Preston Lee

/**
 * Registry package import sends one FHIR R4 `transaction` Bundle per server channel (terminology URL,
 * data URL, or merged when both use the same base) for ordinary resources. Each wrapping entry is
 * `PUT {type}/{id}` when the resource has a logical id, otherwise `POST {type}` (see
 * `collectionBundleToTransaction`). Selected `Bundle.type` `transaction` / `batch` files are POSTed
 * separately to `[base]` afterward so the server executes their entries (they are not nested as
 * stored Bundle instances). Purely numeric logical ids are rewritten before send so HAPI-style
 * servers accept client-assigned ids (HAPI-0960). FHIR R4 processes all POSTs before all PUTs in a
 * transaction; resources that reference others in the same bundle may need ids/`fullUrl` patterns
 * per server behavior (https://www.hl7.org/fhir/R4/http.html#transaction).
 * SearchParameter resources that list only abstract `base` types (e.g. DomainResource) are skipped because
 * HAPI validates those codes and throws HAPI-1684 (see hl7.fhir.r4.core SearchParameter-DomainResource-text.json).
 */

import { decodeUtf8Bytes } from './utf8-encoding.lib';
import { Injectable, inject } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { Bundle, OperationOutcome, Resource, SearchParameter } from 'fhir/r4';
import { FhirPackageImportItemOutcome } from '../models/fhir-package-import.types';
import { IndexedResourceRowVm } from '../models/fhir-package-view.model';
import { resolvePackageArchiveKey } from './fhir-package-archive-path.lib';
import { collectionBundleToTransaction, collectionEntryToTransactionEntry } from './fhir-bundle-transaction.lib';
import {
  cloneBundleEntriesWithHapiSafeClientIds,
  cloneResourcesWithHapiSafeClientIds
} from './fhir-hapi-client-id.lib';
import { resourceTypeOf } from './fhir-resource-type.lib';
import { isResourceType } from './fhir-resource-type.lib';
import { filterImplementationGuide } from './implementation-guide.lib';
import { describeFhirHttpFailure, fhirOutcomeSummary } from './fhir-http-error.lib';
import { TerminologyService } from './terminology.service';
import { FhirClientService } from './fhir-client.service';
import { SettingsService } from './settings.service';

export interface IgImportSanitizeOptions {
  igFilename: string;
  includedEntryKeys: ReadonlySet<string>;
  includedGlobalIndices?: ReadonlySet<number>;
}

const TERM_ORDER: Record<string, number> = {
  CodeSystem: 0,
  NamingSystem: 1,
  ValueSet: 2,
  ConceptMap: 3
};

/** Envelope / response Bundles that are neither stored as instances nor executed (HAPI-0522). */
const BUNDLE_TYPES_NOT_FOR_INSTANCE_STORAGE = new Set<string>([
  'searchset',
  'history',
  'batch-response',
  'transaction-response'
]);

/** Posted to `[base]` so the server processes entries; the wrapper is not stored. */
const EXECUTABLE_BUNDLE_TYPES = new Set<string>(['transaction', 'batch']);

/**
 * Abstract base types in FHIR R4 — not valid `resourceType` for persisted instances (HAPI-1684 / HAPI-2223).
 * Some IGs (e.g. hl7.fhir.r4.core) ship example JSON using these names; servers reject `PUT DomainResource/…`.
 */
const R4_ABSTRACT_RESOURCE_TYPES = new Set<string>(['Resource', 'DomainResource']);

function compareResourceId(a: Resource, b: Resource): number {
  const ida = (a as { id?: string }).id ?? '';
  const idb = (b as { id?: string }).id ?? '';
  return ida.localeCompare(idb);
}

@Injectable({
  providedIn: 'root'
})
export class FhirPackageImportService {
  private readonly terminologyService = inject(TerminologyService);
  private readonly fhirClientService = inject(FhirClientService);
  private readonly settingsService = inject(SettingsService);

  collectResourcesFromFiles(
    selectedRows: IndexedResourceRowVm[],
    files: Map<string, Uint8Array>,
    igSanitize?: IgImportSanitizeOptions
  ): { resources: Resource[]; errors: string[] } {
    const resources: Resource[] = [];
    const errors: string[] = [];

    for (const row of selectedRows) {
      const key = resolvePackageArchiveKey(row.filename, files) ?? row.filename;
      const raw = files.get(key);
      if (!raw) {
        errors.push(`Missing file in archive: ${row.filename}`);
        continue;
      }
      try {
        const text = decodeUtf8Bytes(raw, { fatal: false });
        const obj = JSON.parse(text) as Resource & { resourceType?: string; __filename?: string };
        if (!obj.resourceType) {
          errors.push(`Not a FHIR resource: ${row.filename}`);
          continue;
        }
        obj.__filename = row.filename;
        let resource = obj as Resource;
        if (
          igSanitize &&
          row.filename === igSanitize.igFilename &&
          isResourceType(resource, 'ImplementationGuide')
        ) {
          // Reattach sidecar used by partitionByTargets (defensive after deep-clone filter).
          resource = filterImplementationGuide(
            resource,
            igSanitize.includedEntryKeys,
            igSanitize.includedGlobalIndices
          );
          (resource as Resource & { __filename?: string }).__filename = row.filename;
        }
        resources.push(resource);
      } catch (e) {
        errors.push(`${row.filename}: ${e instanceof Error ? e.message : 'parse error'}`);
      }
    }

    return { resources, errors };
  }

  partitionByTargets(
    resources: Resource[],
    selectedByPath: Map<string, IndexedResourceRowVm>
  ): { termRes: Resource[]; dataRes: Resource[] } {
    const termRes: Resource[] = [];
    const dataRes: Resource[] = [];
    for (const r of resources) {
      const key = (r as unknown as { __filename?: string }).__filename ?? '';
      const row = selectedByPath.get(key);
      if (!row) {
        continue;
      }
      if (row.targetTerminology) {
        termRes.push(r);
      }
      if (row.targetData) {
        dataRes.push(r);
      }
    }
    return { termRes: this.sortTermResources(termRes), dataRes: this.sortDataResources(dataRes) };
  }

  async importTerminologyAndData(
    termRes: Resource[],
    dataRes: Resource[],
    onProgress: (message: string) => void
  ): Promise<FhirPackageImportItemOutcome[]> {
    const outcomes: FhirPackageImportItemOutcome[] = [];
    const tu = this.settingsService.getEffectiveTerminologyEndpointAddress().replace(/\/+$/, '');
    const fu = this.settingsService.getEffectiveDataEndpointAddress().replace(/\/+$/, '');
    const merged = termRes.length > 0 && dataRes.length > 0 && tu === fu;

    if (merged) {
      const combined = [...termRes, ...dataRes];
      await this.postRegistryTransactionForChannel(
        combined,
        (bundle) => this.terminologyService.postBundle(bundle),
        'Merged import',
        outcomes,
        onProgress
      );
    } else {
      if (termRes.length > 0) {
        await this.postRegistryTransactionForChannel(
          termRes,
          (bundle) => this.terminologyService.postBundle(bundle),
          'Terminology',
          outcomes,
          onProgress
        );
      }
      if (dataRes.length > 0) {
        await this.postRegistryTransactionForChannel(
          dataRes,
          (bundle) => this.fhirClientService.postBundle(bundle),
          'FHIR data',
          outcomes,
          onProgress
        );
      }
    }

    return outcomes;
  }

  private sortTermResources(list: Resource[]): Resource[] {
    return [...list].sort((a, b) => {
      const oa = TERM_ORDER[resourceTypeOf(a) ?? ''] ?? 99;
      const ob = TERM_ORDER[resourceTypeOf(b) ?? ''] ?? 99;
      if (oa !== ob) {
        return oa - ob;
      }
      return compareResourceId(a, b);
    });
  }

  private sortDataResources(list: Resource[]): Resource[] {
    return [...list].sort((a, b) => {
      const ta = resourceTypeOf(a) ?? '';
      const tb = resourceTypeOf(b) ?? '';
      if (ta !== tb) {
        return ta.localeCompare(tb);
      }
      return compareResourceId(a, b);
    });
  }

  /**
   * `collection` → `transaction`: `PUT` when `id` is set, else `POST {type}`.
   */
  private buildRegistryTransactionBundle(resources: Resource[]): Bundle {
    const safe = cloneResourcesWithHapiSafeClientIds(resources);
    return collectionBundleToTransaction({
      resourceType: 'Bundle',
      type: 'collection',
      entry: safe.map((resource) => ({ resource }))
    });
  }

  private nonStorableAbstractResourceTypeMessage(resource: Resource): string | null {
    const rt = resourceTypeOf(resource);
    if (typeof rt !== 'string' || !R4_ABSTRACT_RESOURCE_TYPES.has(rt)) {
      return null;
    }
    return `Skipped — "${rt}" is an abstract FHIR R4 type, not a storable resource (not sent to the server).`;
  }

  private nonStorableImportedBundleMessage(resource: Resource): string | null {
    if (resourceTypeOf(resource) !== 'Bundle') {
      return null;
    }
    const t = (resource as Bundle).type;
    if (typeof t !== 'string' || !BUNDLE_TYPES_NOT_FOR_INSTANCE_STORAGE.has(t)) {
      return null;
    }
    return `Skipped — Bundle.type "${t}" is not stored as a server resource (not sent to the server).`;
  }

  private isExecutableImportedBundle(resource: Resource): boolean {
    if (resourceTypeOf(resource) !== 'Bundle') {
      return false;
    }
    const t = (resource as Bundle).type;
    return typeof t === 'string' && EXECUTABLE_BUNDLE_TYPES.has(t);
  }

  private resourceFilename(resource: Resource): string {
    return (resource as { __filename?: string }).__filename?.trim() ?? '';
  }

  private dedupeResourcesByFilename(resources: Resource[]): Resource[] {
    const seen = new Set<string>();
    const out: Resource[] = [];
    for (const resource of resources) {
      const fn = this.resourceFilename(resource);
      const key = fn || `__anon_${out.length}`;
      if (fn && seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(resource);
    }
    return out;
  }

  private prepareExecutableBundle(bundle: Bundle): Bundle {
    const clonedEntries = cloneBundleEntriesWithHapiSafeClientIds(bundle.entry ?? []);
    const entry = clonedEntries.map((e) => collectionEntryToTransactionEntry(e));
    const type = bundle.type === 'batch' ? 'batch' : 'transaction';
    const rest = { ...bundle } as Bundle & { __filename?: string };
    delete rest.__filename;
    return { ...rest, type, entry };
  }

  /**
   * SearchParameter.base may list abstract types (Resource, DomainResource). HAPI resolves each code via
   * FhirContext.getResourceDefinition and fails with HAPI-1684 for abstract names even when the root
   * resource type is SearchParameter.
   */
  private nonStorableSearchParameterAbstractBaseMessage(resource: Resource): string | null {
    if (resourceTypeOf(resource) !== 'SearchParameter') {
      return null;
    }
    const bases = (resource as SearchParameter).base;
    if (!Array.isArray(bases) || bases.length === 0) {
      return null;
    }
    const abstractBases = bases.filter(
      (b): b is SearchParameter['base'][number] =>
        typeof b === 'string' && R4_ABSTRACT_RESOURCE_TYPES.has(b)
    );
    if (abstractBases.length === 0) {
      return null;
    }
    const uniq = [...new Set(abstractBases)];
    return `Skipped — SearchParameter.base includes abstract type(s) (${uniq.join(', ')}) that HAPI cannot persist (HAPI-1684); not sent.`;
  }

  /**
   * Wrapping transaction for instance resources, then each executable Bundle POSTed to `[base]`.
   * Wrapping HTTP errors apply to every instance row; executable Bundles are posted independently.
   */
  private async postRegistryTransactionForChannel(
    resources: Resource[],
    post: (b: Bundle) => Observable<Bundle>,
    channelLabel: string,
    outcomes: FhirPackageImportItemOutcome[],
    onProgress: (message: string) => void
  ): Promise<void> {
    if (resources.length === 0) {
      return;
    }

    const instanceResources: Resource[] = [];
    const executableBundles: Bundle[] = [];
    for (const resource of this.dedupeResourcesByFilename(resources)) {
      const abstractSkip = this.nonStorableAbstractResourceTypeMessage(resource);
      if (abstractSkip) {
        const fields = this.resourceImportFields(resource);
        outcomes.push({
          channel: channelLabel,
          ...fields,
          ok: true,
          message: abstractSkip
        });
        continue;
      }
      const spAbstractSkip = this.nonStorableSearchParameterAbstractBaseMessage(resource);
      if (spAbstractSkip) {
        const fields = this.resourceImportFields(resource);
        outcomes.push({
          channel: channelLabel,
          ...fields,
          ok: true,
          message: spAbstractSkip
        });
        continue;
      }
      const bundleSkip = this.nonStorableImportedBundleMessage(resource);
      if (bundleSkip) {
        const fields = this.resourceImportFields(resource);
        outcomes.push({
          channel: channelLabel,
          ...fields,
          ok: true,
          message: bundleSkip
        });
        continue;
      }
      if (this.isExecutableImportedBundle(resource)) {
        executableBundles.push(resource as Bundle);
        continue;
      }
      instanceResources.push(resource);
    }

    if (instanceResources.length > 0) {
      await this.postWrappingTransaction(instanceResources, post, channelLabel, outcomes, onProgress);
    }
    for (const bundle of executableBundles) {
      await this.postExecutableBundle(bundle, post, channelLabel, outcomes, onProgress);
    }
  }

  private async postWrappingTransaction(
    instanceResources: Resource[],
    post: (b: Bundle) => Observable<Bundle>,
    channelLabel: string,
    outcomes: FhirPackageImportItemOutcome[],
    onProgress: (message: string) => void
  ): Promise<void> {
    const bundle = this.buildRegistryTransactionBundle(instanceResources);
    onProgress(`${channelLabel}: posting ${instanceResources.length} resources in one transaction`);
    try {
      const response = await firstValueFrom(post(bundle));
      const responseEntries = response.entry ?? [];
      for (let i = 0; i < instanceResources.length; i++) {
        const resource = instanceResources[i];
        const fields = this.resourceImportFields(resource);
        const ent = responseEntries[i];
        if (ent == null) {
          outcomes.push({
            channel: channelLabel,
            ...fields,
            ok: false,
            message: 'Missing transaction-response entry for this resource'
          });
          continue;
        }
        const status = this.bundleEntryStatusString(ent.response?.status);
        if (status !== '' && !/^2/.test(status)) {
          const oc = ent.response?.outcome as OperationOutcome | undefined;
          outcomes.push({
            channel: channelLabel,
            ...fields,
            ok: false,
            message: `${status}${fhirOutcomeSummary(oc)}`.trim()
          });
        } else {
          outcomes.push({
            channel: channelLabel,
            ...fields,
            ok: true,
            message: status || 'OK'
          });
        }
      }
    } catch (e) {
      const msg = this.describeFailure(e);
      for (const resource of instanceResources) {
        const fields = this.resourceImportFields(resource);
        outcomes.push({
          channel: channelLabel,
          ...fields,
          ok: false,
          message: msg
        });
      }
    }
  }

  private async postExecutableBundle(
    source: Bundle,
    post: (b: Bundle) => Observable<Bundle>,
    channelLabel: string,
    outcomes: FhirPackageImportItemOutcome[],
    onProgress: (message: string) => void
  ): Promise<void> {
    const fields = this.resourceImportFields(source);
    const entries = source.entry ?? [];
    if (entries.length === 0) {
      outcomes.push({
        channel: channelLabel,
        ...fields,
        ok: true,
        message: `Skipped — Bundle.type "${source.type ?? ''}" has no entries (not sent to the server).`
      });
      return;
    }

    const payload = this.prepareExecutableBundle(source);
    const kind = payload.type === 'batch' ? 'batch' : 'transaction';
    onProgress(`${channelLabel}: posting ${kind} Bundle (${entries.length} entries)`);
    try {
      const response = await firstValueFrom(post(payload));
      outcomes.push({
        channel: channelLabel,
        ...fields,
        ...this.executableBundleOutcome(kind, entries.length, response)
      });
    } catch (e) {
      outcomes.push({
        channel: channelLabel,
        ...fields,
        ok: false,
        message: this.describeFailure(e)
      });
    }
  }

  private executableBundleOutcome(
    kind: 'transaction' | 'batch',
    entryCount: number,
    response: Bundle
  ): { ok: boolean; message: string } {
    const responseEntries = response.entry ?? [];
    const statuses = responseEntries.map((ent) => this.bundleEntryStatusString(ent.response?.status));
    const failed = statuses.filter((s) => s !== '' && !/^2/.test(s));
    const lines = statuses.filter((s) => s !== '');
    const prefix = `Posted ${kind} (${entryCount} entries)`;
    const message = lines.length > 0 ? `${prefix}:\n${lines.join('\n')}` : `${prefix}: OK`;
    return {
      ok: failed.length === 0,
      message
    };
  }

  private resourceImportFields(resource: Resource): {
    resourceType: string;
    resourceId: string;
    filename: string;
    canonicalUrl: string | null;
    displayName: string | null;
  } {
    const fn = (resource as { __filename?: string }).__filename?.trim() ?? '';
    const id = typeof (resource as { id?: string }).id === 'string' ? (resource as { id: string }).id.trim() : '';
    const withMeta = resource as Resource & {
      url?: string;
      name?: string | { text?: string };
      title?: string;
    };
    const url = typeof withMeta.url === 'string' ? withMeta.url.trim() : '';
    const fromName =
      typeof withMeta.name === 'string'
        ? withMeta.name
        : withMeta.name && typeof withMeta.name === 'object'
          ? withMeta.name.text
          : undefined;
    const displayRaw = fromName || withMeta.title || id || '';
    const displayName = typeof displayRaw === 'string' ? displayRaw.trim() : '';
    return {
      resourceType: resourceTypeOf(resource) ?? '(missing resourceType)',
      resourceId: id || '—',
      filename: fn || '—',
      canonicalUrl: url || null,
      displayName: displayName || null
    };
  }

  /** FHIR says `response.status` is a string; some stacks send numbers or omit it. */
  private bundleEntryStatusString(raw: unknown): string {
    if (raw == null) {
      return '';
    }
    if (typeof raw === 'string') {
      return raw.trim();
    }
    if (typeof raw === 'number') {
      return String(raw);
    }
    return '';
  }

  private describeFailure(e: unknown): string {
    return describeFhirHttpFailure(e);
  }
}
