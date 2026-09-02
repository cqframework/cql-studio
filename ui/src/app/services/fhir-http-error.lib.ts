// Author: Preston Lee

import { HttpErrorResponse } from '@angular/common/http';
import { OperationOutcome } from 'fhir/r4';

/** Summarizes an OperationOutcome's issues into a short human-readable string. */
export function fhirOutcomeSummary(outcome: OperationOutcome | undefined): string {
  const issues = outcome?.issue;
  if (!issues?.length) {
    return '';
  }
  const parts = issues
    .map((i) => {
      const d = i.diagnostics;
      const t = i.details?.text;
      const a = typeof d === 'string' ? d : d != null ? JSON.stringify(d) : '';
      const b = typeof t === 'string' ? t : t != null ? JSON.stringify(t) : '';
      return a || b;
    })
    .filter(Boolean);
  return parts.length ? ` — ${parts.join('; ')}` : '';
}

/**
 * Converts a caught error into a readable message, special-casing Angular's `HttpErrorResponse`
 * (which implements, but does not extend, `Error`, so `instanceof Error` is false and naively
 * calling `String(err)` yields the useless `"[object Object]"`).
 */
export function describeFhirHttpFailure(e: unknown): string {
  if (e instanceof HttpErrorResponse) {
    // status 0: browser blocked the request (offline, CORS, DNS, refused connection, etc.)
    if (e.status === 0) {
      const url = e.url ? ` (${e.url})` : '';
      return `Unable to connect to the FHIR server${url}`;
    }
    const errBody = e.error;
    if (errBody != null && typeof errBody === 'object' && 'issue' in errBody) {
      const msg = fhirOutcomeSummary(errBody as OperationOutcome).replace(/^\s*—\s*/, '');
      return [e.message, msg].filter(Boolean).join(' — ');
    }
    if (typeof errBody === 'string' && errBody.trim()) {
      return `${e.message} — ${errBody.trim().slice(0, 500)}`;
    }
    return e.message || `${e.status ?? ''} ${e.statusText ?? ''}`.trim();
  }
  if (e instanceof Error) {
    return e.message;
  }
  if (typeof e === 'string') {
    return e;
  }
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
