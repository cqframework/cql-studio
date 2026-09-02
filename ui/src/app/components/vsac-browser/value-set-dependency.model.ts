// Author: Preston Lee

import { ValueSet } from 'fhir/r4';

export type ValueSetDependencyRelation = 'root' | 'include' | 'exclude';
export type ValueSetDependencyStatus =
  | 'ideal'
  | 'conditional'
  | 'questionable'
  | 'reference'
  | 'external'
  | 'duplicate'
  | 'cycle'
  | 'error';

export interface ValueSetDependencyNode {
  key: string;
  relation: ValueSetDependencyRelation;
  reference?: string;
  valueSet: ValueSet | null;
  children: ValueSetDependencyNode[];
  status: ValueSetDependencyStatus;
  statusHint: string;
}

export interface ValueSetDependencyRef {
  relation: Exclude<ValueSetDependencyRelation, 'root'>;
  reference: string;
}

export interface ValueSetDependencyTreeRow {
  node: ValueSetDependencyNode;
  depth: number;
}
