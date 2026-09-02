// Author: Preston Lee

/**
 * URL paths for built-in example files. Single source of truth to avoid drift between app and e2e tests.
 */

/** Example result files under public/examples/results. */
export class ExamplePaths {
  static readonly BASE = '/examples/results';
  static readonly RESULTS_JSON = `${ExamplePaths.BASE}/results.json`;
  static readonly INDEX_JSON = `${ExamplePaths.BASE}/index.json`;
  static readonly RUNNER_CONFIG_JSON = `${ExamplePaths.BASE}/runner-config.json`;

  /** Glob pattern for Playwright route matching (e.g. abort). */
  static readonly ROUTE_GLOB = '**/examples/results/*.json';
}

/** FHIR bundle and CQL examples under public/fhir. Update when adding/removing files in public/fhir/bundles or public/fhir/cql. */
export const FHIR_GROUP_BUNDLE_EXAMPLE_PATHS: string[] = [
  '/fhir/bundles/Group 1 - All Example Patients.json',
  '/fhir/bundles/Group 2 - Female Example Patients.json',
  '/fhir/bundles/Group 3 - Adrian Allen Cohort.json'
];

export const FHIR_BUNDLE_EXAMPLE_PATHS: string[] = [
  '/fhir/bundles/hospitalInformation1671557337568.json',
  '/fhir/bundles/hospitalInformation1671557444542.json',
  '/fhir/bundles/practitionerInformation1671557337568.json',
  '/fhir/bundles/practitionerInformation1671557444542.json',
  '/fhir/bundles/Patient 1 - Adrian Allen1.json',
  '/fhir/bundles/Patient 2 - Beth Brooks2.json',
  '/fhir/bundles/Patient 3 - Carmen Chavez.json',
  '/fhir/bundles/Patient 4 - Diana Dixon4.json',
  ...FHIR_GROUP_BUNDLE_EXAMPLE_PATHS
];

export const FHIR_CQL_EXAMPLE_PATHS: string[] = [
  '/fhir/cql/HelloWorld.cql'
];
