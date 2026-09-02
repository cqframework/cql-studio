// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { AuthService } from './auth.service';
import {
  SharedEnvironmentConfig,
  SharedEnvironmentDto,
  Workspace,
  WorkspaceAccessGrant,
  WorkspaceActivityPage,
  WorkspaceActivityPageQuery,
  WorkspaceActivityStats,
  WorkspaceActivityStatsQuery,
  WorkspaceResourceReference,
  WorkspaceRole,
  WorkspaceVisibility,
} from '../models/team.model';

@Injectable({
  providedIn: 'root'
})
export class WorkspaceService {
  private readonly auth = inject(AuthService);

  private url(path: string): string {
    return `${this.auth.apiBase()}/api/workspaces${path}`;
  }

  private async json<T>(res: Response): Promise<T> {
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error || res.statusText);
    }
    if (res.status === 204) {
      return undefined as T;
    }
    return res.json() as Promise<T>;
  }

  list(): Promise<Workspace[]> {
    return fetch(this.url(''), { credentials: 'include' }).then((r) => this.json(r));
  }

  get(id: string): Promise<Workspace> {
    return fetch(this.url(`/${id}`), { credentials: 'include' }).then((r) => this.json(r));
  }

  create(input: {
    name: string;
    description?: string;
    visibility?: WorkspaceVisibility;
  }): Promise<Workspace> {
    return fetch(this.url(''), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }).then((r) => this.json(r));
  }

  update(
    id: string,
    input: Partial<{ name: string; description: string | null; visibility: WorkspaceVisibility }>
  ): Promise<Workspace> {
    return fetch(this.url(`/${id}`), {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }).then((r) => this.json(r));
  }

  delete(id: string): Promise<void> {
    return fetch(this.url(`/${id}`), {
      method: 'DELETE',
      credentials: 'include',
    }).then((r) => this.json(r));
  }

  listGrants(workspaceId: string): Promise<WorkspaceAccessGrant[]> {
    return fetch(this.url(`/${workspaceId}/grants`), { credentials: 'include' }).then((r) =>
      this.json(r)
    );
  }

  upsertGrant(
    workspaceId: string,
    principal:
      | { type: 'USER'; email: string; role: WorkspaceRole }
      | { type: 'TEAM'; id: string; role: WorkspaceRole }
  ): Promise<WorkspaceAccessGrant> {
    return fetch(this.url(`/${workspaceId}/grants`), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(principal),
    }).then((r) => this.json(r));
  }

  updateGrant(
    workspaceId: string,
    grantId: string,
    role: WorkspaceRole
  ): Promise<WorkspaceAccessGrant> {
    return fetch(this.url(`/${workspaceId}/grants/${grantId}`), {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    }).then((r) => this.json(r));
  }

  deleteGrant(workspaceId: string, grantId: string): Promise<void> {
    return fetch(this.url(`/${workspaceId}/grants/${grantId}`), {
      method: 'DELETE',
      credentials: 'include',
    }).then((r) => this.json(r));
  }

  listEnvironments(workspaceId: string): Promise<SharedEnvironmentDto[]> {
    return fetch(this.url(`/${workspaceId}/environments`), { credentials: 'include' }).then((r) =>
      this.json(r)
    );
  }

  createEnvironment(
    workspaceId: string,
    name: string,
    config: SharedEnvironmentConfig
  ): Promise<SharedEnvironmentDto> {
    return fetch(this.url(`/${workspaceId}/environments`), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, config }),
    }).then((r) => this.json(r));
  }

  updateEnvironment(
    workspaceId: string,
    envId: string,
    input: { name?: string; config?: SharedEnvironmentConfig }
  ): Promise<SharedEnvironmentDto> {
    return fetch(this.url(`/${workspaceId}/environments/${envId}`), {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }).then((r) => this.json(r));
  }

  deleteEnvironment(workspaceId: string, envId: string): Promise<void> {
    return fetch(this.url(`/${workspaceId}/environments/${envId}`), {
      method: 'DELETE',
      credentials: 'include',
    }).then((r) => this.json(r));
  }

  listResources(workspaceId: string): Promise<WorkspaceResourceReference[]> {
    return fetch(this.url(`/${workspaceId}/resources`), { credentials: 'include' }).then((r) =>
      this.json(r)
    );
  }

  addResource(
    workspaceId: string,
    input: {
      resourceType: string;
      resourceId: string;
      canonicalUrl?: string | null;
      displayName?: string | null;
    }
  ): Promise<WorkspaceResourceReference> {
    return fetch(this.url(`/${workspaceId}/resources`), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }).then((r) => this.json(r));
  }

  deleteResource(workspaceId: string, refId: string): Promise<void> {
    return fetch(this.url(`/${workspaceId}/resources/${refId}`), {
      method: 'DELETE',
      credentials: 'include',
    }).then((r) => this.json(r));
  }

  activity(query: WorkspaceActivityPageQuery = {}): Promise<WorkspaceActivityPage> {
    const params = new URLSearchParams();
    if (query.page != null) {
      params.set('page', String(query.page));
    }
    if (query.pageSize != null) {
      params.set('pageSize', String(query.pageSize));
    }
    if (query.sortBy) {
      params.set('sortBy', query.sortBy);
    }
    if (query.sortOrder) {
      params.set('sortOrder', query.sortOrder);
    }
    const qs = params.toString();
    const url = query.workspaceId
      ? this.url(`/${query.workspaceId}/activity${qs ? `?${qs}` : ''}`)
      : `${this.auth.apiBase()}/api/activity${qs ? `?${qs}` : ''}`;
    return fetch(url, { credentials: 'include' }).then((r) => this.json(r));
  }

  activityStats(query: WorkspaceActivityStatsQuery = {}): Promise<WorkspaceActivityStats> {
    const params = new URLSearchParams();
    if (query.workspaceId) {
      params.set('workspaceId', query.workspaceId);
    }
    if (query.range) {
      params.set('range', query.range);
    }
    if (query.interval) {
      params.set('interval', query.interval);
    }
    if (query.top != null) {
      params.set('top', String(query.top));
    }
    if (query.metrics?.length) {
      params.set('metrics', query.metrics.join(','));
    }
    const qs = params.toString();
    return fetch(`${this.auth.apiBase()}/api/activity/stats${qs ? `?${qs}` : ''}`, {
      credentials: 'include',
    }).then((r) => this.json(r));
  }
}
