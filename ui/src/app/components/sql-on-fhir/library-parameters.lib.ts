// Author: Preston Lee

import type { Library } from 'fhir/r4';
import type { ElmLibrary, ElmLibraryWrapper, ElmParameterDef } from './elm-to-sql/types/elm';

export type ParameterValueKind =
  | 'period'
  | 'dateTime'
  | 'string'
  | 'boolean'
  | 'integer'
  | 'decimal'
  | 'unsupported';

export interface PeriodParameterValue {
  kind: 'period';
  start: string;
  end: string;
}

export interface DateTimeParameterValue {
  kind: 'dateTime';
  value: string;
}

export interface StringParameterValue {
  kind: 'string';
  value: string;
}

export interface BooleanParameterValue {
  kind: 'boolean';
  value: boolean;
}

export interface IntegerParameterValue {
  kind: 'integer';
  value: number;
}

export interface DecimalParameterValue {
  kind: 'decimal';
  value: number;
}

export interface UnsupportedParameterValue {
  kind: 'unsupported';
  raw?: string;
}

export type ParameterValue =
  | PeriodParameterValue
  | DateTimeParameterValue
  | StringParameterValue
  | BooleanParameterValue
  | IntegerParameterValue
  | DecimalParameterValue
  | UnsupportedParameterValue;

export type LibraryParameterValues = Record<string, ParameterValue>;

export interface LibraryParameterSpec {
  name: string;
  fhirType?: string;
  cqlType?: string;
  required: boolean;
  referenced: boolean;
  valueKind: ParameterValueKind;
}

function resolveLibrary(input: ElmLibraryWrapper | ElmLibrary | string | null): ElmLibrary | null {
  if (!input) {
    return null;
  }
  if (typeof input === 'string') {
    if (!input.trim()) {
      return null;
    }
    try {
      const parsed = JSON.parse(input) as ElmLibraryWrapper | ElmLibrary;
      return 'library' in parsed ? parsed.library : parsed;
    } catch {
      return null;
    }
  }
  return 'library' in input ? input.library : input;
}

export function extractReferencedParameterNames(elmJson: string | null): Set<string> {
  const names = new Set<string>();
  if (!elmJson?.trim()) {
    return names;
  }
  const pattern = /"type"\s*:\s*"ParameterRef"[^}]*?"name"\s*:\s*"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(elmJson)) !== null) {
    names.add(match[1]);
  }
  return names;
}

function cqlTypeLabel(def: ElmParameterDef | undefined): string | undefined {
  const spec = def?.parameterTypeSpecifier;
  if (!spec) {
    return undefined;
  }
  const pointSpec =
    ('pointType' in spec && spec.pointType) ||
    ('elementType' in spec && spec.elementType);
  if (pointSpec && typeof pointSpec === 'object' && 'name' in pointSpec) {
    const point = (pointSpec as { name?: string }).name ?? '';
    const pointName = point.replace(/.*}/, '');
    return `Interval<${pointName}>`;
  }
  if ('name' in spec && typeof spec.name === 'string') {
    return spec.name.replace(/.*}/, '');
  }
  return undefined;
}

function inferValueKind(fhirType: string | undefined, cqlType: string | undefined): ParameterValueKind {
  const combined = `${fhirType ?? ''} ${cqlType ?? ''}`.toLowerCase();
  if (combined.includes('period') || combined.includes('interval')) {
    return 'period';
  }
  if (combined.includes('datetime') || combined.includes('date')) {
    return 'dateTime';
  }
  if (combined.includes('boolean')) {
    return 'boolean';
  }
  if (combined.includes('integer')) {
    return 'integer';
  }
  if (combined.includes('decimal') || combined.includes('quantity')) {
    return 'decimal';
  }
  if (combined.includes('string')) {
    return 'string';
  }
  return 'unsupported';
}

function defaultCalendarYearPeriod(): PeriodParameterValue {
  const year = new Date().getFullYear();
  return {
    kind: 'period',
    start: `${year}-01-01T00:00:00Z`,
    end: `${year}-12-31T23:59:59Z`,
  };
}

function defaultFromFhirParameter(library: Library | null, name: string): ParameterValue | null {
  const param = library?.parameter?.find(p => p.name === name);
  const fromExt = param?.extension?.find(e => /defaultValue/i.test(e.url ?? ''));
  if (fromExt?.valuePeriod?.start && fromExt?.valuePeriod?.end) {
    return { kind: 'period', start: fromExt.valuePeriod.start, end: fromExt.valuePeriod.end };
  }
  if (fromExt?.valueDateTime) {
    return { kind: 'dateTime', value: fromExt.valueDateTime };
  }
  if (fromExt?.valueString != null) {
    return { kind: 'string', value: fromExt.valueString };
  }
  if (fromExt?.valueBoolean != null) {
    return { kind: 'boolean', value: fromExt.valueBoolean };
  }
  if (fromExt?.valueInteger != null) {
    return { kind: 'integer', value: fromExt.valueInteger };
  }
  if (fromExt?.valueDecimal != null) {
    return { kind: 'decimal', value: fromExt.valueDecimal };
  }
  return null;
}

function defaultFromElmParameter(def: ElmParameterDef | undefined): ParameterValue | null {
  const expr = def?.default;
  if (!expr) {
    return null;
  }
  if (expr.type === 'Interval' && 'low' in expr && 'high' in expr) {
    const low = expr.low as { type?: string; value?: string } | undefined;
    const high = expr.high as { type?: string; value?: string } | undefined;
    if (low?.type === 'Literal' && high?.type === 'Literal' && low.value && high.value) {
      return { kind: 'period', start: low.value, end: high.value };
    }
  }
  if (expr.type === 'Literal' && 'value' in expr && expr.value != null) {
    const valueType = (expr as { valueType?: string }).valueType ?? '';
    if (valueType.includes('DateTime') || valueType.includes('Date')) {
      return { kind: 'dateTime', value: String(expr.value) };
    }
    if (valueType.includes('Boolean')) {
      return { kind: 'boolean', value: String(expr.value) === 'true' };
    }
    if (valueType.includes('Integer')) {
      return { kind: 'integer', value: Number(expr.value) };
    }
    if (valueType.includes('Decimal')) {
      return { kind: 'decimal', value: Number(expr.value) };
    }
    return { kind: 'string', value: String(expr.value) };
  }
  return null;
}

export function buildLibraryParameterSpecs(
  library: Library | null,
  elmJson: string | null,
): LibraryParameterSpec[] {
  const elm = elmJson?.trim() ? resolveLibrary(elmJson) : null;
  const referenced = extractReferencedParameterNames(elmJson);
  const elmParams = elm?.parameters?.def ?? [];
  const fhirParams = library?.parameter ?? [];
  const names = new Set<string>();
  for (const p of fhirParams) {
    if (p.name) {
      names.add(p.name);
    }
  }
  for (const p of elmParams) {
    if (p.name) {
      names.add(p.name);
    }
  }
  for (const name of referenced) {
    names.add(name);
  }

  return [...names].sort().map(name => {
    const fhir = fhirParams.find(p => p.name === name);
    const elmDef = elmParams.find(p => p.name === name);
    const cqlType = cqlTypeLabel(elmDef);
    const fhirType = fhir?.type;
    const valueKind = inferValueKind(fhirType, cqlType);
    const min = fhir?.min ?? 0;
    return {
      name,
      fhirType,
      cqlType,
      required: min > 0 || referenced.has(name),
      referenced: referenced.has(name),
      valueKind,
    };
  });
}

export function buildDefaultParameterValues(
  specs: LibraryParameterSpec[],
  library: Library | null,
  elmJson: string | null,
): LibraryParameterValues {
  const elm = elmJson?.trim() ? resolveLibrary(elmJson) : null;
  const values: LibraryParameterValues = {};
  for (const spec of specs) {
    const elmDef = elm?.parameters?.def?.find(p => p.name === spec.name);
    const fromFhir = defaultFromFhirParameter(library, spec.name);
    const fromElm = defaultFromElmParameter(elmDef);
    let value = fromFhir ?? fromElm;
    if (!value && spec.name === 'Measurement Period' && spec.valueKind === 'period') {
      value = defaultCalendarYearPeriod();
    }
    if (!value) {
      switch (spec.valueKind) {
        case 'period':
          value = defaultCalendarYearPeriod();
          break;
        case 'string':
          value = { kind: 'string', value: '' };
          break;
        case 'boolean':
          value = { kind: 'boolean', value: false };
          break;
        case 'integer':
          value = { kind: 'integer', value: 0 };
          break;
        case 'decimal':
          value = { kind: 'decimal', value: 0 };
          break;
        case 'dateTime':
          value = { kind: 'dateTime', value: new Date().toISOString() };
          break;
        default:
          value = { kind: 'unsupported' };
      }
    }
    values[spec.name] = value;
  }
  return values;
}

export function measurementPeriodFromValues(values: LibraryParameterValues): { start: string; end: string } {
  const mp = values['Measurement Period'];
  if (mp?.kind === 'period') {
    return { start: mp.start, end: mp.end };
  }
  return defaultCalendarYearPeriod();
}

export function parameterValueToSqlLiteral(name: string, value: ParameterValue | undefined): string | null {
  if (!value) {
    return null;
  }
  switch (value.kind) {
    case 'period':
      if (name === 'Measurement Period') {
        return `tstzrange('${value.start}', '${value.end}', '[)')`;
      }
      return `tstzrange('${value.start}', '${value.end}', '[)')`;
    case 'dateTime':
      return `'${value.value}'::timestamptz`;
    case 'string':
      return `'${value.value.replace(/'/g, "''")}'`;
    case 'boolean':
      return value.value ? 'TRUE' : 'FALSE';
    case 'integer':
      return String(Math.trunc(value.value));
    case 'decimal':
      return String(value.value);
    default:
      return null;
  }
}

export function isParameterValueSupported(value: ParameterValue | undefined): boolean {
  return value != null && value.kind !== 'unsupported';
}
