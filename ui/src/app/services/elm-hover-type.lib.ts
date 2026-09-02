// Author: Preston Lee

import { CqlDefinitionKind, parseLocator } from './elm-locator.lib';

export interface ElmOperandInfo {
  name: string;
  typeName: string | null;
}

export interface ElmHoverTypeInfo {
  name: string;
  kind: CqlDefinitionKind;
  resultType: string | null;
  operands: ElmOperandInfo[];
}

function attrType(element: Element): string {
  return (
    element.getAttribute('xsi:type') ??
    element.getAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'type') ??
    ''
  );
}

function readResultType(element: Element): string | null {
  const direct =
    element.getAttribute('resultTypeName') ??
    element.getAttribute('resultType') ??
    null;
  if (direct?.trim()) {
    return direct.trim();
  }
  for (const child of Array.from(element.children)) {
    const local = child.localName || child.tagName;
    if (local === 'resultTypeSpecifier' || local.endsWith(':resultTypeSpecifier')) {
      const name =
        child.getAttribute('name') ??
        child.getAttribute('elementType') ??
        child.getAttribute('type');
      return name?.trim() || attrType(child) || null;
    }
  }
  return null;
}

function readOperands(def: Element): ElmOperandInfo[] {
  const operands: ElmOperandInfo[] = [];
  for (const child of Array.from(def.children)) {
    const local = child.localName || child.tagName;
    if (local !== 'operand' && !local.endsWith(':operand')) {
      continue;
    }
    const name = child.getAttribute('name');
    if (!name) {
      continue;
    }
    operands.push({
      name,
      typeName: readResultType(child) ?? child.getAttribute('operandTypeSpecifier') ?? null
    });
  }
  return operands;
}

/**
 * Extract hover type/signature info from ELM XML for definitions.
 */
export function extractElmHoverTypeInfos(elmXml: string): Map<string, ElmHoverTypeInfo[]> {
  const map = new Map<string, ElmHoverTypeInfo[]>();
  if (!elmXml?.trim()) {
    return map;
  }

  const doc = new DOMParser().parseFromString(elmXml, 'application/xml');
  if (doc.querySelector('parsererror')) {
    return map;
  }

  const add = (info: ElmHoverTypeInfo): void => {
    const existing = map.get(info.name) ?? [];
    existing.push(info);
    map.set(info.name, existing);
  };

  for (const def of doc.querySelectorAll('statements > def')) {
    const name = def.getAttribute('name');
    const locator = def.getAttribute('locator');
    if (!name || !parseLocator(locator)) {
      continue;
    }
    const typeAttr = attrType(def);
    const kind: CqlDefinitionKind = typeAttr.includes('FunctionDef') ? 'function' : 'expression';
    add({
      name,
      kind,
      resultType: readResultType(def),
      operands: kind === 'function' ? readOperands(def) : []
    });
  }

  for (const def of doc.querySelectorAll('contexts > def')) {
    const name = def.getAttribute('name');
    if (!name) {
      continue;
    }
    add({
      name,
      kind: 'context',
      resultType: readResultType(def),
      operands: []
    });
  }

  return map;
}

export function formatHoverTypeInfo(info: ElmHoverTypeInfo): string {
  const kindLabel =
    info.kind === 'function' ? 'function' : info.kind === 'context' ? 'context' : 'define';
  if (info.kind === 'function') {
    const args = info.operands
      .map(op => (op.typeName ? `${op.name}: ${op.typeName}` : op.name))
      .join(', ');
    const ret = info.resultType ? `: ${info.resultType}` : '';
    return `${kindLabel} ${info.name}(${args})${ret}`;
  }
  if (info.resultType) {
    return `${kindLabel} ${info.name}: ${info.resultType}`;
  }
  return `${kindLabel} ${info.name}`;
}
