// Author: Preston Lee

export interface CmsContentSource {
  id: string;
  label: string;
  owner: string;
  repo: string;
  ref: string;
  model: string;
  measurePath: string;
  libraryPath: string;
}

export const CMS_CONTENT_SOURCES: readonly CmsContentSource[] = [
  {
    id: 'cms-2025-au',
    label: '2025 AU',
    owner: 'cqframework',
    repo: 'dqm-content-cms-2025',
    ref: 'main',
    model: "USQualityCore version '0.1.0-cibuild'",
    measurePath: 'input/resources/measure',
    libraryPath: 'input/resources/library',
  },
  {
    id: 'cms-2026-au',
    label: '2026 AU',
    owner: 'cqframework',
    repo: 'dqm-content-cms-2026',
    ref: 'main',
    model: 'USQualityCore (draft examples)',
    measurePath: 'input/resources/measure',
    libraryPath: 'input/resources/library',
  },
];

export function cmsContentSourceById(id: string): CmsContentSource | undefined {
  return CMS_CONTENT_SOURCES.find((source) => source.id === id);
}
