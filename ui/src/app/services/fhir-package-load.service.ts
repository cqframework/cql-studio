// Author: Preston Lee

import { Injectable, inject } from '@angular/core';
import {
  FhirPackageIndexJson,
  FhirPackageJson
} from '../models/fhir-package-registry.types';
import { IndexedResourceRowVm, PackageSummaryVm } from '../models/fhir-package-view.model';
import { FhirPackageRegistryService } from './fhir-package-registry.service';
import { FhirPackageTarService } from './fhir-package-tar.service';
import { FhirPackageMetadataService } from './fhir-package-metadata.service';
import { validateFhirPackageJson } from './fhir-package-manifest.lib';
import { decodeUtf8Bytes } from './utf8-encoding.lib';

export interface ParsedFhirPackageTarball {
  files: Map<string, Uint8Array>;
  pkgJson: FhirPackageJson;
  /** Name from package.json (or fallback). */
  packageName: string;
  summary: PackageSummaryVm;
  rows: IndexedResourceRowVm[];
}

export interface ParseTarballOptions {
  /**
   * When true, enforce FHIR NPM package rules on `package/package.json`
   * (name, version, author, description, core dependency). Use for local `.tgz` uploads.
   */
  requireFhirCompliance?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class FhirPackageLoadService {
  private readonly registry = inject(FhirPackageRegistryService);
  private readonly tar = inject(FhirPackageTarService);
  private readonly metadata = inject(FhirPackageMetadataService);

  async fetchAndParseTarball(
    tarballUrl: string,
    jsonNameFallback: string,
    rowKeyScope?: string
  ): Promise<ParsedFhirPackageTarball> {
    const buf = await this.registry.fetchTarball(tarballUrl);
    return this.parseTarballBuffer(buf, jsonNameFallback, rowKeyScope);
  }

  parseTarballBuffer(
    tgzBytes: ArrayBuffer,
    jsonNameFallback: string,
    rowKeyScope?: string,
    options?: ParseTarballOptions
  ): ParsedFhirPackageTarball {
    const files = this.tar.extractTarGz(tgzBytes);
    return this.parseExtractedFiles(files, jsonNameFallback, rowKeyScope, options);
  }

  /**
   * Parse a local FHIR package `.tgz` with strict FHIR packaging compliance.
   */
  parseLocalFhirPackageTarball(
    tgzBytes: ArrayBuffer,
    jsonNameFallback = 'unknown.package'
  ): ParsedFhirPackageTarball {
    return this.parseTarballBuffer(tgzBytes, jsonNameFallback, undefined, {
      requireFhirCompliance: true
    });
  }

  /**
   * @param jsonNameFallback — used when `package.json` omits `name`.
   * @param rowKeyScope — if set, row keys use this (registry/dependency key); otherwise uses resolved package name.
   */
  parseExtractedFiles(
    files: Map<string, Uint8Array>,
    jsonNameFallback: string,
    rowKeyScope?: string,
    options?: ParseTarballOptions
  ): ParsedFhirPackageTarball {
    const raw = this.utf8File(files, 'package/package.json');
    if (!raw) {
      throw new Error(
        'Not a FHIR package: package/package.json not found in archive. ' +
          'FHIR packages must be a .tgz with a package/ folder containing package.json.'
      );
    }
    let pkgJson: FhirPackageJson;
    try {
      pkgJson = JSON.parse(raw) as FhirPackageJson;
    } catch {
      throw new Error('Not a FHIR package: package/package.json is not valid JSON.');
    }

    if (options?.requireFhirCompliance) {
      const validation = validateFhirPackageJson(pkgJson);
      if (!validation.valid) {
        throw new Error(
          'Not a FHIR-compliant package: ' + validation.errors.join(' ')
        );
      }
    }

    const packageName = (pkgJson.name ?? jsonNameFallback).trim();
    const scope = (rowKeyScope ?? packageName).trim();
    const summary = this.metadata.buildPackageSummary(pkgJson);
    let index: FhirPackageIndexJson | null = null;
    const indexRaw = this.utf8File(files, 'package/.index.json');
    if (indexRaw) {
      try {
        index = JSON.parse(indexRaw) as FhirPackageIndexJson;
      } catch {
        index = null;
      }
    }
    const rawRows = this.metadata.buildIndexedRows(index, files, pkgJson);
    const rows = this.scopeRowsForPackage(scope, rawRows);
    return { files, pkgJson, packageName, summary, rows };
  }

  readPackageJsonFromFiles(files: Map<string, Uint8Array>): FhirPackageJson {
    const raw = this.utf8File(files, 'package/package.json');
    if (!raw) {
      throw new Error('package/package.json missing from loaded package.');
    }
    return JSON.parse(raw) as FhirPackageJson;
  }

  private scopeRowsForPackage(packageName: string, rows: IndexedResourceRowVm[]): IndexedResourceRowVm[] {
    return rows.map((r) => ({
      ...r,
      rowKey: `${packageName}::${r.filename}`
    }));
  }

  private utf8File(files: Map<string, Uint8Array>, path: string): string | null {
    const u8 = files.get(path);
    if (!u8) {
      return null;
    }
    return decodeUtf8Bytes(u8, { fatal: false });
  }
}
