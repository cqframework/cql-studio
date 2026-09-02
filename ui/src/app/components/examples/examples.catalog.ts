// Author: Preston Lee

export type ExampleBadge = 'CDS' | 'Measure' | 'Gaps in Care';

export const EXAMPLE_BADGES: readonly ExampleBadge[] = [
  'CDS',
  'Measure',
  'Gaps in Care'
] as const;

export interface ExampleCatalogEntry {
  id: string;
  title: string;
  path: string;
  badges: ExampleBadge[];
  description: string;
  packageId: string;
  /** Empty string means resolve dist-tags.latest in the importer. */
  packageVersion: string;
  /**
   * Same-origin or absolute URL to a FHIR package `.tgz`. When set, Examples deep-link
   * the importer with `source=url` instead of a registry package id.
   */
  packageUrl: string;
}

export const EXAMPLE_PACKAGES_BASE = '/examples/packages';

export const EXAMPLE_CATALOG: readonly ExampleCatalogEntry[] = [
  {
    id: 'lipid-management',
    title: 'Lipid Management',
    path: 'lipid-management',
    badges: ['CDS', 'Gaps in Care'],
    description:
      'CQL-based lipid management and cardiovascular risk workflows (including PREVENT-aligned scoring), with VSAC and custom value sets for therapy and observation criteria.',
    packageId: '',
    packageVersion: '',
    packageUrl: `${EXAMPLE_PACKAGES_BASE}/com.prestonlee.fhir.lipid-management-0.4.0.tgz`
  },
  {
    id: 'hospital-at-home',
    title: 'Hospital at Home',
    path: 'hospital-at-home',
    badges: ['CDS', 'Gaps in Care'],
    description:
      'CQL demonstration of Hospital-at-Home eligibility using the Leff et al. (1997) inclusion and exclusion criteria, with encounter-level results, bundled test patients, and VSAC ValueSet definitions.',
    packageId: '',
    packageVersion: '',
    packageUrl: `${EXAMPLE_PACKAGES_BASE}/hah-eligibility-demo-1.2.0.tgz`
  }
];

export function findExampleById(id: string): ExampleCatalogEntry | undefined {
  return EXAMPLE_CATALOG.find((e) => e.id === id);
}
