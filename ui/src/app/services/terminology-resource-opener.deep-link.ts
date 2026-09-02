// Author: Preston Lee

/**
 * Query params for deep-linking into terminology tabs:
 *
 *   /terminology/valuesets?id={id}&url={canonicalUrl}
 *   /terminology/codesystems?id={id}&url={canonicalUrl}
 *   /terminology/conceptmaps?id={id}&url={canonicalUrl}
 *
 * `url` is optional and used as a fallback when the resource id is not on the terminology server.
 */
export type TerminologyOpenResourceType = 'ValueSet' | 'CodeSystem' | 'ConceptMap';

export const TERMINOLOGY_QUERY_ID = 'id';
export const TERMINOLOGY_QUERY_URL = 'url';

export function terminologyResourcePath(resourceType: TerminologyOpenResourceType): string {
  switch (resourceType) {
    case 'ValueSet':
      return '/terminology/valuesets';
    case 'CodeSystem':
      return '/terminology/codesystems';
    case 'ConceptMap':
      return '/terminology/conceptmaps';
  }
}
