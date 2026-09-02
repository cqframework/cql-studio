// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Bundle, ImplementationGuide, Patient, Resource } from 'fhir/r4';
import { PatientService } from './patient.service';
import { MeasureService } from './measure.service';
import { FhirSearchService } from './fhir-search.service';
import { FhirCapabilityService } from './fhir-capability.service';
import { SettingsService } from './settings.service';
import { SqlOnFhirExecutionDataService } from './sql-on-fhir/sql-on-fhir-execution-data.service';
import {
  ExportDataTab,
  PatientExpansionOptions,
  toExportDataSelection
} from './export-data-resource.lib';
import {
  exportDataResourceKey,
  filterImplementationGuide,
  parseImplementationGuideEntries
} from './implementation-guide.lib';
import { endpointOrderForResourceType, FhirEndpointRole, guessResourceTypeFromCanonicalUrl } from './fhir-resource-endpoint.lib';
import { buildHttpHeaders } from './endpoint-config.lib';
import { resourceTypeOf, isResourceType } from './fhir-resource-type.lib';

export interface ExportDataSearchResult {
  resources: Resource[];
  total: number;
  page: number;
  pageSize: number;
  error?: string;
}

export interface IgReferenceResolutionResult {
  resolved: ReturnType<typeof toExportDataSelection>[];
  failures: { reference: string; message: string }[];
  sanitizedIg?: ImplementationGuide;
}

const EXCLUDED_OTHER_TYPES = new Set([
  'Library',
  'ValueSet',
  'CodeSystem',
  'ConceptMap',
  'NamingSystem',
  'ImplementationGuide'
]);

@Injectable({ providedIn: 'root' })
export class ExportDataSearchService {
  private readonly http = inject(HttpClient);
  private readonly patientService = inject(PatientService);
  private readonly measureService = inject(MeasureService);
  private readonly searchService = inject(FhirSearchService);
  private readonly capabilityService = inject(FhirCapabilityService);
  private readonly settingsService = inject(SettingsService);
  private readonly executionDataService = inject(SqlOnFhirExecutionDataService);

  async searchTab(
    tab: ExportDataTab,
    params: Record<string, string>,
    page = 1,
    pageSize = 20
  ): Promise<ExportDataSearchResult> {
    try {
      switch (tab) {
        case 'Patient':
          return this.searchPatients(params['name'] ?? '', page, pageSize);
        case 'Measure':
          return this.searchMeasures(params['name'] ?? '', page, pageSize);
        case 'MeasureReport':
          return this.searchMeasureReports(params, page, pageSize);
        case 'Condition':
          return this.searchResourceType('Condition', params, page, pageSize);
        case 'Observation':
          return this.searchResourceType('Observation', params, page, pageSize);
        case 'ImplementationGuide':
          return this.searchImplementationGuides(params, page, pageSize);
        case 'Other':
          return this.searchOther(params['resourceType'] ?? '', params['query'] ?? '', page, pageSize);
        default:
          return { resources: [], total: 0, page, pageSize, error: 'Unknown tab' };
      }
    } catch (err) {
      return {
        resources: [],
        total: 0,
        page,
        pageSize,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }

  async expandPatients(
    patients: Patient[],
    options: PatientExpansionOptions
  ): Promise<ReturnType<typeof toExportDataSelection>[]> {
    if (!options.enabled || patients.length === 0) {
      return [];
    }
    const bundle = await this.executionDataService.buildBundleFromPatients(patients, {
      resourceTypes: options.resourceTypes
    });
    const out: ReturnType<typeof toExportDataSelection>[] = [];
    const patientIds = new Set(patients.map((p) => p.id).filter(Boolean));
    for (const entry of bundle.entry ?? []) {
      const r = entry.resource;
      if (!r) {
        continue;
      }
      if (resourceTypeOf(r) === 'Patient' && patientIds.has((r as Patient).id)) {
        continue;
      }
      const subjectId =
        resourceTypeOf(r) === 'Patient'
          ? (r as Patient).id
          : ((r as { subject?: { reference?: string } }).subject?.reference?.match(/Patient\/(.+)/)?.[1] ??
            'unknown');
      out.push(
        toExportDataSelection(r, 'patient-expansion', `from Patient/${subjectId}`)
      );
    }
    return out;
  }

  async resolveIgReferences(
    ig: ImplementationGuide,
    selectedEntryKeys: ReadonlySet<string>,
    sanitize: boolean,
    selectedGlobalIndices: ReadonlySet<number>
  ): Promise<IgReferenceResolutionResult> {
    const entries = parseImplementationGuideEntries(ig);
    const resolved: ReturnType<typeof toExportDataSelection>[] = [];
    const failures: { reference: string; message: string }[] = [];
    const igKey = exportDataResourceKey(ig);

    for (const entry of entries) {
      if (!selectedEntryKeys.has(entry.key)) {
        continue;
      }
      try {
        const resource = await this.resolveReference(entry.reference);
        if (resource) {
          resolved.push(toExportDataSelection(resource, 'ig-resolution', entry.name, igKey));
        } else {
          failures.push({ reference: entry.reference, message: 'Not found on configured endpoints' });
        }
      } catch (err) {
        failures.push({
          reference: entry.reference,
          message: err instanceof Error ? err.message : String(err)
        });
      }
    }

    for (let i = 0; i < (ig.global ?? []).length; i++) {
      if (!selectedGlobalIndices.has(i)) {
        continue;
      }
      const profile = ig.global![i].profile?.trim();
      if (!profile) {
        continue;
      }
      try {
        const pipe = profile.indexOf('|');
        const url = pipe >= 0 ? profile.slice(0, pipe) : profile;
        const version = pipe >= 0 ? profile.slice(pipe + 1).trim() : undefined;
        const resource = await this.resolveCanonical('StructureDefinition', url, version);
        if (resource) {
          resolved.push(toExportDataSelection(resource, 'ig-resolution', profile, igKey));
        }
      } catch (err) {
        failures.push({
          reference: profile,
          message: err instanceof Error ? err.message : String(err)
        });
      }
    }

    let sanitizedIg: ImplementationGuide | undefined;
    if (sanitize) {
      sanitizedIg = filterImplementationGuide(ig, selectedEntryKeys, selectedGlobalIndices);
    }

    return { resolved, failures, sanitizedIg };
  }

  otherResourceTypes(): string[] {
    return this.capabilityService
      .resourceTypes()
      .filter((t) => !EXCLUDED_OTHER_TYPES.has(t))
      .sort();
  }

  private async searchPatients(
    term: string,
    page: number,
    pageSize: number
  ): Promise<ExportDataSearchResult> {
    const bundle = await firstValueFrom(this.patientService.search(term.trim(), page, pageSize));
    const resources = (bundle.entry ?? [])
      .map((e) => e.resource)
      .filter((r): r is Patient => isResourceType(r, 'Patient'));
    return {
      resources,
      total: bundle.total ?? resources.length,
      page,
      pageSize
    };
  }

  private async searchMeasures(
    term: string,
    page: number,
    pageSize: number
  ): Promise<ExportDataSearchResult> {
    const bundle = await firstValueFrom(
      this.measureService.searchMeasures({
        name: term.trim() || undefined,
        title: term.trim() || undefined,
        _count: pageSize,
        _offset: (page - 1) * pageSize
      })
    );
    const resources = (bundle.entry ?? [])
      .map((e) => e.resource)
      .filter((r): r is Resource => !!r);
    return {
      resources,
      total: bundle.total ?? resources.length,
      page,
      pageSize
    };
  }

  private async searchMeasureReports(
    params: Record<string, string>,
    page: number,
    pageSize: number
  ): Promise<ExportDataSearchResult> {
    const bundle = await firstValueFrom(
      this.measureService.searchMeasureReports({
        measure: params['measure']?.trim() || undefined,
        subject: params['subject']?.trim() || undefined,
        status: params['status']?.trim() || undefined,
        _count: pageSize,
        _offset: (page - 1) * pageSize
      })
    );
    const resources = (bundle.entry ?? [])
      .map((e) => e.resource)
      .filter((r): r is Resource => !!r);
    return {
      resources,
      total: bundle.total ?? resources.length,
      page,
      pageSize
    };
  }

  private async searchResourceType(
    resourceType: string,
    params: Record<string, string>,
    page: number,
    pageSize: number
  ): Promise<ExportDataSearchResult> {
    const query: Record<string, string> = {};
    if (params['patient']?.trim()) {
      query['patient'] = params['patient'].trim();
    }
    if (params['code']?.trim()) {
      query['code'] = params['code'].trim();
    }
    if (params['category']?.trim()) {
      query['category'] = params['category'].trim();
    }
    if (params['text']?.trim()) {
      query['code:text'] = params['text'].trim();
    }
    const bundle = await firstValueFrom(
      this.searchService.search(resourceType, query, {
        count: pageSize,
        offset: (page - 1) * pageSize
      })
    );
    const resources = (bundle.entry ?? [])
      .map((e) => e.resource)
      .filter((r): r is Resource => !!r);
    return {
      resources,
      total: bundle.total ?? resources.length,
      page,
      pageSize
    };
  }

  private async searchImplementationGuides(
    params: Record<string, string>,
    page: number,
    pageSize: number
  ): Promise<ExportDataSearchResult> {
    const query: Record<string, string> = {};
    const term = params['query']?.trim();
    if (term) {
      query['name'] = term;
      query['title'] = term;
    }
    if (params['url']?.trim()) {
      query['url'] = params['url'].trim();
    }
    if (params['packageId']?.trim()) {
      query['package-id'] = params['packageId'].trim();
    }

    let bundle = await this.searchOnRole('data', 'ImplementationGuide', query, page, pageSize);
    if (!bundle.entry?.length) {
      bundle = await this.searchOnRole('terminology', 'ImplementationGuide', query, page, pageSize);
    }
    const resources = (bundle.entry ?? [])
      .map((e) => e.resource)
      .filter((r): r is ImplementationGuide => isResourceType(r, 'ImplementationGuide'));
    return {
      resources,
      total: bundle.total ?? resources.length,
      page,
      pageSize
    };
  }

  private async searchOther(
    resourceType: string,
    queryText: string,
    page: number,
    pageSize: number
  ): Promise<ExportDataSearchResult> {
    if (!resourceType) {
      return { resources: [], total: 0, page, pageSize, error: 'Select a resource type' };
    }
    const params: Record<string, string> = {};
    if (queryText.trim()) {
      const searchParams = this.capabilityService.getSearchParamsForType(resourceType);
      const contentParam = searchParams.find((p) => p.name === '_content');
      if (contentParam) {
        params['_content'] = queryText.trim();
      } else {
        const firstString = searchParams.find((p) => (p.type ?? 'string') === 'string');
        if (firstString?.name) {
          params[firstString.name] = queryText.trim();
        }
      }
    }
    const roles = endpointOrderForResourceType(resourceType);
    let lastBundle: Bundle = { resourceType: 'Bundle', type: 'searchset' };
    for (const role of roles) {
      lastBundle = await this.searchOnRole(role, resourceType, params, page, pageSize);
      if ((lastBundle.entry ?? []).length > 0) {
        break;
      }
    }
    const resources = (lastBundle.entry ?? [])
      .map((e) => e.resource)
      .filter((r): r is Resource => !!r);
    return {
      resources,
      total: lastBundle.total ?? resources.length,
      page,
      pageSize
    };
  }

  private paginate<T>(all: T[], page: number, pageSize: number, total?: number): ExportDataSearchResult {
    const start = (page - 1) * pageSize;
    const slice = all.slice(start, start + pageSize);
    return {
      resources: slice as Resource[],
      total: total ?? all.length,
      page,
      pageSize
    };
  }

  private async searchOnRole(
    role: FhirEndpointRole,
    resourceType: string,
    params: Record<string, string>,
    page: number,
    pageSize: number
  ): Promise<Bundle> {
    const base = this.baseUrlForRole(role);
    if (!base) {
      return { resourceType: 'Bundle', type: 'searchset' };
    }
    const queryParams = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v?.trim()) {
        queryParams.set(k, v.trim());
      }
    }
    queryParams.set('_count', String(pageSize));
    queryParams.set('_offset', String((page - 1) * pageSize));
    const url = `${base.replace(/\/+$/, '')}/${resourceType}?${queryParams.toString()}`;
    return firstValueFrom(
      this.http.get<Bundle>(url, { headers: this.headersForRole(role) })
    );
  }

  private async resolveReference(reference: string): Promise<Resource | null> {
    const ref = reference.trim();
    if (!ref) {
      return null;
    }
    if (ref.startsWith('http://') || ref.startsWith('https://') || ref.startsWith('urn:')) {
      const pipe = ref.indexOf('|');
      const url = pipe >= 0 ? ref.slice(0, pipe) : ref;
      const version = pipe >= 0 ? ref.slice(pipe + 1).trim() : undefined;
      const typeGuess = guessResourceTypeFromCanonicalUrl(url);
      if (typeGuess) {
        return this.resolveCanonical(typeGuess, url, version);
      }
      return null;
    }
    const slash = ref.indexOf('/');
    if (slash <= 0) {
      return null;
    }
    const type = ref.slice(0, slash);
    const id = ref.slice(slash + 1);
    const roles = endpointOrderForResourceType(type);
    for (const role of roles) {
      const base = this.baseUrlForRole(role);
      if (!base) {
        continue;
      }
      try {
        const url = `${base.replace(/\/+$/, '')}/${type}/${encodeURIComponent(id)}`;
        const resource = await firstValueFrom(
          this.http.get<Resource>(url, { headers: this.headersForRole(role) })
        );
        if (resource?.resourceType) {
          return resource;
        }
      } catch {
        // try next endpoint
      }
    }
    return null;
  }

  private async resolveCanonical(
    resourceType: string,
    canonicalUrl: string,
    version?: string
  ): Promise<Resource | null> {
    const roles = endpointOrderForResourceType(resourceType);
    for (const role of roles) {
      const base = this.baseUrlForRole(role);
      if (!base) {
        continue;
      }
      try {
        const params = new URLSearchParams();
        params.set('url', canonicalUrl);
        if (version?.trim()) {
          params.set('version', version.trim());
        }
        const url = `${base.replace(/\/+$/, '')}/${resourceType}?${params.toString()}`;
        const bundle = await firstValueFrom(
          this.http.get<Bundle>(url, { headers: this.headersForRole(role) })
        );
        const resource = bundle.entry?.[0]?.resource;
        if (resource) {
          return resource;
        }
      } catch {
        // try next
      }
    }
    return null;
  }

  private baseUrlForRole(role: FhirEndpointRole): string {
    switch (role) {
      case 'evaluation':
        return this.settingsService.getEffectiveEvaluationServerUrl();
      case 'terminology':
        return this.settingsService.getEffectiveTerminologyEndpointAddress();
      case 'content':
        return this.settingsService.getEffectiveContentEndpointAddress();
      default:
        return this.settingsService.getEffectiveDataEndpointAddress();
    }
  }

  private headersForRole(role: FhirEndpointRole) {
    const ctx = this.settingsService.getEndpointHttpContext(role, {
      Accept: 'application/fhir+json'
    });
    const env = this.settingsService.getActiveEnvironment();
    const config =
      role === 'evaluation'
        ? env.evaluationServer
        : role === 'terminology'
          ? env.terminologyEndpoint
          : role === 'content'
            ? env.contentEndpoint
            : env.dataEndpoint;
    return buildHttpHeaders({ ...config, address: ctx.address }, ctx.headers);
  }
}
