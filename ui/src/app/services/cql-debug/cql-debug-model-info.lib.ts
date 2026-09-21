// Author: Preston Lee

import type { CqlDebugStartPayload } from './cql-debug-protocol';

type ModelInfoPayloadSlice = Pick<
  CqlDebugStartPayload,
  'modelInfoByKey' | 'systemModelInfoXml' | 'fhirModelInfoXml'
>;

/** Resolve ModelInfo XML for the sync debug/translate provider from a multi-model payload. */
export function lookupModelInfoXmlFromPayload(
  payload: ModelInfoPayloadSlice,
  id: string,
  version: string | null | undefined
): string | null {
  const key = `${id}|${version ?? ''}`;
  const fromMap = payload.modelInfoByKey?.[key];
  if (fromMap) {
    return fromMap;
  }
  if (id === 'System' && !version) {
    return (
      payload.modelInfoByKey?.['System|'] ??
      payload.modelInfoByKey?.['System|1.0.0'] ??
      payload.systemModelInfoXml ??
      null
    );
  }
  if (id === 'FHIR' && version === '4.0.1') {
    return payload.modelInfoByKey?.['FHIR|4.0.1'] ?? payload.fhirModelInfoXml ?? null;
  }
  return null;
}
