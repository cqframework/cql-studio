// Author: Preston Lee

import { describe, expect, it } from 'vitest';
import { VENDOR_ENVIRONMENT_PRESETS } from './vendor-environment-presets';

describe('VENDOR_ENVIRONMENT_PRESETS', () => {
  it('includes Firely, HL7 Quality R4, and Alphora with HTTPS evaluation URLs', () => {
    expect(VENDOR_ENVIRONMENT_PRESETS.map(p => p.id)).toEqual([
      'firely-public-development',
      'hl7-quality-r4',
      'alphora-cds-sandbox',
    ]);
    for (const preset of VENDOR_ENVIRONMENT_PRESETS) {
      expect(preset.name.trim().length).toBeGreaterThan(0);
      expect(preset.evaluationServerUrl.startsWith('https://')).toBe(true);
    }
  });
});
