// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { AuthService } from './auth.service';
import { Team, TeamMemberRole } from '../models/team.model';

@Injectable({
  providedIn: 'root'
})
export class TeamService {
  private readonly auth = inject(AuthService);

  private url(path: string): string {
    return `${this.auth.apiBase()}/api/teams${path}`;
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

  list(): Promise<Team[]> {
    return fetch(this.url(''), { credentials: 'include' }).then((r) => this.json(r));
  }

  get(id: string): Promise<Team> {
    return fetch(this.url(`/${id}`), { credentials: 'include' }).then((r) => this.json(r));
  }

  create(name: string): Promise<Team> {
    return fetch(this.url(''), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then((r) => this.json(r));
  }

  update(id: string, name: string): Promise<Team> {
    return fetch(this.url(`/${id}`), {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).then((r) => this.json(r));
  }

  delete(id: string): Promise<void> {
    return fetch(this.url(`/${id}`), {
      method: 'DELETE',
      credentials: 'include',
    }).then((r) => this.json(r));
  }

  addMember(teamId: string, userId: string, role: TeamMemberRole = 'MEMBER'): Promise<unknown> {
    return fetch(this.url(`/${teamId}/members`), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, role }),
    }).then((r) => this.json(r));
  }

  removeMember(teamId: string, userId: string): Promise<void> {
    return fetch(this.url(`/${teamId}/members/${userId}`), {
      method: 'DELETE',
      credentials: 'include',
    }).then((r) => this.json(r));
  }
}
