// Author: Preston Lee

/**
 * Batch and transaction Bundles must be POSTed to the FHIR REST service root (e.g. `.../fhir`),
 * not to the `Bundle` type URL (`.../fhir/Bundle`). The latter is treated as "create Bundle instance"
 * and triggers HAPI-0522 for non-storable bundle types such as `searchset`.
 */
export function normalizeFhirBaseUrlForBundlePost(baseUrl: string): string {
  let u = baseUrl.trim().replace(/\/+$/, '');
  while (/\/Bundle$/i.test(u)) {
    u = u.replace(/\/Bundle$/i, '').replace(/\/+$/, '');
  }
  return u;
}
