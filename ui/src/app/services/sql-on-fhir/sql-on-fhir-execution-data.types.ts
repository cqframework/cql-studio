// Author: Preston Lee

import type { Bundle } from 'fhir/r4';
import type { FlatRow } from './sql-on-fhir-bundle-flattener.lib';

export interface ExecutionSeedData {
  dataKey: string;
  bundle: Bundle;
  valueSetRows: FlatRow[];
}
