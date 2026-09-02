// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { firstValueFrom, forkJoin } from 'rxjs';
import type { Bundle, Patient, Resource, ValueSet } from 'fhir/r4';
import { PatientService } from '../patient.service';
import { FhirSearchService } from '../fhir-search.service';
import { FhirClientService } from '../fhir-client.service';
import { SettingsService } from '../settings.service';
import { buildHttpHeaders } from '../endpoint-config.lib';
import { fetchAllBundlePages } from '../fhir-bundle-fetch.lib';
import { loadValueSetExpansions } from '../../components/sql-on-fhir/elm-to-sql';
import type { FlatRow } from './sql-on-fhir-bundle-flattener.lib';
import { flattenValueSets } from './sql-on-fhir-bundle-flattener.lib';
import {
  mergeBundles,
  prepareValueSetRowsForExecution,
} from './sql-on-fhir-execution-data.lib';
import { valueSetForServerPut } from './sql-on-fhir-value-set-publish.lib';
import {
  buildTransactionBundleForServerPublish,
  resourcesFromExecutionBundle,
} from './sql-on-fhir-bundle-publish.lib';
import {
  isEverythingOperationFailure,
  mapWithConcurrency,
  nonPatientResourceTypes,
  PATIENT_COMPARTMENT_FETCH_CONCURRENCY,
  PATIENT_COMPARTMENT_SEARCH_PAGE_SIZE,
  patientReference,
} from './sql-on-fhir-patient-fetch.lib';

export type { ExecutionSeedData } from './sql-on-fhir-execution-data.types';
export {
  bundleHasClinicalResources,
  mergeBundles,
  resourceTypesInBundle,
  summarizeBundleResources,
  validateCms125DemoBundle,
} from './sql-on-fhir-execution-data.lib';
export type { BundleResourceSummary } from './sql-on-fhir-execution-data.lib';

export interface BuildBundleFromPatientsOptions {
  resourceTypes: string[];
}

@Injectable({ providedIn: 'root' })
export class SqlOnFhirExecutionDataService {
  private readonly http = inject(HttpClient);
  private readonly patientService = inject(PatientService);
  private readonly fhirSearch = inject(FhirSearchService);
  private readonly fhirClient = inject(FhirClientService);
  private readonly settingsService = inject(SettingsService);

  async buildBundleFromPatients(
    patients: Patient[],
    options: BuildBundleFromPatientsOptions,
  ): Promise<Bundle> {
    const withIds = patients.filter(p => p.id?.trim());
    if (withIds.length === 0) {
      return { resourceType: 'Bundle', type: 'collection', entry: [] };
    }
    const resourceTypes = [...new Set(options.resourceTypes.filter(t => t.trim()))].sort();
    const nonPatientTypes = nonPatientResourceTypes(resourceTypes);
    const bundles = await mapWithConcurrency(
      withIds,
      PATIENT_COMPARTMENT_FETCH_CONCURRENCY,
      p => this.fetchPatientCompartment(p.id!, resourceTypes, nonPatientTypes),
    );
    return mergeBundles(bundles);
  }

  buildDataKeyFromPatients(patients: Patient[], resourceTypes: string[] = []): string {
    const ids = patients.map(p => p.id).filter(Boolean).sort();
    const types = [...new Set(resourceTypes.filter(t => t.trim()))].sort();
    if (ids.length === 0) {
      return 'patients:none';
    }
    return types.length
      ? `patients:${ids.join(',')}|types:${types.join(',')}`
      : `patients:${ids.join(',')}`;
  }

  buildDataKeyFromBundle(bundle: Bundle): string {
    const ids = (bundle.entry ?? [])
      .map(e => e.resource)
      .filter((r): r is Resource & { id: string } => !!r?.id && !!r.resourceType)
      .map(r => `${r.resourceType}/${r.id}`)
      .sort();
    return ids.length ? `bundle:${ids.join(',')}` : 'bundle:empty';
  }

  async prepareValueSetRows(
    elmJson: string,
    bundledValueSets: ValueSet[] = [],
  ): Promise<{ rows: FlatRow[]; errors: string[] }> {
    const baseUrl = this.getTerminologyBaseUrl();
    const result = await prepareValueSetRowsForExecution(
      elmJson,
      bundledValueSets,
      refs => loadValueSetExpansions(baseUrl, refs, this.buildAuthenticatedFetch()),
    );
    return { rows: result.rows, errors: result.errors };
  }

  valueSetRowsFromBundled(valueSets: ValueSet[]): FlatRow[] {
    return flattenValueSets(valueSets);
  }

  /** Upsert compose-defined ValueSets onto the configured FHIR/terminology server (client-assigned ids). */
  async publishValueSetsToServer(valueSets: ValueSet[]): Promise<void> {
    const baseUrl = this.getTerminologyBaseUrl();
    if (!baseUrl) {
      throw new Error('FHIR base URL is not configured');
    }
    if (valueSets.length === 0) {
      return;
    }
    await firstValueFrom(
      forkJoin(valueSets.map(vs => this.http.put<ValueSet>(
        `${baseUrl}/ValueSet/${encodeURIComponent(vs.id!)}`,
        valueSetForServerPut(vs),
        { headers: this.terminologyHeaders() },
      ))),
    );
  }

  /** Import collection-bundle resources onto the configured FHIR server via one transaction. */
  async publishBundleToServer(bundle: Bundle): Promise<void> {
    if (!this.fhirClient.getBaseUrl()) {
      throw new Error('FHIR base URL is not configured');
    }
    const resources = resourcesFromExecutionBundle(bundle);
    if (resources.length === 0) {
      throw new Error('Bundle has no resources with logical ids to import');
    }
    const transaction = buildTransactionBundleForServerPublish(resources);
    await firstValueFrom(this.fhirClient.postBundle(transaction));
  }

  private async fetchPatientCompartment(
    patientId: string,
    resourceTypes: string[],
    nonPatientTypes: string[],
  ): Promise<Bundle> {
    const patient = await firstValueFrom(this.patientService.get(patientId));
    const bundles: Bundle[] = [
      {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [{ resource: patient }],
      },
    ];
    if (nonPatientTypes.length === 0) {
      return mergeBundles(bundles);
    }
    try {
      const everything = await firstValueFrom(
        this.patientService.getEverything(patientId, { types: nonPatientTypes }),
      );
      bundles.push(everything);
      return mergeBundles(bundles);
    } catch (err: unknown) {
      if (!isEverythingOperationFailure(err)) {
        throw err;
      }
      return this.fetchPatientCompartmentViaSearch(patientId, resourceTypes, patient);
    }
  }

  private async fetchPatientCompartmentViaSearch(
    patientId: string,
    resourceTypes: string[],
    patient: Patient,
  ): Promise<Bundle> {
    const bundles: Bundle[] = [
      {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [{ resource: patient }],
      },
    ];
    const ref = patientReference(patientId);
    const typesToSearch = nonPatientResourceTypes(resourceTypes);
    for (const resourceType of typesToSearch) {
      const initial = await firstValueFrom(
        this.fhirSearch.search(
          resourceType,
          { patient: ref },
          { count: PATIENT_COMPARTMENT_SEARCH_PAGE_SIZE },
        ),
      );
      const full = await fetchAllBundlePages(initial, url =>
        firstValueFrom(this.fhirSearch.fetchFromUrl(url)),
      );
      bundles.push(full);
    }
    return mergeBundles(bundles);
  }

  private terminologyHeaders(): HttpHeaders {
    const ctx = this.settingsService.getEndpointHttpContext('terminology', {
      'Content-Type': 'application/fhir+json',
      Accept: 'application/fhir+json'
    });
    return buildHttpHeaders(
      { ...this.settingsService.getActiveEnvironment().terminologyEndpoint, address: ctx.address },
      ctx.headers
    );
  }

  private buildAuthenticatedFetch(): typeof fetch {
    const headers = this.terminologyHeaders();
    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method?.toUpperCase() ?? 'GET';
      if (method !== 'GET') {
        throw new Error(`Unsupported fetch method for ValueSet load: ${method}`);
      }
      try {
        const response = await firstValueFrom(
          this.http.get<unknown>(url, { headers, observe: 'response' }),
        );
        return new Response(JSON.stringify(response.body ?? null), {
          status: response.status,
          statusText: response.statusText,
          headers: { 'Content-Type': 'application/fhir+json' },
        });
      } catch (err: unknown) {
        if (err instanceof HttpErrorResponse) {
          const body = err.error != null ? JSON.stringify(err.error) : '';
          return new Response(body, { status: err.status, statusText: err.statusText });
        }
        throw err;
      }
    };
  }

  private getTerminologyBaseUrl(): string {
    const term = this.settingsService.getEffectiveTerminologyEndpointAddress().trim().replace(/\/+$/, '');
    if (term) {
      return term;
    }
    return this.settingsService.getEffectiveDataEndpointAddress().trim().replace(/\/+$/, '');
  }
}
