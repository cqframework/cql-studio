// Author: Preston Lee

import { Library } from 'fhir/r4';
import { encodeUtf8Base64 } from './utf8-encoding.lib';

export function stripCqlComments(cqlContent: string): string {
  const withoutBlockComments = cqlContent.replace(/\/\*[\s\S]*?\*\//g, '');
  return withoutBlockComments.replace(/\/\/[^\n\r]*(?=[\n\r]|$)/g, '');
}

export function convertCqlToFhirLibrary(
  cqlContent: string,
  fileName: string,
  fhirBaseUrl: string
): Library {
  const contentWithoutComments = stripCqlComments(cqlContent);
  const libraryHeader =
    contentWithoutComments.match(/library\s+(?:"([^"]+)"|'([^']+)'|([A-Za-z_][\w.]*))/i) ?? null;
  const libraryName =
    libraryHeader?.[1] || libraryHeader?.[2] || libraryHeader?.[3] || fileName.replace(/\.cql$/i, '');

  const descriptionMatch = cqlContent.match(/\/\*\*([^*]+)\*\//s);
  const description = descriptionMatch ? descriptionMatch[1].trim() : `CQL Library: ${libraryName}`;

  // Prefer an explicit library version declaration near the header, not FHIR `using` version.
  const cqlVersionMatch = contentWithoutComments.match(
    /library\s+(?:"[^"]+"|'[^']+'|[A-Za-z_][\w.]*)\s+version\s+['"]([^'"]+)['"]/i
  );
  const cqlVersion = cqlVersionMatch?.[1] ?? '0.0.0';

  const canonicalUrl = `${fhirBaseUrl.replace(/\/+$/, '')}/Library/${encodeURIComponent(libraryName)}`;

  return {
    resourceType: 'Library',
    type: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/library-type',
          code: 'logic-library'
        }
      ]
    },
    id: libraryName.replace(/[^A-Za-z0-9.-]/g, '-'),
    version: cqlVersion,
    name: libraryName,
    title: libraryName,
    status: 'active',
    description,
    url: canonicalUrl,
    content: [
      {
        contentType: 'text/cql',
        data: encodeUtf8Base64(cqlContent)
      }
    ]
  };
}
