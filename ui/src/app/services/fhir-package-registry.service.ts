// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { SettingsService } from './settings.service';
import {
  FhirNpmPackageManifest,
  FhirPackageCatalogEntry
} from '../models/fhir-package-registry.types';

@Injectable({
  providedIn: 'root'
})
export class FhirPackageRegistryService {
  private readonly http = inject(HttpClient);
  private readonly settingsService = inject(SettingsService);

  private jsonHeaders(): HttpHeaders {
    return new HttpHeaders({
      Accept: 'application/json',
      'Content-Type': 'application/json'
    });
  }

  /**
   * Catalog search. Pass `name` and/or `fhirVersion` (registry `FhirVersion` query param).
   * At least one should be non-empty for useful results.
   */
  async searchCatalog(
    nameQuery: string,
    fhirVersion?: string | null
  ): Promise<FhirPackageCatalogEntry[]> {
    const base = this.settingsService.getEffectiveFhirPackageRegistryBaseUrl();
    const params = new URLSearchParams();
    const name = nameQuery.trim();
    if (name) {
      params.set('name', name);
    }
    const fv = fhirVersion?.trim();
    if (fv) {
      params.set('FhirVersion', fv);
    }
    const url = `${base}/catalog?${params.toString()}`;
    const res = await firstValueFrom(
      this.http.get<FhirPackageCatalogEntry[]>(url, { headers: this.jsonHeaders() })
    );
    return Array.isArray(res) ? res : [];
  }

  async getPackageManifest(packageId: string): Promise<FhirNpmPackageManifest> {
    const base = this.settingsService.getEffectiveFhirPackageRegistryBaseUrl();
    const url = `${base}/${encodeURIComponent(packageId)}`;
    const res = await firstValueFrom(
      this.http.get<FhirNpmPackageManifest>(url, {
        headers: this.jsonHeaders().set('Accept', 'application/json')
      })
    );
    return res;
  }

  /**
   * Resolve relative same-origin paths against the page origin, then require http(s).
   */
  resolveTarballUrl(tarballUrl: string): string {
    const raw = tarballUrl.trim();
    if (!raw) {
      throw new Error('Invalid package download URL.');
    }
    let u: URL;
    try {
      u = new URL(raw, typeof window !== 'undefined' ? window.location.origin : undefined);
    } catch {
      throw new Error('Invalid package download URL.');
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      throw new Error('Unsupported package download URL scheme.');
    }
    return u.href;
  }

  async fetchTarball(tarballUrl: string): Promise<ArrayBuffer> {
    const absoluteUrl = this.resolveTarballUrl(tarballUrl);
    let res: Response;
    try {
      res = await fetch(absoluteUrl, { method: 'GET' });
    } catch {
      throw new Error(
        'Package download failed. The host may be unreachable or blocked by CORS.'
      );
    }
    if (!res.ok) {
      throw new Error(`Package download failed: HTTP ${res.status}`);
    }
    return res.arrayBuffer();
  }
}
