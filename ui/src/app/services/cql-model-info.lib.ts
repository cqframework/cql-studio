// Author: Preston Lee

import { Library } from 'fhir/r4';
import { decodeUtf8Base64, encodeUtf8Base64 } from './utf8-encoding.lib';

export const MODEL_DEFINITION_TYPE_CODE = 'model-definition';
export const LOGIC_LIBRARY_TYPE_CODE = 'logic-library';
export const LIBRARY_TYPE_SYSTEM = 'http://terminology.hl7.org/CodeSystem/library-type';

/** FHIR token for Library.type searches (`system|code`). */
export function libraryTypeSearchToken(code: string): string {
  return `${LIBRARY_TYPE_SYSTEM}|${code}`;
}

export interface CqlUsingDeclaration {
  name: string;
  version: string | null;
}

export function modelInfoCacheKey(name: string, version: string | null | undefined): string {
  return `${name}|${version ?? ''}`;
}

/** Extract coding code from Library.type (CodeableConcept) or a plain string. */
export function libraryTypeCode(type: unknown): string | undefined {
  if (typeof type === 'string' && type.trim()) {
    return type.trim();
  }
  if (!type || typeof type !== 'object') {
    return undefined;
  }
  const coding = (type as { coding?: Array<{ code?: string; system?: string }> }).coding;
  if (!Array.isArray(coding)) {
    return undefined;
  }
  const preferred = coding.find(
    (c) => c.code === MODEL_DEFINITION_TYPE_CODE || c.system === LIBRARY_TYPE_SYSTEM
  );
  const code = (preferred ?? coding[0])?.code?.trim();
  return code || undefined;
}

export function isModelDefinitionLibrary(library: Library): boolean {
  return libraryTypeCode(library.type) === MODEL_DEFINITION_TYPE_CODE;
}

export function isModelDefinitionTypeField(typeField: string | undefined | null): boolean {
  const t = (typeField ?? '').trim().toLowerCase();
  return t === MODEL_DEFINITION_TYPE_CODE || t.endsWith(`|${MODEL_DEFINITION_TYPE_CODE}`);
}

/**
 * Parse CQL `using` declarations (ignores comments).
 * Example: `using QICore version '6.0.0'`
 */
export function extractCqlUsingDeclarations(cql: string): CqlUsingDeclaration[] {
  if (!cql?.trim()) {
    return [];
  }
  const withoutBlock = cql.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const withoutLine = withoutBlock.replace(/\/\/[^\n\r]*/g, ' ');
  const re =
    /\busing\s+([A-Za-z_][\w.]*)(?:\s+version\s+['"]([^'"]+)['"])?/gi;
  const out: CqlUsingDeclaration[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(withoutLine)) !== null) {
    const name = match[1];
    const version = match[2] ?? null;
    const key = modelInfoCacheKey(name, version);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({ name, version });
  }
  return out;
}

/** Decode ModelInfo XML from a model-definition Library.content attachment. */
export function decodeModelInfoXmlFromLibrary(library: Library): string | null {
  const attachment = library.content?.find((c) => {
    const ct = (c.contentType ?? '').toLowerCase();
    // Exact XML types only — do not match application/elm+xml.
    return ct === 'application/xml' || ct === 'text/xml';
  });
  if (!attachment?.data) {
    return null;
  }
  try {
    const xml = decodeUtf8Base64(attachment.data);
    return xml.trim() ? xml : null;
  } catch {
    return null;
  }
}

/**
 * Prefer Library metadata when present; fall back to XML root attributes.
 * Catalog installs rewrite XML to match Library.name/version.
 */
export function resolveModelInfoIdentity(
  library: Library,
  xml?: string | null
): { name: string; version: string | null } {
  const fromXml = xml ? parseModelInfoXmlIdentity(xml) : null;
  let name = (library.name || fromXml?.name || '').trim();
  // R5 core example uses FHIRModelDefinition; CQL expects FHIR.
  if (name === 'FHIRModelDefinition') {
    name = 'FHIR';
  }
  if (!name && fromXml?.name) {
    name = fromXml.name === 'FHIRModelDefinition' ? 'FHIR' : fromXml.name;
  }
  const version = (library.version || fromXml?.version || null)?.trim() || null;
  return { name, version };
}

export function parseModelInfoXmlIdentity(xml: string): { name: string; version: string } | null {
  if (!xml?.trim() || typeof DOMParser === 'undefined') {
    return null;
  }
  try {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) {
      return null;
    }
    const root =
      doc.querySelector('modelInfo') ??
      doc.getElementsByTagNameNS('*', 'modelInfo').item(0) ??
      doc.documentElement;
    if (!root) {
      return null;
    }
    const name = root.getAttribute('name')?.trim() ?? '';
    const version = root.getAttribute('version')?.trim() ?? '';
    if (!name) {
      return null;
    }
    return { name, version };
  } catch {
    return null;
  }
}

/**
 * Rewrite root modelInfo name/version attributes.
 * Published FHIR core examples often embed older ModelInfo XML (e.g. R4B Library 4.3.0
 * ships XML version="4.0.1"; R5 Library 5.0.0 ships XML version="4.0.0").
 */
export function rewriteModelInfoXmlIdentity(xml: string, name: string, version: string): string {
  if (typeof DOMParser !== 'undefined' && typeof XMLSerializer !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      if (!doc.querySelector('parsererror')) {
        const root =
          doc.querySelector('modelInfo') ??
          doc.getElementsByTagNameNS('*', 'modelInfo').item(0);
        if (root) {
          root.setAttribute('name', name);
          root.setAttribute('version', version);
          const serialized = new XMLSerializer().serializeToString(doc);
          // Keep an XML declaration when the input had one (serializer may omit it).
          if (/^\s*<\?xml\b/i.test(xml) && !/^\s*<\?xml\b/i.test(serialized)) {
            return `<?xml version="1.0" encoding="UTF-8"?>\n${serialized}`;
          }
          return serialized;
        }
      }
    } catch {
      // fall through to regex
    }
  }
  return xml.replace(
    /(<([\w.-]+:)?modelInfo\b)([^>]*?)(\/?>)/i,
    (_full, start: string, _ns: string | undefined, attrs: string, end: string) => {
      let nextAttrs = attrs;
      if (/\bname\s*=/.test(nextAttrs)) {
        nextAttrs = nextAttrs.replace(/\bname\s*=\s*(["'])[\s\S]*?\1/i, `name="${name}"`);
      } else {
        nextAttrs += ` name="${name}"`;
      }
      if (/\bversion\s*=/.test(nextAttrs)) {
        nextAttrs = nextAttrs.replace(/\bversion\s*=\s*(["'])[\s\S]*?\1/i, `version="${version}"`);
      } else {
        nextAttrs += ` version="${version}"`;
      }
      return `${start}${nextAttrs}${end}`;
    }
  );
}

function withRewrittenModelInfoContent(
  library: Library,
  xml: string
): Library['content'] {
  const content = [...(library.content ?? [])];
  const idx = content.findIndex((c) => {
    const ct = (c.contentType ?? '').toLowerCase();
    return ct === 'application/xml' || ct === 'text/xml';
  });
  const attachment = {
    contentType: 'application/xml' as const,
    data: encodeUtf8Base64(xml)
  };
  if (idx >= 0) {
    content[idx] = { ...content[idx], ...attachment };
  } else {
    content.unshift(attachment);
  }
  return content;
}

export function normalizeModelDefinitionLibrary(library: Library): Library {
  const xml = decodeModelInfoXmlFromLibrary(library);
  const identity = resolveModelInfoIdentity(library, xml);
  let next: Library = {
    ...library,
    resourceType: 'Library',
    name: identity.name || library.name,
    version: identity.version ?? library.version,
    type: {
      coding: [
        {
          system: LIBRARY_TYPE_SYSTEM,
          code: MODEL_DEFINITION_TYPE_CODE
        }
      ]
    }
  };
  if (!next.status) {
    next.status = 'active';
  }
  if (xml && next.name && next.version) {
    const rewritten = rewriteModelInfoXmlIdentity(xml, next.name, next.version);
    next = { ...next, content: withRewrittenModelInfoContent(next, rewritten) };
  }
  if (!next.id && next.name) {
    const ver = (next.version ?? 'unknown').replace(/[^A-Za-z0-9._-]/g, '-');
    next.id = `${next.name}-ModelInfo-${ver}`.replace(/[^A-Za-z0-9._-]/g, '-');
  }
  return next;
}

/**
 * Force Library + embedded ModelInfo XML identity (catalog installs for FHIR 4.3.0/5.0.0).
 */
export function alignModelDefinitionIdentity(
  library: Library,
  opts: { name?: string; version?: string }
): Library {
  const name = (opts.name || library.name || '').trim();
  const version = (opts.version || library.version || '').trim();
  return normalizeModelDefinitionLibrary({
    ...library,
    name: name === 'FHIRModelDefinition' ? 'FHIR' : name || library.name,
    version: version || library.version
  });
}

export function wrapModelInfoXmlAsLibrary(
  xml: string,
  opts?: { name?: string; version?: string; id?: string; url?: string }
): Library {
  const identity = parseModelInfoXmlIdentity(xml) ?? {
    name: opts?.name ?? 'Unknown',
    version: opts?.version ?? '0.0.0'
  };
  const name = opts?.name ?? identity.name;
  const version = opts?.version ?? identity.version;
  const id =
    opts?.id ??
    `${name}-ModelInfo-${version}`.replace(/[^A-Za-z0-9._-]/g, '-');
  return normalizeModelDefinitionLibrary({
    resourceType: 'Library',
    id,
    name,
    version,
    title: `${name} Model Definition`,
    status: 'active',
    url: opts?.url,
    type: {
      coding: [{ system: LIBRARY_TYPE_SYSTEM, code: MODEL_DEFINITION_TYPE_CODE }]
    },
    content: [
      {
        contentType: 'application/xml',
        data: encodeUtf8Base64(xml)
      }
    ]
  });
}

/**
 * Relabel bundled FHIRHelpers CQL so `include FHIRHelpers version '…'` and
 * `using FHIR version '…'` match the installed ModelInfo. Published hl7.org
 * "FHIRHelpers" examples often keep 4.0.x CQL inside a newer Library.version.
 */
export function rewriteFhirHelpersCql(
  cql: string,
  helpersVersion: string,
  fhirModelVersion: string
): string {
  let out = cql.replace(
    /^(\s*library\s+FHIRHelpers\s+version\s+')([^']+)(')/m,
    `$1${helpersVersion}$3`
  );
  out = out.replace(
    /^(\s*using\s+FHIR\s+version\s+')([^']+)(')/m,
    `$1${fhirModelVersion}$3`
  );
  return out;
}

/** Build a logic-library FHIRHelpers Library from CQL text. */
export function wrapFhirHelpersCqlAsLibrary(
  cql: string,
  version: string,
  opts?: { id?: string; url?: string; title?: string }
): Library {
  const id = opts?.id ?? `FHIRHelpers-${version}`.replace(/[^A-Za-z0-9._-]/g, '-');
  return {
    resourceType: 'Library',
    id,
    name: 'FHIRHelpers',
    version,
    title: opts?.title ?? `FHIR Helpers ${version}`,
    status: 'active',
    url: opts?.url,
    type: {
      coding: [{ system: LIBRARY_TYPE_SYSTEM, code: LOGIC_LIBRARY_TYPE_CODE }]
    },
    content: [
      {
        contentType: 'text/cql',
        data: encodeUtf8Base64(cql)
      }
    ]
  };
}
