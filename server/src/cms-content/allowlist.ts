// Author: Preston Lee

export const CMS_CONTENT_REPOS = new Set([
  'cqframework/dqm-content-cms-2025',
  'cqframework/dqm-content-cms-2026',
]);

/**
 * USQualityCore 0.1.0 ModelInfo. The current build.fhir.org CI artifact is 0.5.0 and is not a substitute.
 * Keep this URL identical to `CMS_USQUALITYCORE_MODELINFO_URL` in the UI.
 */
export const CMS_USQUALITYCORE_MODELINFO_URL =
  'https://raw.githubusercontent.com/FHIR/us-quality-core/poa_pd_enc/input/cql/usqualitycore-modelinfo-0.1.0.xml';

/** GET-only Library JSON prefixes for the US CQL and UV CQL packages. No other hl7.org path is allowed. */
const CMS_CQL_LIBRARY_PREFIXES = [
  'https://hl7.org/fhir/us/cql/Library-',
  'https://hl7.org/fhir/uv/cql/Library-',
];

export class CmsContentUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CmsContentUrlError';
  }
}

function rejectSegment(segment: string): boolean {
  if (segment === '.' || segment === '..') {
    return true;
  }
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return true;
  }
  return (
    decoded === '.' ||
    decoded === '..' ||
    decoded.includes('/') ||
    decoded.includes('\\') ||
    decoded.includes('..')
  );
}

/**
 * `new URL` collapses `..` and `%2e%2e` before pathname segments can be checked.
 * Inspect the raw path so those forms cannot escape the repository.
 */
function rawPathHasTraversal(rawUrl: string): boolean {
  const withoutQuery = rawUrl.split('?')[0]?.split('#')[0] ?? '';
  const scheme = withoutQuery.indexOf('://');
  const rest = scheme >= 0 ? withoutQuery.slice(scheme + 3) : withoutQuery;
  const slash = rest.indexOf('/');
  const path = slash >= 0 ? rest.slice(slash) : '';
  for (const segment of path.split('/')) {
    if (segment !== '' && rejectSegment(segment)) {
      return true;
    }
  }
  return false;
}

function assertRepo(owner: string, repo: string): void {
  const key = `${owner}/${repo}`;
  if (!CMS_CONTENT_REPOS.has(key)) {
    throw new CmsContentUrlError(`Repository is not allowlisted: ${key}`);
  }
}

/**
 * True for the pinned USQualityCore 0.1.0 ModelInfo file and hl7.org CQL Library JSON documents.
 * Query strings are rejected. Other hosts and paths are not.
 */
export function isCmsExecutionDependencyUrl(url: URL): boolean {
  if (url.search) {
    return false;
  }
  const href = `${url.origin}${url.pathname}`.replace(/\/+$/, '');
  if (href === CMS_USQUALITYCORE_MODELINFO_URL) {
    return true;
  }
  return CMS_CQL_LIBRARY_PREFIXES.some((prefix) => {
    if (!href.startsWith(prefix)) {
      return false;
    }
    const rest = href.slice(prefix.length);
    return rest.length > 0 && !rest.includes('/');
  });
}

/**
 * Validates a GitHub contents or raw URL, or a pinned CMS execution-dependency URL.
 * Returns a new URL safe to fetch with GET.
 */
export function resolveCmsContentTarget(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new CmsContentUrlError('Invalid URL');
  }
  if (url.protocol !== 'https:') {
    throw new CmsContentUrlError('Only https URLs are allowed');
  }
  if (url.username || url.password || url.hash) {
    throw new CmsContentUrlError('URL credentials and fragments are not allowed');
  }
  if (rawPathHasTraversal(rawUrl)) {
    throw new CmsContentUrlError('Path traversal is not allowed');
  }
  if (isCmsExecutionDependencyUrl(url)) {
    return new URL(url.toString());
  }

  if (url.hostname === 'api.github.com') {
    const parts = url.pathname.split('/').filter((part) => part.length > 0);
    if (parts.length < 4 || parts[0] !== 'repos' || parts[3] !== 'contents') {
      throw new CmsContentUrlError('Only GitHub contents API URLs are allowed');
    }
    assertRepo(parts[1], parts[2]);
    for (const segment of parts.slice(4)) {
      if (rejectSegment(segment)) {
        throw new CmsContentUrlError('Path traversal is not allowed');
      }
    }
    for (const key of url.searchParams.keys()) {
      if (key !== 'ref') {
        throw new CmsContentUrlError('Only the ref query parameter is allowed');
      }
    }
    const ref = url.searchParams.get('ref');
    if (ref != null && rejectSegment(ref)) {
      throw new CmsContentUrlError('Invalid ref');
    }
    return new URL(url.toString());
  }

  if (url.hostname === 'raw.githubusercontent.com') {
    if (url.search) {
      throw new CmsContentUrlError('Raw content URLs must not include a query');
    }
    const parts = url.pathname.split('/').filter((part) => part.length > 0);
    if (parts.length < 4) {
      throw new CmsContentUrlError('Raw content URL is missing a file path');
    }
    assertRepo(parts[0], parts[1]);
    if (rejectSegment(parts[2])) {
      throw new CmsContentUrlError('Invalid ref');
    }
    for (const segment of parts.slice(3)) {
      if (rejectSegment(segment)) {
        throw new CmsContentUrlError('Path traversal is not allowed');
      }
    }
    return new URL(url.toString());
  }

  throw new CmsContentUrlError('Host is not allowlisted');
}
