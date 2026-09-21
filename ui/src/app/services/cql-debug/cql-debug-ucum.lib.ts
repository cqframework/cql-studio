// Author: Preston Lee

// @ts-expect-error No type definitions available for @lhncbc/ucum-lhc
import * as ucum from '@lhncbc/ucum-lhc';
import { createUcumService } from '@cqframework/cql/cql-to-elm';
import { BigDecimal } from '@cqframework/cql/shared';
import * as KtStdlib from '@cqframework/cql/kotlin-kotlin-stdlib';
import { Pair } from '@cqframework/cql/kotlin-kotlin-stdlib';

type CqlBigDecimal = ReturnType<typeof BigDecimal.fromString>;
type UcumQuantityPair = Pair<CqlBigDecimal, string>;

interface UcumBaseResult {
  status: string;
  magnitude?: number;
  unitToExp?: Record<string, number>;
  msg?: string[];
}

interface UcumConvertResult {
  status: string;
  toVal?: number | null;
  msg?: string[];
}

interface UcumValidateResult {
  status: string;
  msg?: string[];
}

/**
 * ConvertQuantityEvaluator catches Kotlin Exception and returns null for incompatible
 * units. A plain JS Error is not instanceof Kotlin Exception, so it aborts evaluation.
 */
function throwKotlinException(message: string): never {
  const ExceptionCtor = Object.values(KtStdlib).find(value => {
    if (typeof value !== 'function') {
      return false;
    }
    const meta = (value as { $metadata$?: { simpleName?: string } }).$metadata$;
    return meta?.simpleName === 'Exception';
  }) as (new (msg: string) => Error) | undefined;
  if (ExceptionCtor) {
    throw new ExceptionCtor(message);
  }
  throw new Error(message);
}

function pairParts(pair: UcumQuantityPair): [unknown, string] {
  const record = pair as unknown as {
    first?: unknown;
    second?: unknown;
    a_1?: unknown;
    b_1?: unknown;
  };
  const value = record.first ?? record.a_1;
  const unit = String(record.second ?? record.b_1 ?? '1');
  return [value, unit];
}

function toPlainNumber(value: unknown): number {
  if (value != null && typeof value === 'object' && 'toPlainString' in value) {
    return Number((value as { toPlainString: () => string }).toPlainString());
  }
  return Number(String(value));
}

function toBigDecimal(value: number): CqlBigDecimal {
  return BigDecimal.fromString(Number.isFinite(value) ? String(value) : '0');
}

function formatUnitExponents(unitToExp: Record<string, number>): string {
  const parts: string[] = [];
  for (const [unit, exp] of Object.entries(unitToExp)) {
    if (!exp) {
      continue;
    }
    parts.push(exp === 1 ? unit : `${unit}${exp}`);
  }
  return parts.length > 0 ? parts.join('.') : '1';
}

function combineQuantities(
  op: '*' | '/',
  left: UcumQuantityPair,
  right: UcumQuantityPair
): UcumQuantityPair {
  const utils = ucum.UcumLhcUtils.getInstance();
  const [leftValue, leftUnit] = pairParts(left);
  const [rightValue, rightUnit] = pairParts(right);
  const leftBase = utils.convertToBaseUnits(leftUnit, toPlainNumber(leftValue)) as UcumBaseResult;
  const rightBase = utils.convertToBaseUnits(rightUnit, toPlainNumber(rightValue)) as UcumBaseResult;
  if (leftBase.status !== 'succeeded' || rightBase.status !== 'succeeded') {
    const detail = [...(leftBase.msg ?? []), ...(rightBase.msg ?? [])].join('; ');
    throwKotlinException(
      `UCUM ${op === '*' ? 'multiply' : 'divide'} failed: ${detail || 'incompatible units'}`
    );
  }

  const magnitude =
    op === '*'
      ? (leftBase.magnitude ?? 0) * (rightBase.magnitude ?? 0)
      : (leftBase.magnitude ?? 0) / (rightBase.magnitude ?? 0);

  const exponents: Record<string, number> = { ...(leftBase.unitToExp ?? {}) };
  for (const [unit, exp] of Object.entries(rightBase.unitToExp ?? {})) {
    const next = (exponents[unit] ?? 0) + (op === '*' ? Number(exp) : -Number(exp));
    if (next === 0) {
      delete exponents[unit];
    } else {
      exponents[unit] = next;
    }
  }

  return new Pair(toBigDecimal(magnitude), formatUnitExponents(exponents)) as UcumQuantityPair;
}

/**
 * Evaluation-capable UCUM wiring for the debug worker.
 * Incompatible converts throw Kotlin Exception so ConvertQuantityEvaluator returns null
 * (CQL semantics) instead of aborting the whole library evaluation.
 */
export function createDebugUcumService(): ReturnType<typeof createUcumService> {
  const ucumUtils = ucum.UcumLhcUtils.getInstance();

  const convertUnit = (value: string, sourceUnit: string, destUnit: string): string => {
    const result = ucumUtils.convertUnitTo(sourceUnit, Number(value), destUnit) as UcumConvertResult;
    if (result.status !== 'succeeded' || result.toVal == null) {
      throwKotlinException(result.msg?.[0] ?? `UCUM convert failed: ${sourceUnit} → ${destUnit}`);
    }
    return String(result.toVal);
  };

  const validateUnit = (unit: string): string | null => {
    const result = ucumUtils.validateUnitString(unit) as UcumValidateResult;
    if (result.status === 'valid') {
      return null;
    }
    return result.msg?.[0] ?? `Invalid UCUM unit: ${unit}`;
  };

  const multiply = (left: UcumQuantityPair, right: UcumQuantityPair): UcumQuantityPair =>
    combineQuantities('*', left, right);
  const divideBy = (left: UcumQuantityPair, right: UcumQuantityPair): UcumQuantityPair =>
    combineQuantities('/', left, right);

  return createUcumService(
    convertUnit,
    validateUnit,
    multiply as Parameters<typeof createUcumService>[2],
    divideBy as Parameters<typeof createUcumService>[3]
  );
}
