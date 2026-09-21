// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Library } from 'fhir/r4';
import { LibraryService } from './library.service';
import { EnvironmentService } from './environment.service';
import {
  CqlUsingDeclaration,
  decodeModelInfoXmlFromLibrary,
  extractCqlUsingDeclarations,
  MODEL_DEFINITION_TYPE_CODE,
  modelInfoCacheKey,
  parseModelInfoXmlIdentity,
  resolveModelInfoIdentity,
  rewriteModelInfoXmlIdentity
} from './cql-model-info.lib';

@Injectable({
  providedIn: 'root'
})
export class CqlModelInfoService {
  private readonly libraryService = inject(LibraryService);
  private readonly environmentService = inject(EnvironmentService);

  private readonly xmlByKey = new Map<string, string>();
  private bundledReady = false;
  private bundledLoadPromise: Promise<void> | null = null;
  private lastContentAddress = '';

  getCachedXml(name: string, version: string | null | undefined): string | null {
    const xml = this.xmlByKey.get(modelInfoCacheKey(name, version)) ?? null;
    if (!xml || !version?.trim()) {
      return xml;
    }
    // Never serve ModelInfo XML whose @version disagrees with the cache key / using clause.
    const xmlId = parseModelInfoXmlIdentity(xml);
    if (xmlId && (xmlId.version !== version || xmlId.name !== name)) {
      const aligned = rewriteModelInfoXmlIdentity(xml, name, version);
      this.xmlByKey.set(modelInfoCacheKey(name, version), aligned);
      return aligned;
    }
    return xml;
  }

  setCachedXml(name: string, version: string | null | undefined, xml: string): void {
    if (!xml.trim()) {
      return;
    }
    this.xmlByKey.set(modelInfoCacheKey(name, version), xml);
  }

  async ensureBundledLoaded(): Promise<void> {
    if (this.bundledReady) {
      return;
    }
    if (this.getCachedXml('System', null) && this.getCachedXml('FHIR', '4.0.1')) {
      this.bundledReady = true;
      return;
    }
    if (this.bundledLoadPromise) {
      return this.bundledLoadPromise;
    }
    this.bundledLoadPromise = Promise.all([
      this.fetchText('/cql/system-modelinfo.xml').then((xml) => {
        this.setCachedXml('System', '1.0.0', xml);
        this.setCachedXml('System', null, xml);
      }),
      this.fetchText('/cql/fhir-modelinfo-4.0.1.xml').then((xml) => {
        this.setCachedXml('FHIR', '4.0.1', xml);
      })
    ]).then(() => {
      this.bundledReady = true;
    });
    return this.bundledLoadPromise;
  }

  async prefetchForCql(
    cql: string,
    extra: CqlUsingDeclaration[] = []
  ): Promise<{ missing: CqlUsingDeclaration[] }> {
    this.invalidateIfContentAddressChanged();
    await this.ensureBundledLoaded();
    const decls = [...extractCqlUsingDeclarations(cql), ...extra];
    const missing: CqlUsingDeclaration[] = [];
    for (const decl of decls) {
      if (this.getCachedXml(decl.name, decl.version)) {
        continue;
      }
      const xml = await this.resolveFromFhir(decl.name, decl.version);
      if (xml) {
        this.setCachedXml(decl.name, decl.version, xml);
      } else {
        missing.push(decl);
      }
    }
    return { missing };
  }

  lookupXml(id: string, version: string | null | undefined): string | null {
    if (id === 'System' && !version) {
      return this.getCachedXml('System', null) ?? this.getCachedXml('System', '1.0.0');
    }
    return this.getCachedXml(id, version);
  }

  async resolveFromFhir(name: string, version: string | null | undefined): Promise<string | null> {
    this.invalidateIfContentAddressChanged();
    const fromContent = await this.findModelDefinition(name, version, true);
    if (fromContent) {
      return fromContent;
    }
    return this.findModelDefinition(name, version, false);
  }

  private async findModelDefinition(
    name: string,
    version: string | null | undefined,
    useContent: boolean
  ): Promise<string | null> {
    try {
      const library = await firstValueFrom(
        this.libraryService.findByNameAndVersion(
          name,
          version ?? undefined,
          useContent,
          MODEL_DEFINITION_TYPE_CODE
        )
      );
      if (!library) {
        return null;
      }
      return this.xmlFromLibrary(library);
    } catch {
      return null;
    }
  }

  xmlFromLibrary(library: Library): string | null {
    const xml = decodeModelInfoXmlFromLibrary(library);
    if (!xml) {
      return null;
    }
    const identity = resolveModelInfoIdentity(library, xml);
    if (!identity.name) {
      return xml;
    }
    // Published FHIR examples often embed older ModelInfo XML than Library.version.
    // Align XML attributes so cache keys and the translator see the Library version.
    const xmlId = parseModelInfoXmlIdentity(xml);
    const needsRewrite =
      !!identity.version &&
      (!xmlId || xmlId.version !== identity.version || xmlId.name !== identity.name);
    const aligned = needsRewrite
      ? rewriteModelInfoXmlIdentity(xml, identity.name, identity.version!)
      : xml;
    this.setCachedXml(identity.name, identity.version, aligned);
    return aligned;
  }

  snapshotForDebug(keys: Array<{ name: string; version: string | null }>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const k of keys) {
      const xml = this.getCachedXml(k.name, k.version);
      if (xml) {
        out[modelInfoCacheKey(k.name, k.version)] = xml;
      }
    }
    const system = this.getCachedXml('System', null) ?? this.getCachedXml('System', '1.0.0');
    const fhir = this.getCachedXml('FHIR', '4.0.1');
    if (system) {
      out[modelInfoCacheKey('System', null)] = system;
      out[modelInfoCacheKey('System', '1.0.0')] = system;
    }
    if (fhir) {
      out[modelInfoCacheKey('FHIR', '4.0.1')] = fhir;
    }
    return out;
  }

  private invalidateIfContentAddressChanged(): void {
    const address = this.environmentService.getEffectiveAddressForRole('content');
    if (this.lastContentAddress && this.lastContentAddress !== address) {
      this.clearFhirCachedEntries();
    }
    this.lastContentAddress = address;
  }

  private clearFhirCachedEntries(): void {
    const bundled = new Set([
      modelInfoCacheKey('System', null),
      modelInfoCacheKey('System', '1.0.0'),
      modelInfoCacheKey('FHIR', '4.0.1')
    ]);
    for (const key of [...this.xmlByKey.keys()]) {
      if (!bundled.has(key)) {
        this.xmlByKey.delete(key);
      }
    }
  }

  private async fetchText(path: string): Promise<string> {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${path}: ${response.status} ${response.statusText}`);
    }
    return response.text();
  }
}
