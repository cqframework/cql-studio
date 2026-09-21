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

export type FetchValueSetByRef = (reference: string) => Promise<ValueSet>;

export function normalizeValueSetKey(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return 'unknown';
  return /^https?:\/\//i.test(trimmed) ? trimmed.toLowerCase() : trimmed.replace(/^urn:oid:/i, '').toLowerCase();
}

export function valueSetKey(vs: ValueSet, fallback: string): string {
  const preferred = vs.url || vs.id || fallback;
  return normalizeValueSetKey(preferred);
}

export function valueSetDisplayName(vs: ValueSet): string {
  return vs.title || vs.name || vs.id || vs.url || 'ValueSet';
}

export function extractComposeValueSetReferences(vs: ValueSet): ValueSetDependencyRef[] {
  const refs: ValueSetDependencyRef[] = [];
  for (const inc of vs.compose?.include ?? []) {
    for (const ref of inc.valueSet ?? []) {
      if (ref?.trim()) refs.push({ relation: 'include', reference: ref.trim() });
    }
  }
  for (const exc of vs.compose?.exclude ?? []) {
    for (const ref of exc.valueSet ?? []) {
      if (ref?.trim()) refs.push({ relation: 'exclude', reference: ref.trim() });
    }
  }
  return refs;
}

export function classifyDependencyNode(
  vs: ValueSet | null,
  children: ValueSetDependencyNode[]
): { status: ValueSetDependencyStatus; hint: string } {
  if (!vs?.compose) {
    return { status: 'conditional', hint: 'No compose definition found; import behavior depends on server support.' };
  }
  const includes = vs.compose.include ?? [];
  const excludes = vs.compose.exclude ?? [];
  const hasConcept = includes.some((i) => (i.concept?.length ?? 0) > 0);
  const hasFilter = includes.some((i) => (i.filter?.length ?? 0) > 0);
  const hasValueSetRefs = extractComposeValueSetReferences(vs).length > 0;
  const hasWholeSystem = includes.some((i) => !!i.system && (i.concept?.length ?? 0) === 0 && (i.filter?.length ?? 0) === 0);
  const hasWildcardVersion = includes.some((i) => i.version === '*');
  const hasUnresolvedChild = children.some((c) => c.status === 'external' || c.status === 'error');
  if (hasUnresolvedChild) {
    return { status: 'conditional', hint: 'Some dependencies are unresolved and may not import correctly.' };
  }
  if (hasWholeSystem) {
    return { status: 'questionable', hint: 'Includes an entire code system; target server must provide the code system content.' };
  }
  if (hasFilter) {
    return { status: 'conditional', hint: 'Uses filter-based criteria; expansion depends on terminology server capabilities.' };
  }
  if (hasWildcardVersion || (!!includes.length && !vs.compose.lockedDate && includes.some((i) => !i.version))) {
    return { status: 'conditional', hint: 'Not fully version-locked (missing include version or lockedDate).' };
  }
  if (hasConcept) {
    return { status: 'ideal', hint: 'Contains explicit concepts/codes and should import predictably.' };
  }
  if (hasValueSetRefs) {
    return {
      status: 'reference',
      hint:
        excludes.length > 0
          ? 'References dependent value sets and has excludes; imports depend on recursive processing.'
          : 'References dependent value sets; imports depend on recursive processing.'
    };
  }
  return { status: 'conditional', hint: 'Compose semantics require server-side expansion behavior.' };
}

async function fetchDependencyChildren(
  vs: ValueSet,
  pathKeys: string[],
  visited: Set<string>,
  fetchCache: Map<string, ValueSet>,
  fetchValueSet: FetchValueSetByRef
): Promise<ValueSetDependencyNode[]> {
  const refs = extractComposeValueSetReferences(vs);
  const children: ValueSetDependencyNode[] = [];
  for (const ref of refs) {
    children.push(await fetchDependencyNode(ref, pathKeys, visited, fetchCache, fetchValueSet));
  }
  return children;
}

async function fetchDependencyNode(
  ref: ValueSetDependencyRef,
  pathKeys: string[],
  visited: Set<string>,
  fetchCache: Map<string, ValueSet>,
  fetchValueSet: FetchValueSetByRef
): Promise<ValueSetDependencyNode> {
  const refKey = normalizeValueSetKey(ref.reference);
  if (pathKeys.includes(refKey)) {
    return {
      key: refKey,
      relation: ref.relation,
      reference: ref.reference,
      valueSet: null,
      children: [],
      status: 'cycle',
      statusHint: 'Reference cycle detected.'
    };
  }
  let fetched: ValueSet | null = fetchCache.get(refKey) ?? null;
  if (!fetched) {
    try {
      fetched = await fetchValueSet(ref.reference);
      fetchCache.set(refKey, fetched);
    } catch {
      return {
        key: refKey,
        relation: ref.relation,
        reference: ref.reference,
        valueSet: null,
        children: [],
        status: 'external',
        statusHint: 'Reference could not be resolved as a FHIR ValueSet resource.'
      };
    }
  }
  const key = valueSetKey(fetched, ref.reference);
  if (pathKeys.includes(key)) {
    return {
      key,
      relation: ref.relation,
      reference: ref.reference,
      valueSet: fetched,
      children: [],
      status: 'cycle',
      statusHint: 'Reference cycle detected.'
    };
  }
  if (visited.has(key)) {
    return {
      key,
      relation: ref.relation,
      reference: ref.reference,
      valueSet: fetched,
      children: [],
      status: 'duplicate',
      statusHint: 'Already referenced elsewhere in this tree.'
    };
  }
  visited.add(key);
  const children = await fetchDependencyChildren(fetched, [...pathKeys, key], visited, fetchCache, fetchValueSet);
  const classification = classifyDependencyNode(fetched, children);
  return {
    key,
    relation: ref.relation,
    reference: ref.reference,
    valueSet: fetched,
    children,
    status: classification.status,
    statusHint: classification.hint
  };
}

/** Build a dependency tree for a loaded ValueSet using a provider-specific fetch. */
export async function buildValueSetDependencyTree(
  root: ValueSet,
  fetchValueSet: FetchValueSetByRef
): Promise<ValueSetDependencyNode> {
  const visited = new Set<string>();
  const fetchCache = new Map<string, ValueSet>();
  const rootKey = valueSetKey(root, root.url || root.id || 'loaded-valueset');
  visited.add(rootKey);
  const rootNode: ValueSetDependencyNode = {
    key: rootKey,
    relation: 'root',
    valueSet: root,
    children: [],
    status: 'reference',
    statusHint: ''
  };
  rootNode.children = await fetchDependencyChildren(root, [rootKey], visited, fetchCache, fetchValueSet);
  const classification = classifyDependencyNode(rootNode.valueSet, rootNode.children);
  rootNode.status = classification.status;
  rootNode.statusHint = classification.hint;
  return rootNode;
}

export function collectImportableDependencyNodes(root: ValueSetDependencyNode): ValueSetDependencyNode[] {
  const out: ValueSetDependencyNode[] = [];
  const seen = new Set<string>();
  const walk = (node: ValueSetDependencyNode) => {
    for (const child of node.children) {
      walk(child);
    }
    if (seen.has(node.key) || !node.valueSet) return;
    if (node.status === 'error' || node.status === 'cycle' || node.status === 'duplicate' || node.status === 'external') {
      return;
    }
    seen.add(node.key);
    out.push(node);
  };
  walk(root);
  return out;
}
