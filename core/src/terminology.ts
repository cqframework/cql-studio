// Author: Preston Lee

/** Hosts that must not receive ValueSet POSTs (read-only authorities). */
export const READ_ONLY_TERMINOLOGY_AUTHORITY_HOSTS: ReadonlySet<string> = new Set([
  'cts.nlm.nih.gov',
  'uat-cts.nlm.nih.gov',
  'vsac.nlm.nih.gov',
  'cartos.healthit.gov',
]);

export function isReadOnlyTerminologyAuthorityHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  if (!h) return false;
  if (READ_ONLY_TERMINOLOGY_AUTHORITY_HOSTS.has(h)) return true;
  if (h.endsWith('.nlm.nih.gov')) return true;
  return false;
}

/**
 * True when a terminology endpoint URL points at a known read-only authority
 * (VSAC/NLM or ONC Cartos) and must not be used as an import target.
 */
export function isReadOnlyTerminologyEndpointUrl(url: string): boolean {
  const raw = url?.trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw.includes('://') ? raw : `https://${raw}`);
    return isReadOnlyTerminologyAuthorityHost(parsed.hostname);
  } catch {
    const lower = raw.toLowerCase();
    return (
      lower.includes('cts.nlm.nih.gov') ||
      lower.includes('nlm.nih.gov') ||
      lower.includes('cartos.healthit.gov')
    );
  }
}

export interface ValueSetCqlSnippetInput {
  url?: string | null;
  title?: string | null;
  name?: string | null;
  id?: string | null;
}

/**
 * Formats a CQL valueset declaration from FHIR ValueSet metadata.
 * Returns null when no canonical URL is available.
 */
export function formatValueSetCqlDeclaration(
  vs: ValueSetCqlSnippetInput,
  fallbackLabel = 'ValueSet'
): string | null {
  const url = typeof vs.url === 'string' ? vs.url.trim() : '';
  if (!url) return null;
  const label = String(vs.title || vs.name || vs.id || fallbackLabel).replace(/"/g, '\\"');
  return `valueset "${label}": '${url}'`;
}
