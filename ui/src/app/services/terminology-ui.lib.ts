// Author: Preston Lee

import { Bundle, FhirResource, Resource } from 'fhir/r4';
import { isResourceType } from './fhir-resource-type.lib';

type FhirResourceTypeName = FhirResource['resourceType'];

export function hasTerminologyConfigured(terminologyBaseUrl: string): boolean {
  return terminologyBaseUrl.trim() !== '';
}

export function terminologyHttpErrorMessage(error: unknown): string {
  const status = (error as { status?: number })?.status;
  if (status === 401 || status === 403) {
    return 'Authentication failed. The terminology server may require authentication. Please check your authorization bearer token in Settings.';
  }
  if (status === 404) {
    return 'Server responded with 404 error: not found.';
  }
  if (status != null && status >= 500) {
    return 'Server error. Please try again later.';
  }
  return (error as { message?: string })?.message || 'An unexpected error occurred.';
}

export function formatFhirDate(dateString?: string, withTime = false): string {
  if (!dateString) {
    return '';
  }
  try {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) {
      return dateString;
    }
    return withTime ? date.toLocaleString() : date.toLocaleDateString();
  } catch {
    return dateString;
  }
}

export function terminologyResourceTrackId(
  prefix: string,
  resource: { id?: string; url?: string },
  index: number
): string {
  const id = resource.id?.trim();
  const url = resource.url?.trim();
  if (id) {
    return `${prefix}-id-${id}-${index}`;
  }
  if (url) {
    return `${prefix}-url-${url}-${index}`;
  }
  return `${prefix}-${index}`;
}

export function terminologyDownloadFilename(
  resourceType: string,
  resource: { id?: string; url?: string }
): string {
  if (resource.id) {
    return `${resourceType}-${resource.id}.json`;
  }
  if (resource.url) {
    return `${resourceType}-${resource.url.replace(/[^a-zA-Z0-9]/g, '_')}.json`;
  }
  return `${resourceType}.json`;
}

export interface BundlePageResult<T extends Resource> {
  items: T[];
  links: Map<string, string>;
  total: number;
}

export function parseBundlePage<T extends Resource>(
  bundle: Bundle | null | undefined,
  resourceType: FhirResourceTypeName,
  options: { pageSize: number; currentPage: number }
): BundlePageResult<T> {
  const items =
    bundle?.entry
      ?.map((e) => e.resource)
      .filter((resource): resource is T => isResourceType(resource, resourceType)) || [];

  const links = new Map<string, string>();
  for (const link of bundle?.link ?? []) {
    if (link.relation && link.url) {
      links.set(link.relation, link.url);
    }
  }

  let total: number;
  if (bundle?.total !== undefined) {
    total = bundle.total;
  } else if (links.has('next')) {
    total = options.currentPage * options.pageSize + 1;
  } else {
    total = (options.currentPage - 1) * options.pageSize + items.length;
  }

  return { items, links, total };
}
