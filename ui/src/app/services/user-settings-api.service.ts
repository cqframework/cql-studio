// Author: Preston Lee

import { Injectable } from '@angular/core';
import type { CqlEnvironment, UserEnvironmentDto, UserSettingsDto, UserSettingsPatch } from '@cql-studio/core';
import { DeployConfigKeys, readDeployConfigUrl } from './deploy-config.lib';

@Injectable({
  providedIn: 'root'
})
export class UserSettingsApiService {
  private apiBase(): string {
    return readDeployConfigUrl(DeployConfigKeys.SERVER_BASE_URL);
  }

  private url(path: string): string {
    return `${this.apiBase()}/api/users${path}`;
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

  getSettings(): Promise<UserSettingsDto> {
    return fetch(this.url('/me/settings'), { credentials: 'include' }).then((r) => this.json(r));
  }

  patchSettings(patch: UserSettingsPatch): Promise<UserSettingsDto> {
    return fetch(this.url('/me/settings'), {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then((r) => this.json(r));
  }

  putSettings(settings: UserSettingsDto): Promise<UserSettingsDto> {
    return fetch(this.url('/me/settings'), {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    }).then((r) => this.json(r));
  }

  listEnvironments(): Promise<UserEnvironmentDto[]> {
    return fetch(this.url('/me/environments'), { credentials: 'include' }).then((r) => this.json(r));
  }

  replaceEnvironments(environments: CqlEnvironment[]): Promise<UserEnvironmentDto[]> {
    return fetch(this.url('/me/environments'), {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(environments),
    }).then((r) => this.json(r));
  }

  createEnvironment(environment: CqlEnvironment): Promise<UserEnvironmentDto> {
    return fetch(this.url('/me/environments'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(environment),
    }).then((r) => this.json(r));
  }

  updateEnvironment(id: string, environment: Partial<CqlEnvironment> & { name?: string }): Promise<UserEnvironmentDto> {
    return fetch(this.url(`/me/environments/${id}`), {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(environment),
    }).then((r) => this.json(r));
  }

  deleteEnvironment(id: string): Promise<void> {
    return fetch(this.url(`/me/environments/${id}`), {
      method: 'DELETE',
      credentials: 'include',
    }).then((r) => this.json(r));
  }
}
