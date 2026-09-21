// Author: Preston Lee

import { BigDecimal } from '@cqframework/cql/shared';

type RoundingModeLike = { toKtRoundingMode?: () => unknown; toString?: () => string };

type BigDecimalLike = {
  scale: () => number;
  toPlainString?: () => string;
  toDouble: () => number;
};

type BigDecimalProto = BigDecimalLike & {
  p2y: (scale: number, roundingMode: RoundingModeLike) => unknown;
  q2y: (value: unknown) => unknown;
  r2y: (value: unknown, scale: number, roundingMode: RoundingModeLike) => unknown;
};

let patchesApplied = false;

function asBigDecimalLike(value: unknown, label: string): BigDecimalLike {
  const candidate = value as BigDecimalLike | null;
  if (
    candidate == null ||
    typeof candidate.toDouble !== 'function' ||
    typeof candidate.scale !== 'function'
  ) {
    throw new Error(`Expected BigDecimal for ${label}`);
  }
  return candidate;
}

/**
 * Work around @cqframework/cql@5.3.0 KMP BigDecimal gaps that distort PREVENT / eGFR math:
 *
 * 1. fromDouble values report scale() < 0 → DecimalHelper.q9i FLOOR-scales to 0 (Ln/Power).
 * 2. Exact divide (q2y) silently truncates (1.2/0.9 → 1.3) instead of throwing.
 * 3. Scaled divide fallback (r2y) always returns 0 (broken DecimalMode wiring), so
 *    Sigmoid / Exp(x)/(1+Exp(x)) becomes 0 when exact divide does throw.
 */
export function applyCqlEngineRuntimePatches(): void {
  if (patchesApplied) {
    return;
  }
  patchesApplied = true;

  const proto = Object.getPrototypeOf(BigDecimal.fromString('1')) as BigDecimalProto;
  const originalScale = proto.scale;
  proto.scale = function patchedScale(this: BigDecimalProto): number {
    const scale = originalScale.call(this);
    if (scale >= 0) {
      return scale;
    }
    const plain = typeof this.toPlainString === 'function' ? this.toPlainString() : String(this);
    const dot = plain.indexOf('.');
    if (dot >= 0) {
      return plain.length - dot - 1;
    }
    // Avoid DecimalHelper.q9i floor-to-integer path for scientific fromDouble values.
    return 0;
  };

  const divideWithScale = (
    leftBd: BigDecimalLike,
    rightBd: BigDecimalLike,
    scale: number,
    roundingMode: RoundingModeLike
  ): ReturnType<typeof BigDecimal.fromString> => {
    const right = rightBd.toDouble();
    if (right === 0 || !Number.isFinite(right)) {
      throw new Error('Division by zero');
    }
    const left = leftBd.toDouble();
    if (!Number.isFinite(left)) {
      throw new Error('Division with non-finite operand');
    }
    const raw = left / right;
    const safeScale = Number.isFinite(scale) && scale >= 0 ? Math.min(Math.trunc(scale), 16) : 8;
    const factor = 10 ** safeScale;
    const mode = String(roundingMode?.toString?.() ?? roundingMode ?? '').toUpperCase();
    let scaled: number;
    if (mode.includes('CEILING')) {
      scaled = Math.ceil(raw * factor);
    } else if (mode.includes('HALF_UP') || mode.includes('HALF_EVEN')) {
      scaled = Math.round(raw * factor);
    } else if (mode.includes('DOWN') || mode.includes('TOWARD')) {
      scaled = raw >= 0 ? Math.floor(raw * factor) : Math.ceil(raw * factor);
    } else {
      // FLOOR (CQL Divide fallback) and default
      scaled = Math.floor(raw * factor);
    }
    const plain = (scaled / factor).toFixed(safeScale);
    return BigDecimal.fromString(plain);
  };

  proto.r2y = function patchedDivideWithScale(
    this: BigDecimalProto,
    value: unknown,
    scale: number,
    roundingMode: RoundingModeLike
  ): unknown {
    return divideWithScale(this, asBigDecimalLike(value, 'divisor'), scale, roundingMode);
  };

  // KMP exact divide silently truncates (1.2/0.9 → 1.3 at scale 1). Always use ≥8 dp.
  proto.q2y = function patchedDivide(this: BigDecimalProto, value: unknown): unknown {
    const right = asBigDecimalLike(value, 'divisor');
    const scale = Math.max(8, this.scale(), right.scale());
    return divideWithScale(this, right, scale, { toString: () => 'FLOOR' });
  };
}
