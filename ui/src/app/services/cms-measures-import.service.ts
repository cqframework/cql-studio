// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Bundle, OperationOutcome, Resource } from 'fhir/r4';
import { SettingsService } from './settings.service';
import { buildHttpHeaders } from './endpoint-config.lib';
import { cloneResourcesWithHapiSafeClientIds } from './fhir-hapi-client-id.lib';
import {
  collectionBundleToTransaction,
  normalizeBundleForBasePost,
} from './fhir-bundle-transaction.lib';
import { normalizeFhirBaseUrlForBundlePost } from './fhir-server-base.lib';
import { describeFhirHttpFailure, fhirOutcomeSummary } from './fhir-http-error.lib';
import { resourceTypeOf } from './fhir-resource-type.lib';

export interface CmsImportOutcome {
  resourceType: string;
  id: string;
  label: string;
  ok: boolean;
  message: string;
}

@Injectable({
  providedIn: 'root',
})
export class CmsMeasuresImportService {
  private readonly http = inject(HttpClient);
  private readonly settingsService = inject(SettingsService);

  evaluationServerConfigured(): boolean {
    return this.settingsService.getEffectiveEvaluationServerUrl().trim() !== '';
  }

  /**
   * PUT the resources in one transaction against the configured evaluation FHIR server.
   * `resources` must already be ordered dependencies-first.
   */
  async importResources(resources: Resource[]): Promise<CmsImportOutcome[]> {
    return this.importResourcesTo('evaluation', resources);
  }

  /**
   * PUT to the evaluation server, and to the content server when that address is different.
   * The IDE resolves ModelInfo and library includes on content first.
   */
  async importToEvaluationAndContent(
    resources: Resource[],
    onTarget?: (target: 'evaluation server' | 'content server') => void
  ): Promise<CmsImportOutcome[]> {
    onTarget?.('evaluation server');
    const evaluation = await this.importResources(resources);
    if (!this.contentAddressDiffers()) {
      return evaluation;
    }
    onTarget?.('content server');
    const content = await this.importResourcesTo('content', resources);
    return [
      ...evaluation,
      ...content.map((outcome) => ({ ...outcome, label: `${outcome.label} (content)` })),
    ];
  }

  async importResourcesTo(
    role: 'evaluation' | 'content',
    resources: Resource[]
  ): Promise<CmsImportOutcome[]> {
    const address =
      role === 'evaluation'
        ? this.settingsService.getEffectiveEvaluationServerUrl()
        : this.settingsService.getEffectiveContentEndpointAddress();
    const baseUrl = normalizeFhirBaseUrlForBundlePost(address);
    if (!baseUrl) {
      throw new Error(
        role === 'evaluation'
          ? 'Configure the evaluation FHIR server URL before importing.'
          : 'Configure the content FHIR server URL before importing.'
      );
    }
    if (resources.length === 0) {
      return [];
    }
    const posted = cloneResourcesWithHapiSafeClientIds(resources);
    const bundle = normalizeBundleForBasePost(
      collectionBundleToTransaction({
        resourceType: 'Bundle',
        type: 'collection',
        entry: posted.map((resource) => ({ resource })),
      })
    );
    const env = this.settingsService.getActiveEnvironment();
    const endpoint = role === 'evaluation' ? env.evaluationServer : env.contentEndpoint;
    const ctx = this.settingsService.getEndpointHttpContext(role, {
      'Content-Type': 'application/fhir+json',
      Accept: 'application/fhir+json',
    });
    const headers = buildHttpHeaders({ ...endpoint, address: ctx.address }, ctx.headers);
    try {
      const response = await firstValueFrom(this.http.post<Bundle>(baseUrl, bundle, { headers }));
      return this.outcomesFromResponse(posted, response);
    } catch (err) {
      const message = describeFhirHttpFailure(err);
      return posted.map((resource) => ({
        ...this.fields(resource),
        ok: false,
        message,
      }));
    }
  }

  private contentAddressDiffers(): boolean {
    const evaluation = normalizeFhirBaseUrlForBundlePost(
      this.settingsService.getEffectiveEvaluationServerUrl()
    );
    const content = normalizeFhirBaseUrlForBundlePost(
      this.settingsService.getEffectiveContentEndpointAddress()
    );
    return content !== '' && content !== evaluation;
  }

  private outcomesFromResponse(posted: Resource[], response: Bundle): CmsImportOutcome[] {
    const entries = response.entry ?? [];
    return posted.map((resource, index) => {
      const fields = this.fields(resource);
      const entry = entries[index];
      if (!entry) {
        return { ...fields, ok: false, message: 'Missing transaction-response entry' };
      }
      const status = (entry.response?.status ?? '').trim();
      if (status !== '' && !/^2/.test(status)) {
        const outcome = entry.response?.outcome as OperationOutcome | undefined;
        return { ...fields, ok: false, message: `${status}${fhirOutcomeSummary(outcome)}`.trim() };
      }
      return { ...fields, ok: true, message: status || 'OK' };
    });
  }

  private fields(resource: Resource): Pick<CmsImportOutcome, 'resourceType' | 'id' | 'label'> {
    const resourceType = resourceTypeOf(resource) ?? 'Resource';
    const id = typeof resource.id === 'string' ? resource.id : '';
    const title =
      'title' in resource && typeof resource.title === 'string' && resource.title.trim()
        ? resource.title.trim()
        : '';
    const name =
      'name' in resource && typeof resource.name === 'string' && resource.name.trim()
        ? resource.name.trim()
        : '';
    return {
      resourceType,
      id,
      label: title || name || `${resourceType}/${id || 'new'}`,
    };
  }
}
