// Author: Preston Lee

export type ModelInfoCatalogKind = 'published' | 'ballot' | 'bundled';

export interface ModelInfoCompanionHelpers {
  /** FHIRHelpers Library / include version (e.g. 4.3.0). */
  version: string;
  /** FHIR model version for the rewritten `using FHIR version '…'` line. */
  fhirModelVersion: string;
  label?: string;
}

export interface ModelInfoCatalogEntry {
  id: string;
  modelName: string;
  version: string;
  kind: ModelInfoCatalogKind;
  label: string;
  /** NPM package id on the FHIR package registry (when installable from tarball). */
  packageId?: string;
  /**
   * Preferred Library JSON path inside the package (without package/ prefix match flexible).
   * When omitted, any Library with type model-definition matching modelName is used.
   */
  libraryFilenameHint?: string;
  /** Direct Library JSON URL (used when package install is awkward, e.g. FHIR core examples). */
  libraryJsonUrl?: string;
  /** Normalize Library.name to this value on install (FHIR R5 caveat). */
  normalizeNameTo?: string;
  /**
   * Matching FHIRHelpers logic-library to install alongside this ModelInfo.
   * Synthesized from Studio-bundled FHIRHelpers 4.0.1 with version labels rewritten —
   * published hl7.org FHIRHelpers examples often ship mismatched CQL vs Library.version.
   */
  companionHelpers?: ModelInfoCompanionHelpers;
}

/** Curated install catalog (no CI / build.fhir.org). */
export const MODEL_INFO_INSTALL_CATALOG: ModelInfoCatalogEntry[] = [
  {
    id: 'system-1.0.0',
    modelName: 'System',
    version: '1.0.0',
    kind: 'bundled',
    label: 'System 1.0.0 (bundled)'
  },
  {
    id: 'fhir-4.0.1',
    modelName: 'FHIR',
    version: '4.0.1',
    kind: 'bundled',
    label: 'FHIR 4.0.1 (bundled)',
    packageId: 'hl7.fhir.uv.cql',
    libraryFilenameHint: 'Library-FHIR-ModelInfo'
    // FHIRHelpers 4.0.1 is bundled in the UI; no companion install needed.
  },
  {
    id: 'fhir-4.3.0',
    modelName: 'FHIR',
    version: '4.3.0',
    kind: 'published',
    label: 'FHIR 4.3.0 (R4B)',
    // Prefer published Library JSON (r4b.core tarball has no ModelInfo).
    libraryJsonUrl: 'https://hl7.org/fhir/R4B/library-fhir-model-definition.json',
    companionHelpers: {
      version: '4.3.0',
      fhirModelVersion: '4.3.0',
      label: 'FHIRHelpers 4.3.0'
    }
  },
  {
    id: 'fhir-5.0.0',
    modelName: 'FHIR',
    version: '5.0.0',
    kind: 'published',
    label: 'FHIR 5.0.0 (R5)',
    libraryJsonUrl: 'https://hl7.org/fhir/R5/library-fhir-model-definition.json',
    normalizeNameTo: 'FHIR',
    companionHelpers: {
      version: '5.0.0',
      fhirModelVersion: '5.0.0',
      label: 'FHIRHelpers 5.0.0'
    }
  },
  ...qicorePublished(),
  {
    id: 'qicore-8.0.0-ballot',
    modelName: 'QICore',
    version: '8.0.0-ballot',
    kind: 'ballot',
    label: 'QICore 8.0.0-ballot',
    packageId: 'hl7.fhir.us.qicore',
    libraryFilenameHint: 'Library-QICore-ModelInfo'
  },
  {
    id: 'usqualitycore-0.5.0',
    modelName: 'USQualityCore',
    version: '0.5.0',
    kind: 'published',
    label: 'USQualityCore 0.5.0',
    packageId: 'fhir.onc.us-quality-core',
    libraryFilenameHint: 'Library-USQualityCore-ModelInfo',
    libraryJsonUrl:
      'https://fhir.org/guides/onc/us-quality-core/0.5.0/package/Library-USQualityCore-ModelInfo.json'
  },
  {
    id: 'usqualitycore-1.0.0-ballot',
    modelName: 'USQualityCore',
    version: '1.0.0-ballot',
    kind: 'ballot',
    label: 'USQualityCore 1.0.0-ballot',
    packageId: 'hl7.fhir.us.quality-core',
    libraryFilenameHint: 'Library-USQualityCore-ModelInfo'
  }
];

function qicorePublished(): ModelInfoCatalogEntry[] {
  const versions = ['4.0.0', '4.1.0', '4.1.1', '5.0.0', '6.0.0', '7.0.0', '7.0.1', '7.0.2'];
  return versions.map((version) => ({
    id: `qicore-${version}`,
    modelName: 'QICore',
    version,
    kind: 'published' as const,
    label: `QICore ${version}`,
    packageId: 'hl7.fhir.us.qicore',
    libraryFilenameHint: 'Library-QICore-ModelInfo'
  }));
}
