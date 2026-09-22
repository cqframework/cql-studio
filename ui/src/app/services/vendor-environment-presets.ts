// Author: Preston Lee

export interface VendorEnvironmentPreset {
  id: string;
  name: string;
  evaluationServerUrl: string;
  /** When set, overrides evaluation-server fallback for Library / content CRUD. */
  contentEndpointUrl?: string;
  /** When set, overrides evaluation-server fallback for ValueSet / CodeSystem CRUD. */
  terminologyEndpointUrl?: string;
  /** When set, overrides evaluation-server fallback for patient data. */
  dataEndpointUrl?: string;
  /** Markdown notes shown in the add-preset confirmation dialog. */
  notes: string;
}

/**
 * Public FHIR R4 servers verified to advertise and accept Library/$evaluate.
 * Secondary endpoints are omitted when they share the evaluation base URL
 * (effective address falls back to evaluation). Firely is the exception:
 * Library and terminology resources must be written to /administration even
 * though $evaluate is invoked on the main FHIR endpoint.
 */
export const VENDOR_ENVIRONMENT_PRESETS: readonly VendorEnvironmentPreset[] = [
  {
    id: 'smile-cds-sandbox',
    name: 'Smile Public CDS Sandbox',
    evaluationServerUrl: 'https://cloud.alphora.com/sandbox/r4/cds/fhir',
    notes: [
      'Public Smile CDS sandbox for FHIR R4 clinical decision support and CQL evaluation, provided and maintained by Smile Digital Health.',
      '',
      'This preset uses a **single base URL** for evaluation, content, terminology, and data, and should work with CQL Studio without additional configuration.',
    ].join('\n'),
  },
  {
    id: 'firely-public-development',
    name: 'Firely Public Development',
    evaluationServerUrl: 'https://server.fire.ly/R4',
    contentEndpointUrl: 'https://server.fire.ly/administration',
    terminologyEndpointUrl: 'https://server.fire.ly/administration',
    notes: [
      'Firely public development server for FHIR R4, operated and maintained by Fire.ly. All issues related to this environment should be reported to Fire.ly.',
      '',
      'Note that instances of Fire.ly have different base URLs for FHIR Library and terminology-related resources. Certain aspects of CQL Studio may not work as expected, depending on context.',
    ].join('\n'),
  },
  {
    id: 'hl7-quality-r4',
    name: 'HL7 Quality R4',
    evaluationServerUrl: 'https://r4.quality.hl7.org/fhir',
    notes: [
      'Public, shared **HAPI FHIR** server for quality-measure work, operated by HL7. Issues with FHIR-related behavior of the server should be reported to the HAPI project, largely maintained by Smile Digital Health.',
      '',
      'This preset uses a **single base URL** for evaluation, content, terminology, and data, and should work with CQL Studio without additional configuration.',
      '',
      '**Important:** this is a shared instance and is **wiped periodically**. Do not rely on it for durable storage.',
    ].join('\n'),
  },
];
