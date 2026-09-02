// Author: Preston Lee

/** eCQM-style measure population define names shared by transpiler and compatibility checks. */
export const MEASURE_POPULATION_NAMES = [
  'Initial Population',
  'Denominator',
  'Denominator Exclusion',
  'Denominator Exception',
  'Numerator',
  'Numerator Exclusion',
  'Measure Population',
  'Measure Population Exclusion',
  'Measure Observation',
  'Stratification',
] as const;

export function isStandardPopulationName(name: string): boolean {
  return MEASURE_POPULATION_NAMES.some(p => p.toLowerCase() === name.toLowerCase());
}
