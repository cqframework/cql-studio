// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { Bundle, Endpoint, Library, OperationOutcome, Parameters, ParametersParameter, Resource } from 'fhir/r4';
import { BUILT_IN_ENVIRONMENT_ID } from '../models/environment.model';
import { AuthService } from './auth.service';
import { EnvironmentService } from './environment.service';

export interface CrmiIssue {
  severity?: string;
  text: string;
}

@Injectable({
  providedIn: 'root'
})
export class CrmiApiService {
  private readonly auth = inject(AuthService);
  private readonly environments = inject(EnvironmentService);

  /** Spec base for the active environment. The built-in profile uses `/api/fhir/default`. */
  base(): string | null {
    const api = this.auth.apiBase();
    if (this.environments.activeEnvironmentSource() === 'workspace') {
      const ref = this.environments.activeWorkspaceEnvironment();
      if (!ref) {
        return null;
      }
      return `${api}/api/fhir/workspace/${encodeURIComponent(ref.workspaceId)}/${encodeURIComponent(ref.environmentId)}`;
    }
    const active = this.environments.activeEnvironment();
    if (active.builtIn || active.id === BUILT_IN_ENVIRONMENT_ID) {
      return `${api}/api/fhir/default`;
    }
    return `${api}/api/fhir/personal/${encodeURIComponent(active.id)}`;
  }

  environmentName(): string {
    return this.environments.activeEnvironment().name;
  }

  async postOperation(path: string, body: Resource | Parameters): Promise<Resource> {
    const base = this.base();
    if (!base) {
      throw new Error('No active CRMI environment is available.');
    }
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/fhir+json',
        'Content-Type': 'application/fhir+json',
        ...this.defaultProfileHeaders(base)
      },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    const parsed = text ? (JSON.parse(text) as Resource) : undefined;
    if (!response.ok || !parsed) {
      throw new Error(outcomeMessage(parsed) || `CRMI request failed (${response.status}).`);
    }
    if (parsed.resourceType === 'OperationOutcome') {
      const message = outcomeMessage(parsed);
      if (message) {
        throw new Error(message);
      }
    }
    return parsed;
  }

  private defaultProfileHeaders(base: string): Record<string, string> {
    if (!base.endsWith('/api/fhir/default')) {
      return {};
    }
    const content = this.resolvedDefaultEndpoint('content');
    if (!content.address) {
      throw new Error('Default environment has no content endpoint configured.');
    }
    const terminology = this.resolvedDefaultEndpoint('terminology');
    const headers: Record<string, string> = {
      'X-Cql-Studio-Content-Base-Url': content.address
    };
    if (content.authorization) {
      headers['X-Cql-Studio-Content-Authorization'] = content.authorization;
    }
    if (terminology.address) {
      headers['X-Cql-Studio-Terminology-Base-Url'] = terminology.address;
    }
    if (terminology.authorization) {
      headers['X-Cql-Studio-Terminology-Authorization'] = terminology.authorization;
    }
    return headers;
  }

  private resolvedDefaultEndpoint(role: 'content' | 'terminology'): { address: string; authorization?: string } {
    const ownAddress = this.environments.getEndpointConfiguration(role).address?.trim() ?? '';
    const source = ownAddress ? role : 'evaluation';
    const address = this.environments.getEffectiveAddressForRole(role).replace(/\/+$/, '');
    const authorization = authorizationHeader(this.environments.getEndpointHttpContext(source).headers);
    return { address, authorization };
  }
}

export function fhirParameters(
  parts: Array<{ name: string; value?: string; code?: string; flag?: boolean; resource?: Resource }>
): Parameters {
  const parameter: ParametersParameter[] = parts.map((part) => {
    const entry: ParametersParameter = { name: part.name };
    if (part.resource) {
      entry.resource = part.resource;
    } else if (typeof part.flag === 'boolean') {
      entry.valueBoolean = part.flag;
    } else if (part.code) {
      entry.valueCode = part.code;
    } else if (part.value) {
      entry.valueString = part.value;
    }
    return entry;
  });
  return { resourceType: 'Parameters', parameter };
}

export function outcomeIssues(resource: Resource | undefined): CrmiIssue[] {
  if (!resource || resource.resourceType !== 'Bundle') {
    return [];
  }
  const bundle = resource as Bundle;
  const manifest = bundle.entry?.[0]?.resource as Library | undefined;
  const outcome = manifest?.contained?.find((item) => item.resourceType === 'OperationOutcome') as OperationOutcome | undefined;
  return (outcome?.issue ?? []).map((issue) => ({
    severity: issue.severity,
    text: issue.details?.text || issue.diagnostics || issue.code || 'Issue'
  }));
}

export function terminologyEndpointParameter(contentAddress: string, terminologyAddress: string): Endpoint | null {
  const content = contentAddress.replace(/\/+$/, '');
  const terminology = terminologyAddress.replace(/\/+$/, '');
  if (!terminology || terminology === content) {
    return null;
  }
  return {
    resourceType: 'Endpoint',
    status: 'active',
    connectionType: {
      system: 'http://terminology.hl7.org/CodeSystem/endpoint-connection-type',
      code: 'hl7-fhir-rest'
    },
    payloadType: [{ text: 'FHIR resource' }],
    address: terminology
  };
}

function authorizationHeader(headers: Record<string, string>): string | undefined {
  const entry = Object.entries(headers).find(([name]) => name.toLowerCase() === 'authorization');
  const value = entry?.[1]?.trim();
  return value || undefined;
}

function outcomeMessage(resource: Resource | undefined): string | null {
  if (!resource || resource.resourceType !== 'OperationOutcome') {
    return null;
  }
  const texts = ((resource as OperationOutcome).issue ?? [])
    .map((issue) => issue.details?.text || issue.diagnostics)
    .filter((text): text is string => !!text);
  return texts.length ? texts.join(' ') : null;
}
