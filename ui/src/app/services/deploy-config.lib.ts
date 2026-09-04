// Author: Preston Lee

/** `window` keys injected by `ui/public/configuration.template.js`. */
export const DeployConfigKeys = {
  SERVER_BASE_URL: 'CQL_STUDIO_SERVER_BASE_URL',
  RUNNER_BASE_URL: 'CQL_STUDIO_RUNNER_BASE_URL',
  RUNNER_FHIR_BASE_URL: 'CQL_STUDIO_RUNNER_FHIR_BASE_URL',
  FHIR_BASE_URL: 'CQL_STUDIO_FHIR_BASE_URL',
  EVALUATION_SERVER_URL: 'CQL_STUDIO_EVALUATION_SERVER_URL',
  DATA_ENDPOINT_URL: 'CQL_STUDIO_DATA_ENDPOINT_URL',
  CONTENT_ENDPOINT_URL: 'CQL_STUDIO_CONTENT_ENDPOINT_URL',
  TERMINOLOGY_BASE_URL: 'CQL_STUDIO_TERMINOLOGY_BASE_URL',
  TERMINOLOGY_BASIC_AUTH_USERNAME: 'CQL_STUDIO_TERMINOLOGY_BASIC_AUTH_USERNAME',
  TERMINOLOGY_BASIC_AUTH_PASSWORD: 'CQL_STUDIO_TERMINOLOGY_BASIC_AUTH_PASSWORD',
  DEFAULT_TEST_RESULTS_INDEX_URL: 'CQL_STUDIO_DEFAULT_TEST_RESULTS_INDEX_URL',
  OLLAMA_BASE_URL: 'CQL_STUDIO_OLLAMA_BASE_URL',
  OLLAMA_MODEL: 'CQL_STUDIO_OLLAMA_MODEL',
  SEARXNG_BASE_URL: 'CQL_STUDIO_SEARXNG_BASE_URL',
  FHIR_PACKAGE_REGISTRY_BASE_URL: 'CQL_STUDIO_FHIR_PACKAGE_REGISTRY_BASE_URL',
  VSAC_FHIR_BASE_URL: 'CQL_STUDIO_VSAC_FHIR_BASE_URL',
  VSAC_BASIC_AUTH_USERNAME: 'CQL_STUDIO_VSAC_BASIC_AUTH_USERNAME',
  VSAC_BASIC_AUTH_PASSWORD: 'CQL_STUDIO_VSAC_BASIC_AUTH_PASSWORD',
} as const;

type DeployConfigKey = (typeof DeployConfigKeys)[keyof typeof DeployConfigKeys];

/** Local dev / production fallbacks when deploy config leaves a key unset. */
const DeployConfigDefaults: Partial<Record<DeployConfigKey, string>> = {
  [DeployConfigKeys.SERVER_BASE_URL]: 'http://localhost:3003',
  [DeployConfigKeys.RUNNER_BASE_URL]: 'http://localhost:8091',
  [DeployConfigKeys.RUNNER_FHIR_BASE_URL]: 'http://cql-studio-hapi-r4-data:8080/fhir',
  [DeployConfigKeys.DEFAULT_TEST_RESULTS_INDEX_URL]: 'http://localhost:8092/index.json',
  [DeployConfigKeys.FHIR_BASE_URL]: 'http://localhost:8080/fhir',
  [DeployConfigKeys.OLLAMA_BASE_URL]: 'http://localhost:11434',
  [DeployConfigKeys.OLLAMA_MODEL]: 'qwen3.6:35b-mlx',
  [DeployConfigKeys.FHIR_PACKAGE_REGISTRY_BASE_URL]: 'https://packages.fhir.org',
  [DeployConfigKeys.VSAC_FHIR_BASE_URL]: 'https://cts.nlm.nih.gov/fhir',
  [DeployConfigKeys.VSAC_BASIC_AUTH_USERNAME]: 'apikey',
};

function deployConfig(): Record<string, string | undefined> {
  return window as unknown as Record<string, string | undefined>;
}

/** Read a deploy-time value injected via `configuration.js`. */
export function readDeployConfig(key: DeployConfigKey | string, fallback?: string): string {
  const value = deployConfig()[key];
  if (value?.trim()) {
    return value.trim();
  }
  return fallback ?? DeployConfigDefaults[key as DeployConfigKey] ?? '';
}

/** Like {@link readDeployConfig}, but strips trailing slashes (for base URLs). */
export function readDeployConfigUrl(key: DeployConfigKey | string, fallback?: string): string {
  const value = readDeployConfig(key, fallback);
  return value ? value.replace(/\/+$/, '') : '';
}
