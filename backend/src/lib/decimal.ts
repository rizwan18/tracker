/**
 * Decimal arithmetic for money and share quantities.
 *
 * Binary floats can't represent most decimal fractions (0.1 + 0.2 !== 0.3), so any figure that is stored, summed or
 * compared for equality goes through this instead. Precision is generous, and ties round half-up (the way brokers and
 * banks round to the cent).
 */
import Decimal from "decimal.js";

export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = Decimal;

/** Exact decimal from a JS number — via its shortest decimal string, so 0.1 is 0.1 rather than 0.1000000000000000055…. */
export const dec = (n: number): Dec => new D(String(n));

/** Anything smaller than this many shares is treated as zero (guards against fractional-unit dust). */
export const QTY_EPSILON = new D("1e-9");

/** Dollars → whole cents, rounded half-up. */
export const toCentsInt = (dollars: Dec): number => dollars.times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();

/** The largest amount one stored cents figure can hold (a 32-bit integer): $21,474,836.47. */
export const MAX_CENTS = 2_147_483_647;

/** How many decimal places a number has, exactly (so 9.995 → 3, 1e-7 → 7). */
export const decimalPlacesOf = (n: number): number => dec(n).decimalPlaces();
