// Author: Preston Lee

import { describe, expect, it } from 'vitest';
import { VENDOR_ENVIRONMENT_PRESETS } from './vendor-environment-presets';

describe('VENDOR_ENVIRONMENT_PRESETS', () => {
  it('includes Firely, HL7 Quality R4, and Smile with HTTPS evaluation URLs and notes', () => {
    expect(VENDOR_ENVIRONMENT_PRESETS.map(p => p.id)).toEqual([
      'smile-cds-sandbox',
      'firely-public-development',
      'hl7-quality-r4',
    ]);
    for (const preset of VENDOR_ENVIRONMENT_PRESETS) {
      expect(preset.name.trim().length).toBeGreaterThan(0);
      expect(preset.evaluationServerUrl.startsWith('https://')).toBe(true);
      expect(preset.notes.trim().length).toBeGreaterThan(0);
    }
  });

  it('points Firely content and terminology at the administration API', () => {
    const firely = VENDOR_ENVIRONMENT_PRESETS.find(p => p.id === 'firely-public-development');
    expect(firely).toBeDefined();
    expect(firely!.evaluationServerUrl).toBe('https://server.fire.ly/R4');
    expect(firely!.contentEndpointUrl).toBe('https://server.fire.ly/administration');
    expect(firely!.terminologyEndpointUrl).toBe('https://server.fire.ly/administration');
    expect(firely!.dataEndpointUrl).toBeUndefined();
    expect(firely!.notes).toContain('Different base URLs');
    expect(firely!.notes).toContain('administration');
  });

  it('documents HL7 Quality R4 as a shared HAPI server with a single base URL', () => {
    const hl7 = VENDOR_ENVIRONMENT_PRESETS.find(p => p.id === 'hl7-quality-r4');
    expect(hl7).toBeDefined();
    expect(hl7!.notes).toMatch(/HAPI FHIR/i);
    expect(hl7!.notes).toMatch(/wiped periodically/i);
    expect(hl7!.notes).toMatch(/single base URL/i);
    expect(hl7!.contentEndpointUrl).toBeUndefined();
    expect(hl7!.terminologyEndpointUrl).toBeUndefined();
  });
});
