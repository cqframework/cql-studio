// Author: Eugene Vestel
//
// Loads the static CMS125 demo content shipped at public/fhir/sql-on-fhir/.
// Provides one-click "Load demo measure" support for the SqlOnFhir component
// so users can drive the full pipeline without a backing FHIR server.

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, forkJoin } from 'rxjs';
import { map } from 'rxjs/operators';
import type { Bundle, Library, ValueSet } from 'fhir/r4';
import { decodeUtf8Base64 } from '../utf8-encoding.lib';
import { validateCms125DemoBundle } from './sql-on-fhir-execution-data.lib';

export interface DemoMeasureContent {
  /** A FHIR Library resource with embedded base64 CQL in `content[0].data`. */
  library: Library;
  /** A small synthetic Patient/Encounter/Observation/Procedure Bundle. */
  bundle: Bundle;
  /** ValueSets referenced by the library (compose definitions). */
  valueSets: ValueSet[];
  /** Decoded CQL source (UTF-8), convenient for display alongside the Library. */
  cqlSource: string;
  /** Stable identifier used to key pglite reseeding. */
  dataKey: string;
}

const CMS125_BASE = '/fhir/sql-on-fhir';
export const CMS125_DATA_KEY = 'cms125-v1';
const CMS125_PATHS = {
  library: `${CMS125_BASE}/cms125-library.json`,
  bundle: `${CMS125_BASE}/cms125-bundle.json`,
  valueSets: [
    `${CMS125_BASE}/valuesets/mammography.json`,
    `${CMS125_BASE}/valuesets/bilateral-mastectomy.json`,
    `${CMS125_BASE}/valuesets/office-visit.json`,
  ],
} as const;

export { validateCms125DemoBundle } from './sql-on-fhir-execution-data.lib';

@Injectable({ providedIn: 'root' })
export class SqlOnFhirDemoService {
  private http = inject(HttpClient);

  loadCms125(): Observable<DemoMeasureContent> {
    return forkJoin({
      library: this.http.get<Library>(CMS125_PATHS.library),
      bundle: this.http.get<Bundle>(CMS125_PATHS.bundle),
      valueSets: forkJoin(CMS125_PATHS.valueSets.map(p => this.http.get<ValueSet>(p))),
    }).pipe(
      map(({ library, bundle, valueSets }) => {
        validateCms125DemoBundle(bundle);
        const validated = valueSets.filter(
          vs => vs.url?.trim() && (vs.compose?.include?.length ?? 0) > 0,
        );
        if (validated.length !== CMS125_PATHS.valueSets.length) {
          throw new Error(
            `Expected ${CMS125_PATHS.valueSets.length} CMS125 value sets with compose definitions; loaded ${validated.length}.`,
          );
        }
        return {
          library,
          bundle,
          valueSets: validated,
          cqlSource: decodeLibraryCql(library),
          dataKey: CMS125_DATA_KEY,
        };
      }),
    );
  }

  loadCms125ValueSets(): Observable<ValueSet[]> {
    return forkJoin(CMS125_PATHS.valueSets.map(p => this.http.get<ValueSet>(p))).pipe(
      map(valueSets => {
        const validated = valueSets.filter(
          vs => vs.url?.trim() && (vs.compose?.include?.length ?? 0) > 0,
        );
        if (validated.length !== CMS125_PATHS.valueSets.length) {
          throw new Error(
            `Expected ${CMS125_PATHS.valueSets.length} CMS125 value sets with compose definitions; loaded ${validated.length}.`,
          );
        }
        return validated;
      }),
    );
  }
}

export function decodeLibraryCql(library: Library): string {
  const content = library.content?.find(c => c.contentType === 'text/cql');
  if (!content?.data) {
    return '';
  }
  try {
    return decodeUtf8Base64(content.data);
  } catch {
    return '';
  }
}
