// Author: Preston Lee

import { Library, Resource } from 'fhir/r4';
import {
  decodeModelInfoXmlFromLibrary,
  isModelDefinitionLibrary,
  parseModelInfoXmlIdentity,
  wrapModelInfoXmlAsLibrary,
  normalizeModelDefinitionLibrary,
} from './cql-model-info.lib';
import { unqualifyCqlLibraryIncludes } from './elm-include.lib';
import { decodeUtf8Base64, encodeUtf8Base64 } from './utf8-encoding.lib';

/** Keep identical to `CMS_USQUALITYCORE_MODELINFO_URL` in the server allowlist. */
export const CMS_USQUALITYCORE_MODELINFO_URL =
  'https://raw.githubusercontent.com/FHIR/us-quality-core/poa_pd_enc/input/cql/usqualitycore-modelinfo-0.1.0.xml';

export const CMS_USCORE_MODELINFO_URL = 'https://hl7.org/fhir/us/cql/Library-USCore-ModelInfo.json';

export const CMS_USQUALITYCORE_MODEL = { name: 'USQualityCore', version: '0.1.0-cibuild' } as const;
export const CMS_USCORE_MODEL = { name: 'USCore', version: '6.1.0-derived' } as const;

export interface CmsCompanionLibrarySpec {
  url: string;
  name: string;
  version: string;
  system: string;
}

export const CMS_COMPANION_LIBRARIES: readonly CmsCompanionLibrarySpec[] = [
  {
    url: 'https://hl7.org/fhir/uv/cql/Library-FHIRHelpers.json',
    name: 'FHIRHelpers',
    version: '4.0.1',
    system: 'hl7.fhir.uv.cql',
  },
  {
    url: 'https://hl7.org/fhir/uv/cql/Library-FHIRCommon.json',
    name: 'FHIRCommon',
    version: '2.0.0',
    system: 'hl7.fhir.uv.cql',
  },
  {
    url: 'https://hl7.org/fhir/us/cql/Library-USCoreCommon.json',
    name: 'USCoreCommon',
    version: '2.0.0-ballot',
    system: 'hl7.fhir.us.cql',
  },
  {
    url: 'https://hl7.org/fhir/us/cql/Library-USCoreElements.json',
    name: 'USCoreElements',
    version: '2.0.0-ballot',
    system: 'hl7.fhir.us.cql',
  },
  {
    url: 'https://hl7.org/fhir/us/cql/Library-CumulativeMedicationDuration.json',
    name: 'CumulativeMedicationDuration',
    version: '2.0.0-ballot',
    system: 'hl7.fhir.us.cql',
  },
];

export interface CqlVersionRewrite {
  name: string;
  from: string;
  to: string;
}

/** Published US Core CQL libraries use 2.0.0; CMS measures include the ballot label. */
export const CMS_COMPANION_VERSION_REWRITES: readonly CqlVersionRewrite[] = [
  { name: 'USCoreCommon', from: '2.0.0', to: '2.0.0-ballot' },
  { name: 'USCoreElements', from: '2.0.0', to: '2.0.0-ballot' },
  { name: 'CumulativeMedicationDuration', from: '2.0.0', to: '2.0.0-ballot' },
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function rewriteCqlVersionLabels(cql: string, rewrites: readonly CqlVersionRewrite[]): string {
  let out = cql;
  for (const rewrite of rewrites) {
    if (rewrite.from === rewrite.to) {
      continue;
    }
    const name = escapeRegExp(rewrite.name);
    const from = escapeRegExp(rewrite.from);
    out = out.replace(
      new RegExp(String.raw`(\blibrary\s+${name}\s+version\s+')${from}(')`, 'g'),
      `$1${rewrite.to}$2`
    );
    out = out.replace(
      new RegExp(String.raw`(\binclude\s+(?:[\w.]+\.)?${name}\s+version\s+')${from}(')`, 'g'),
      `$1${rewrite.to}$2`
    );
  }
  return out;
}

export function isElmContentType(contentType: string | undefined): boolean {
  const ct = (contentType ?? '').toLowerCase();
  return ct.includes('elm+json') || ct.includes('elm+xml');
}

export function readLibraryCql(library: Library): string {
  const attachment = library.content?.find((content) => {
    const ct = (content.contentType ?? '').toLowerCase();
    return ct.includes('cql') && !ct.includes('elm');
  });
  if (!attachment?.data) {
    return '';
  }
  try {
    return decodeUtf8Base64(attachment.data);
  } catch {
    return '';
  }
}

export function withCqlContent(library: Library, cql: string): Library {
  const content = [...(library.content ?? [])];
  const attachment = { contentType: 'text/cql', data: encodeUtf8Base64(cql) };
  const idx = content.findIndex((item) => {
    const ct = (item.contentType ?? '').toLowerCase();
    return ct.includes('cql') && !ct.includes('elm');
  });
  if (idx >= 0) {
    content[idx] = { ...content[idx], ...attachment };
  } else {
    content.unshift(attachment);
  }
  return { ...library, content };
}

export function stripElmContent(library: Library): Library {
  return {
    ...library,
    content: (library.content ?? []).filter((item) => !isElmContentType(item.contentType)),
  };
}

export function attachElm(library: Library, elmJson: string, elmXml: string | null): Library {
  const content = [...(stripElmContent(library).content ?? [])];
  if (elmXml?.trim()) {
    content.push({ contentType: 'application/elm+xml', data: encodeUtf8Base64(elmXml) });
  }
  if (elmJson.trim()) {
    content.push({ contentType: 'application/elm+json', data: encodeUtf8Base64(elmJson) });
  }
  return { ...library, content };
}

export function withoutNarrative<T extends Resource>(resource: T): T {
  const copy = { ...resource } as T & { text?: unknown };
  delete copy.text;
  return copy;
}

/**
 * Wrap the 0.1.0 USQualityCore ModelInfo and relabel it to the version CMS measures `using`.
 * Refuses any other model so a 0.5.0 artifact cannot be substituted.
 */
export function prepareUsQualityCoreModelInfo(xml: string): Library {
  const identity = parseModelInfoXmlIdentity(xml);
  if (!identity || identity.name !== CMS_USQUALITYCORE_MODEL.name || !identity.version.startsWith('0.1.0')) {
    const found = identity ? `${identity.name} ${identity.version}` : 'unreadable ModelInfo';
    throw new Error(
      `USQualityCore ModelInfo XML is ${found}; expected ${CMS_USQUALITYCORE_MODEL.name} 0.1.0. ` +
        `Refusing to relabel a different model as ${CMS_USQUALITYCORE_MODEL.version}.`
    );
  }
  const library = wrapModelInfoXmlAsLibrary(xml, {
    name: CMS_USQUALITYCORE_MODEL.name,
    version: CMS_USQUALITYCORE_MODEL.version,
    id: 'USQualityCore-ModelInfo',
  });
  const aligned = decodeModelInfoXmlFromLibrary(library);
  const rewritten = aligned ? parseModelInfoXmlIdentity(aligned) : null;
  if (
    library.version !== CMS_USQUALITYCORE_MODEL.version ||
    rewritten?.version !== CMS_USQUALITYCORE_MODEL.version
  ) {
    throw new Error(
      `Failed to align USQualityCore ModelInfo to ${CMS_USQUALITYCORE_MODEL.version}.`
    );
  }
  return library;
}

/** Install the published USCore model-definition unchanged. Its version already matches the `using` clause. */
export function prepareUsCoreModelInfo(library: Library): Library {
  const name = library.name?.trim() ?? '';
  const version = library.version?.trim() ?? '';
  if (name !== CMS_USCORE_MODEL.name || version !== CMS_USCORE_MODEL.version) {
    throw new Error(
      `USCore ModelInfo at the pinned URL is ${name || '(missing name)'} ${version || '(missing version)'}; ` +
        `expected ${CMS_USCORE_MODEL.name} ${CMS_USCORE_MODEL.version}.`
    );
  }
  return normalizeModelDefinitionLibrary(library);
}

/**
 * Align a published companion to the version CMS CQL includes.
 * A ballot suffix is a label change. Any other mismatch is refused.
 * Published ELM is dropped so a 2.0.0 translation is not stored under a 2.0.0-ballot id.
 */
export function alignCompanionLibrary(
  library: Library,
  target: { name: string; version: string },
  rewrites: readonly CqlVersionRewrite[]
): Library {
  const name = library.name?.trim() ?? '';
  const published = library.version?.trim() ?? '';
  if (name !== target.name) {
    throw new Error(`Expected Library.name ${target.name} at the pinned companion URL, found ${name || '(missing)'}.`);
  }
  if (published !== target.version && target.version !== `${published}-ballot`) {
    throw new Error(`Library ${name} version ${published || '(missing)'} cannot be aligned to ${target.version}.`);
  }
  const cql = readLibraryCql(library);
  if (!cql.trim()) {
    throw new Error(`Library ${name} has no CQL content to install.`);
  }
  const rewritten = unqualifyCqlLibraryIncludes(rewriteCqlVersionLabels(cql, rewrites));
  return withCqlContent(stripElmContent({ ...library, version: target.version }), rewritten);
}

/** HAPI translates stored CQL and does not have the HL7 CQL namespaces registered. */
export function unqualifyLibraryCql(library: Library): Library {
  const cql = readLibraryCql(library);
  if (!cql.trim()) {
    return library;
  }
  const rewritten = unqualifyCqlLibraryIncludes(cql);
  if (rewritten === cql) {
    return library;
  }
  return withCqlContent(library, rewritten);
}

export function isCmsLogicLibrary(resource: Resource): resource is Library {
  if (resource.resourceType !== 'Library') {
    return false;
  }
  return !isModelDefinitionLibrary(resource as Library);
}
