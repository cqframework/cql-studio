// Author: Preston Lee

import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthUser } from '../models/team.model';
import { SettingsService } from './settings.service';

interface SessionResponse {
  enabled: boolean;
  user: AuthUser | null;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly settings = inject(SettingsService);

  private readonly _ssoEnabled = signal(false);
  private readonly _currentUser = signal<AuthUser | null>(null);
  private readonly _loaded = signal(false);

  readonly ssoEnabled = this._ssoEnabled.asReadonly();
  readonly currentUser = this._currentUser.asReadonly();
  readonly loaded = this._loaded.asReadonly();
  readonly isAuthenticated = computed(() => this._currentUser() != null);

  /** Base URL for cql-studio-server (CQL_STUDIO_SERVER_BASE_URL / settings). */
  apiBase(): string {
    return this.settings.getEffectiveServerBaseUrl().replace(/\/+$/, '');
  }

  async refreshSession(): Promise<void> {
    try {
      const res = await fetch(`${this.apiBase()}/api/auth/session`, {
        credentials: 'include',
      });
      if (!res.ok) {
        this._ssoEnabled.set(false);
        this._currentUser.set(null);
        return;
      }
      const body = (await res.json()) as SessionResponse;
      this._ssoEnabled.set(!!body.enabled);
      this._currentUser.set(body.user ?? null);
    } catch {
      this._ssoEnabled.set(false);
      this._currentUser.set(null);
    } finally {
      this._loaded.set(true);
    }
  }

  login(returnTo: string = window.location.pathname): void {
    const params = new URLSearchParams({ returnTo });
    window.location.href = `${this.apiBase()}/api/auth/login?${params.toString()}`;
  }

  async logout(): Promise<void> {
    await fetch(`${this.apiBase()}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });
    this._currentUser.set(null);
  }
}
