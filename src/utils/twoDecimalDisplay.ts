/**
 * NUMBERS STOP AFTER TWO DECIMALS, ANYWHERE AND EVERYWHERE (Dan 2026-11-27,
 * binding). See DISPLAY_PLACES in ./format.
 *
 * Hundreds of call sites print a figure with a bare `value.toLocaleString()`,
 * which the browser formats with up to THREE decimals and rounds. This makes
 * the browser's own default obey the rule once, at the root, instead of
 * editing each call:
 *   - a call that sets no fraction or significant-digit limit gets at most two
 *     decimals, cut (roundingMode 'trunc'), never rounded;
 *   - a call asking for more than two decimals is clamped to two;
 *   - percent, compact and significant-digit calls keep their own place
 *     counts, and calls that already ask for two or fewer keep theirs;
 *   - EVERY call that names no roundingMode CUTS (roundingMode 'trunc'), so a
 *     `{ maximumFractionDigits: 2 }` or `{ maximumFractionDigits: 0 }` call no
 *     longer rounds 0.999 up to "1" (2026-11-27, "ABSOLUTELY ZERO ROUNDING
 *     ANYWHERE EVER"). The value is read at fifteen significant digits first,
 *     so float noise such as 0.29 * 100 = 28.999999999999996 reads 29, not 28.
 * Installed once, as the first import of src/main.tsx. Idempotent.
 */

const INSTALLED = Symbol.for('smarter.poker/two-decimal-display');
const MAX_PLACES = 2;

type Options = Intl.NumberFormatOptions & { roundingMode?: string };

let truncSupported: boolean | null = null;
function supportsTrunc(
  original: (this: number, locales?: string | string[], options?: Options) => string
): boolean {
  if (truncSupported !== null) return truncSupported;
  try {
    truncSupported =
      original.call(0.999, 'en-US', { maximumFractionDigits: 2, roundingMode: 'trunc' }) === '0.99';
  } catch {
    truncSupported = false;
  }
  return truncSupported;
}

/** Cut a number's decimals to `places` by its digits, never by arithmetic. */
export function cutToPlaces(value: number, places: number): number {
  if (!Number.isFinite(value)) return value;
  const text = value.toFixed(20);
  const [whole, fraction = ''] = text.split('.');
  const cut = Number(`${whole}.${fraction.slice(0, places) || '0'}`);
  return Object.is(cut, -0) ? 0 : cut;
}

/** The options a display call is given under the two-decimal rule. */
export function twoDecimalOptions(options: Options | undefined): Options | undefined {
  const o = options ?? {};
  const cut: Options = o.roundingMode == null ? { ...o, roundingMode: 'trunc' } : o;
  if (o.style === 'percent' || o.notation === 'compact') return cut;
  if (o.maximumSignificantDigits != null || o.minimumSignificantDigits != null) return cut;
  const max = o.maximumFractionDigits;
  if (max != null && max <= MAX_PLACES) return cut;
  const min = Math.min(o.minimumFractionDigits ?? 0, MAX_PLACES);
  return {
    ...cut,
    minimumFractionDigits: min,
    maximumFractionDigits: MAX_PLACES,
  };
}

export function installTwoDecimalDisplay(): void {
  const proto = Number.prototype as unknown as Record<symbol, unknown> & {
    toLocaleString: (this: number, locales?: string | string[], options?: Options) => string;
  };
  if (proto[INSTALLED]) return;
  const original = proto.toLocaleString;
  proto.toLocaleString = function (
    this: number,
    locales?: string | string[],
    options?: Options
  ): string {
    const next = twoDecimalOptions(options);
    if (next === options) return original.call(this, locales, options);
    const raw = Number(this);
    // Float noise is not a digit: read the double at the precision it carries.
    const value = Number.isFinite(raw) ? Number(raw.toPrecision(15)) : raw;
    const places = Math.min(next?.maximumFractionDigits ?? MAX_PLACES, MAX_PLACES);
    const fixedPlaces =
      next?.style !== 'percent' &&
      next?.notation !== 'compact' &&
      next?.maximumSignificantDigits == null &&
      next?.minimumSignificantDigits == null;
    const shown =
      supportsTrunc(original) || !fixedPlaces || next?.roundingMode !== 'trunc'
        ? value
        : cutToPlaces(value, places);
    const text = original.call(shown, locales, next);
    // A tiny negative cut to zero reads "0", never "-0".
    return /^-[0.,\s]*$/.test(text) ? text.slice(1) : text;
  };
  Object.defineProperty(proto, INSTALLED, { value: true });
}

installTwoDecimalDisplay();
