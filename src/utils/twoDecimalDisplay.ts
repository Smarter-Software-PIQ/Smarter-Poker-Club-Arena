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
 *   - percent, compact and significant-digit calls, and calls that already
 *     ask for two or fewer, are left exactly as written.
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
  if (o.style === 'percent' || o.notation === 'compact') return options;
  if (o.maximumSignificantDigits != null || o.minimumSignificantDigits != null) return options;
  const max = o.maximumFractionDigits;
  if (max != null && max <= MAX_PLACES) return options;
  const min = Math.min(o.minimumFractionDigits ?? 0, MAX_PLACES);
  return {
    ...o,
    minimumFractionDigits: min,
    maximumFractionDigits: MAX_PLACES,
    roundingMode: 'trunc',
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
    const value = Number(this);
    const shown = supportsTrunc(original) ? value : cutToPlaces(value, MAX_PLACES);
    const text = original.call(shown, locales, next);
    // A tiny negative cut to zero reads "0", never "-0".
    return /^-[0.,\s]*$/.test(text) ? text.slice(1) : text;
  };
  Object.defineProperty(proto, INSTALLED, { value: true });
}

installTwoDecimalDisplay();
