// Author: Preston Lee

export type SuggestedImportTarget = 'terminology' | 'data';

export interface PackageSummaryVm {
  name: string;
  version: string;
  packageType: string;
  title: string;
  description: string;
  canonical: string;
  canonicalHref: string;
  fhirVersions: string[];
  dependencies: { name: string; version: string }[];
  jurisdiction: string;
  specUrl: string;
  license: string;
  author: string;
  date: string;
  /**
   * Normalized archive prefixes (e.g. `package/example/`) derived from `package.json` `directories`
   * (`example`, `examples`). Empty if none declared — no files are marked as examples.
   */
  exampleDirectoryPrefixes: string[];
}

export interface IndexedResourceRowVm {
  /** Stable key (usually filename path in archive). */
  rowKey: string;
  filename: string;
  resourceType: string;
  id: string;
  url: string;
  version: string;
  kind: string;
  typeField: string;
  isExample: boolean;
  suggestedTarget: SuggestedImportTarget;
  targetTerminology: boolean;
  targetData: boolean;
  category: string;
  importNote: string;
  selected: boolean;
}

export interface ImportSelectionSummary {
  terminologyCount: number;
  dataCount: number;
  mergedSingleEndpoint: boolean;
}
