// Author: Preston Lee

export interface VendorEnvironmentPreset {
  id: string;
  name: string;
  evaluationServerUrl: string;
}

/** Public FHIR R4 servers verified to advertise and accept Library/$evaluate. */
export const VENDOR_ENVIRONMENT_PRESETS: readonly VendorEnvironmentPreset[] = [
  {
    id: 'firely-public-development',
    name: 'Firely Public Development',
    evaluationServerUrl: 'https://server.fire.ly/R4',
  },
  {
    id: 'hl7-quality-r4',
    name: 'HL7 Quality R4',
    evaluationServerUrl: 'https://r4.quality.hl7.org/fhir',
  },
  {
    id: 'alphora-cds-sandbox',
    name: 'Alphora CDS Sandbox',
    evaluationServerUrl: 'https://cloud.alphora.com/sandbox/r4/cds/fhir',
  },
];
