// Author: Preston Lee

import { Injectable } from '@angular/core';

export interface StagedFhirPackageTarball {
  fileName: string;
  bytes: ArrayBuffer;
}

/**
 * One-shot handoff of a local FHIR package `.tgz` from the FHIR Uploader
 * (or other pickers) into the Registry Importer. Binary payloads cannot use query params.
 */
@Injectable({
  providedIn: 'root'
})
export class FhirPackageLocalUploadStagingService {
  private pending: StagedFhirPackageTarball | null = null;

  stage(fileName: string, bytes: ArrayBuffer): void {
    this.pending = { fileName, bytes };
  }

  peek(): StagedFhirPackageTarball | null {
    return this.pending;
  }

  /** Returns and clears the staged tarball, or null if none. */
  consume(): StagedFhirPackageTarball | null {
    const next = this.pending;
    this.pending = null;
    return next;
  }

  clear(): void {
    this.pending = null;
  }
}
