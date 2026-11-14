/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  SHARED FORMAT UTILITIES — DRY helpers for formatting numbers, chips, time
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Previously copy-pasted across 8+ pages. Centralized here for consistency.
 */

/**
 * Format a number with locale-aware separators.
 * @example fmt(12345) → "12,345"
 */
export const fmt = (n: number | null | undefined): string => Number(n || 0).toLocaleString();

/**
 * A chip amount, exact. NEVER ABBREVIATED (Dan 2026-11-13, see exactChips).
 * @example fmtChips(1500)    -> "1,500"
 * @example fmtChips(1512.34) -> "1,512.34"
 */
export const fmtChips = (n: FigureInput): string => exactChips(n);

/**
 * CHIPS ON THE FELT ARE NEVER ABBREVIATED (Dan 2026-08-28, binding).
 *
 * `fmtChips` above renders 117000 as "117.0K" and 247100 as "247.1K". On a
 * lobby row that is fine — it is a browsing surface and the exact number does
 * not change a decision. On the TABLE it is not: a player sizing a bet, or
 * reading how much is behind, is being shown a number that has been rounded
 * away from the truth. "247K" is not a stack, it is a range 500 chips wide.
 *
 * So: separators, never a K/M suffix, and never a rounded magnitude.
 *
 * IT ALSO DOES NOT ROUND THE FRACTION AWAY. An earlier pass at this floored
 * everything >= 1, which turned a typed 13.37 raise into "13" — the same
 * class of lie in the other direction, and it broke the bet-granularity spec
 * that pins the typed amount. Up to two decimals are kept WHEN THEY EXIST, so
 * integers (every tournament stack) stay clean and micro-stakes stay exact.
 *
 * A caller that genuinely wants whole chips — a transient animation label
 * carrying engine sub-chip noise — rounds before calling and says why. That
 * is a display choice about one number, not a second abbreviation policy.
 *
 * @example formatTableChips(117000)  → "117,000"
 * @example formatTableChips(247100)  → "247,100"
 * @example formatTableChips(13.37)   → "13.37"
 * @example formatTableChips(0.5)     → "0.50"
 */
/**
 * A STACK under 100 reads to the penny. Dan 2026-09-04, verbatim: "WHEN YOUR
 * ACCOUNT BALANCE ON CASH GAME TABLES IS UNDER 100 CHIPS IT SHOULD DISPLAY IT
 * AS 99.99 DOWN TO .01. IT NEEDS TO BE ACCURATE TO THE PENNY WHEN USERS HAVE
 * LESS THAN 100." A 0.02/0.05 stack of 5.37 was rendering as "5", because the
 * seat squared off every stack from 1 chip up. Under a hundred every chip is
 * pennies: two places, always, so 5 reads "5.00" beside 5.37 and the seats
 * line up. From 100 up a stack is whole chips (engine sub-chip noise is rake
 * and split artifacts, not chips anyone can bet) through formatTableChips.
 *
 * This is the STACK rule. Bets, pots and typed raises keep formatTableChips'
 * own contract (integers clean, real fractions kept).
 *
 * @example formatStackChips(5.37)   -> "5.37"
 * @example formatStackChips(5)      -> "5.00"
 * @example formatStackChips(99.99)  -> "99.99"
 * @example formatStackChips(117000) -> "117,000"
 */
export const PENNY_PRECISION_BELOW = 100;
export const formatStackChips = (n: number | null | undefined): string => {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return '0';
  const abs = Math.abs(v);
  if (abs < PENNY_PRECISION_BELOW) return `${v < 0 ? '-' : ''}${abs.toFixed(2)}`;
  return formatTableChips(Math.round(v));
};

/**
 * A table figure in big blinds: ONE shape for every BB number on the felt
 * (Dan 2026-10-24). The pot printed "50 BB" while the seat beside it printed
 * "50.0 BB" and a bet "6.0 BB" - three formatters for one setting. The rest of
 * the platform (tournament structure cards, the cash panel) already reads
 * "50 BB" / "87.5 BB", so that is the shape:
 *   - 100 BB and deeper: whole, grouped ("1,250 BB");
 *   - a whole number of big blinds: no decimal ("50 BB");
 *   - otherwise one decimal ("37.5 BB"), never a third digit of noise.
 * Returns null when there is no big blind to divide by, so the caller prints
 * the chip figure instead of a "0 BB" that is not true.
 */
export const formatBigBlinds = (
  amount: number | null | undefined,
  bigBlind: number | null | undefined
): string | null => {
  const bb = Number(bigBlind);
  if (!Number.isFinite(bb) || bb <= 0) return null;
  const n = Number(amount || 0) / bb;
  if (Math.abs(n) >= 100) return `${Math.round(n).toLocaleString('en-US')} BB`;
  const tenths = Math.round(n * 10) / 10;
  return Number.isInteger(tenths) ? `${tenths} BB` : `${tenths.toFixed(1)} BB`;
};

export const formatTableChips = (n: number | null | undefined): string => {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return '0';
  if (v === 0) return '0';
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  if (abs < 1) return `${sign}${abs.toFixed(2)}`;
  return `${sign}${abs.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A PRIZE PRINTED AT THE UNIT ITS TOURNAMENT PAYS IN (2026-09-15)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `formatTableChips` is the CHIP contract and it is right for chips: a chip
 * divides into cents, so an amount under one chip shows two places and 7.5
 * reads "7.50". Applied to a Diamond prize that contract prints a quantity
 * that cannot exist - a Diamond does not divide, the custody reserve floors
 * it, the hand settler refuses it and the wallet stores diamonds as an integer
 * column - so "0.50" beside a Diamond is not a small imprecision, it is an
 * amount no door in this estate will accept.
 *
 * The ladder arithmetic already snaps every Diamond share to a whole Diamond
 * (`computePlacePrize` rounds each share to the unit and hands the remainder,
 * itself a whole Diamond by induction, to the last paid place). So this is not
 * a second rounding and must never become one: at a Diamond unit the number
 * arriving here is already whole, and this only chooses how to SAY it.
 *
 * `Math.round` on that already-whole number is there to absorb binary float
 * noise from the `/ 100` that ends `computePlacePrize` - 17 arriving as
 * 16.999999999999996 would otherwise print "17" from toLocaleString anyway,
 * but would print "16.999999999999996" the day someone widens the digit cap.
 * It is a statement that a Diamond amount is an integer, not arithmetic.
 *
 * The chip path is `formatTableChips` unchanged, by construction rather than
 * by inspection: a unit of 1 takes the first branch and nothing else in this
 * function runs.
 *
 * @example formatPrizeAtUnit(17.5,  1)   -> "17.50"   (chips keep their cents)
 * @example formatPrizeAtUnit(0.5,   1)   -> "0.50"
 * @example formatPrizeAtUnit(17,    100) -> "17"      (whole Diamonds)
 * @example formatPrizeAtUnit(1250,  100) -> "1,250"
 * @example formatPrizeAtUnit(0,     100) -> "0"
 */
export const formatPrizeAtUnit = (amount: number | null | undefined, unitCents: number): string => {
  const unit = Number.isSafeInteger(unitCents) && unitCents >= 1 ? unitCents : 1;
  if (unit === 1) return formatTableChips(amount);
  const v = Number(amount ?? 0);
  if (!Number.isFinite(v)) return '0';
  const whole = Math.round(v);
  if (whole === 0) return '0';
  const sign = whole < 0 ? '-' : '';
  return `${sign}${Math.abs(whole).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
};

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE SAME RULE IN THE CENTS DOMAIN, FOR THE MYSTERY LADDER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `formatPrizeAtUnit` takes an amount. Every mystery bounty figure in this
 * client is CENTS instead - `tournament_bounty_chests.amount_cents`, and the
 * integer cents `fn_mystery_bounty_inventory`, `fn_mystery_bounty_awards` and
 * `fn_mystery_bounty_leaderboard` return - because a chest ladder is built in
 * the smallest chip a chest can hold. So the chest half of the estate needs
 * the same rule expressed over cents, and it must be ONE rule rather than a
 * second reading of it: this is `formatPrizeAtUnit` with the `/ 100` moved
 * inside, and the chip path is `MysteryBountyService.formatCents`' old body
 * character for character.
 *
 * At a Diamond unit a chest is a whole number of Diamonds by construction -
 * `mysteryPoolCents` floors the pool to the unit and the seed sites draw tiers
 * on that grid - so this only chooses how to SAY the number, exactly as
 * `formatPrizeAtUnit` does. It is not a second rounding.
 *
 * @example formatPrizeCentsAtUnit(500000, 1)   -> "5,000"   (whole chips)
 * @example formatPrizeCentsAtUnit(750,    1)   -> "7.50"    (a chest with cents)
 * @example formatPrizeCentsAtUnit(500000, 100) -> "5,000"   (whole Diamonds)
 * @example formatPrizeCentsAtUnit(0,      100) -> "0"
 */
export const formatPrizeCentsAtUnit = (
  cents: number | null | undefined,
  unitCents: number
): string => {
  const unit = Number.isSafeInteger(unitCents) && unitCents >= 1 ? unitCents : 1;
  const raw = Number(cents ?? 0);
  const c = Math.round(Number.isFinite(raw) ? raw : 0);
  if (unit === 1) {
    const rem = Math.abs(c % 100);
    if (rem === 0) return Math.trunc(c / 100).toLocaleString('en-US');
    return (c / 100).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  return formatPrizeAtUnit(c / 100, unit);
};

/**
 * THE WORD A PLAYER READS BESIDE A TOURNAMENT MONEY FIGURE.
 *
 * Dan 2026-09-11: the Diamond Arena is "PLAYED WITH DIAMONDS INSTEAD OF
 * CHIPS". A Diamond bounty printed as a bare number beside the word "Chips" is
 * the same defect as printing it on the cent grid, one level up: the figure is
 * right and the sentence is wrong. Title Case, because every player-facing
 * string in this estate is.
 *
 * Derived from the unit rather than from an asset string, so the noun and the
 * grid can never disagree: there is one input and both answers come off it.
 */
export const moneyWordAtUnit = (unitCents: number): 'Diamonds' | 'Chips' => {
  const unit = Number.isSafeInteger(unitCents) && unitCents >= 1 ? unitCents : 1;
  return unit === 1 ? 'Chips' : 'Diamonds';
};

/** The singular, for a phrase that already carries its own noun: "Chip Pool". */
export const moneyAdjectiveAtUnit = (unitCents: number): 'Diamond' | 'Chip' =>
  moneyWordAtUnit(unitCents) === 'Diamonds' ? 'Diamond' : 'Chip';

/**
 * THE WORD, WHERE TODAY THERE IS NO WORD AT ALL.
 *
 * Several of these surfaces print a bare figure - "Won 500", "for 500." - and
 * a bare figure in the Diamond Arena does not say what it is. This adds the
 * noun for a Diamond event and adds NOTHING for a chip one, so every chip
 * string stays byte-identical rather than gaining a "Chips" it never had.
 *
 * That asymmetry is deliberate and is the whole point: the requirement is that
 * a Diamond figure names its unit, not that every figure in the estate grows a
 * noun. Use `moneyWordAtUnit` where a word is already printed and only its
 * value has to follow the unit.
 */
export const moneySuffixAtUnit = (unitCents: number): string =>
  moneyWordAtUnit(unitCents) === 'Diamonds' ? ' Diamonds' : '';

/**
 * THE "+N" THAT RIDES WITH MONEY ARRIVING AT A SEAT (pot push, bounty,
 * insurance). Dan 2026-08-29, binding: "THERE CAN NEVER BE 'ROUNDING' IT MUST
 * ALWAYS BE DOWN TO THE CENT."
 *
 * Until 2026-09-04 this label was built inline as `Math.round(amount)` for
 * anything >= 1, so a 7.50 bounty floated up as "+8" while the seat's own
 * stack delta beside it said "+7.50" — two numbers for one payment. 401 of
 * the 7,508 bounties paid since 08-28 (5.3%) carried cents and every one of
 * them was shown rounded. Cash pots at penny stakes had the same problem.
 *
 * Rule: snap to cents FIRST (that kills engine float noise such as
 * 12.500000001, which is sub-cent and not money), then whole chips read as
 * whole chips and anything else keeps exactly two places. Same contract as
 * SeatSlot's stack delta, so the two labels for one payment always agree.
 *
 * @example formatChipAward(1234)    -> "+1,234"
 * @example formatChipAward(7.5)     -> "+7.50"
 * @example formatChipAward(0.25)    -> "+0.25"
 * @example formatChipAward(12.5000000001) -> "+12.50"
 * @example formatChipAward(0)       -> "+0"
 */
export const formatChipAward = (amount: number | null | undefined): string => {
  const v = Number(amount ?? 0);
  if (!Number.isFinite(v)) return '+0';
  // + 1e-7 before rounding: a binary double holds 17.955 as 17.95499999...,
  // so a bare Math.round(x * 100) lands a half-cent DOWN. That is the exact
  // defect the 2026-08-29 "payouts are exact to the cent" fix removed from
  // the payout math; the label must not reintroduce it. The nudge is seven
  // orders of magnitude below a cent, so it can only ever decide a tie.
  const cents = Math.round(Math.abs(v) * 100 + 1e-7);
  const sign = v < 0 ? '-' : '+';
  if (cents % 100 === 0) return `${sign}${(cents / 100).toLocaleString('en-US')}`;
  return `${sign}${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

/**
 * THE SAME "+N", AT THE UNIT THE TABLE PAYS IN.
 *
 * `formatChipAward` is the CHIP contract and stays exactly as it is: the
 * knockout audit of 2026-09-04 measured 401 of 7,508 bounties carrying cents
 * and every one of them shown rounded, and the fix was that the float and the
 * seat's own stack delta print through one formatter. That pairing is still
 * the rule for a chip table.
 *
 * A Diamond bounty has no cents to keep. The engine's bounty bank holds whole
 * Diamonds (`a-diamond-bounty-is-paid-from-its-own-bank`), so the float that
 * rides up from a Diamond seat is a whole Diamond, and the two-place branch
 * above would print a decimal point that the payment cannot contain.
 *
 * The chip path is `formatChipAward` unchanged, by construction: a unit of 1
 * returns it and nothing else here runs.
 *
 * @example formatAwardAtUnit(7.5,  1)   -> "+7.50"
 * @example formatAwardAtUnit(1234, 1)   -> "+1,234"
 * @example formatAwardAtUnit(12,   100) -> "+12"
 * @example formatAwardAtUnit(0,    100) -> "+0"
 */
export const formatAwardAtUnit = (amount: number | null | undefined, unitCents: number): string => {
  const unit = Number.isSafeInteger(unitCents) && unitCents >= 1 ? unitCents : 1;
  if (unit === 1) return formatChipAward(amount);
  const v = Number(amount ?? 0);
  if (!Number.isFinite(v)) return '+0';
  const whole = Math.round(v);
  const sign = whole < 0 ? '-' : '+';
  return `${sign}${Math.abs(whole).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
};

/**
 * Format a timestamp as a relative "time ago" string.
 * @example timeAgo("2026-03-17T10:00:00Z") → "2h ago"
 */
export const timeAgo = (ts: string | null | undefined): string => {
  if (!ts) return 'Never';
  const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

/**
 * Format a date with year.
 * @example formatDate("2026-03-17T10:00:00Z") → "Mar 17, 2026"
 */
export const formatDate = (ts: string | null | undefined): string => {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

/**
 * Format a date without year (compact).
 * @example formatDateShort("2026-03-17T10:00:00Z") → "Mar 17"
 */
export const formatDateShort = (ts: string | null | undefined): string => {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
};

/**
 * Format a date with time (no year).
 * @example formatDateTime("2026-03-17T10:30:00Z") → "Mar 17, 10:30 AM"
 */
export const formatDateTime = (ts: string | null | undefined): string => {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

/**
 * Format percentage from a 0-1 decimal.
 * @example pct(0.253) → "25.3%"
 */
export const pct = (n: number | null | undefined): string =>
  `${((Number(n) || 0) * 100).toFixed(1)}%`;

/* ── Player identity surfaces (added 2026-09-04) ────────────────────────────
   Every stat the profile renders arrives as a raw ratio or float from
   `ca_player_stats_overview_v2`. Multiplying a ratio by 100 in JavaScript
   yields 1.6500000000000001, and that exact string was on the live profile
   hero next to "ROI". Nothing below lets a float reach the DOM unrounded.

   STANDING DIRECTIVE (Dan, 2026-09-04): "ABSOLUTELY ZERO ROUNDING ANYWHERE
   EVER". Every helper here TRUNCATES toward zero; none may print a figure the
   ledger never produced. */

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Truncate toward zero to `digits` places, then print with exactly `digits`. */
/* Binary floats: 2183.7 * 100 is 218369.99999999997 and a bare trunc prints
   2,183.69 for a ledger figure of 2,183.70. Nudge one part in a billion toward
   the sign before truncating; exact decimals stay exact. */
const nudge = (v: number): number => v + Math.sign(v) * 1e-9;

const truncFixed = (value: number, digits: number): string => {
  const factor = 10 ** digits;
  return (Math.trunc(nudge(value) * factor) / factor).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: false,
  });
};

/** "32.9%" from a value that is ALREADY a percentage (x100). Truncated. */
export const formatPct = (value: unknown, digits = 1): string =>
  finite(value) ? `${truncFixed(value, digits)}%` : '0%';

/** "+1.6%" / "-3.2%" / "0.0%" - explicit sign because the reader is a P/L. */
export const formatSignedPct = (value: unknown, digits = 1): string => {
  if (!finite(value)) return '0.0%';
  const fixed = truncFixed(value, digits);
  return value > 0 ? `+${fixed}%` : `${fixed}%`;
};

/**
 * "+1,711.50" / "-2,183.70" / "0.00" - chips, signed, thousands separators.
 * `digits` is the MINIMUM number of places; every real decimal beyond it is
 * kept, never truncated away (Dan 2026-11-13: exact figures always).
 */
export const formatSignedChips = (value: unknown, digits = 2): string =>
  chipFigure(value, digits, 'signed', (0).toFixed(digits));

/** "1,711.50" - chips, unsigned; `digits` is the minimum, extra stored precision kept. */
export const formatChips = (value: unknown, digits = 2): string =>
  chipFigure(value, digits, 'unsigned', (0).toFixed(digits));

/** "1,412" - whole counts (truncated, never rounded up). */
export const formatCount = (value: unknown): string =>
  finite(value) ? Math.trunc(value).toLocaleString('en-US') : '0';

/*
 * REMOVED 2026-09-05: `formatRatio`. It had no caller. Every ratio on the
 * credential (BB/100, aggression factor, per-variant BB/100) needs a leading
 * sign, which this did not add, so the page used its own `signed(...)` around
 * a truncation and always would have. A tested export that nothing calls reads
 * as covered while being unreachable, which is worse than no export at all.
 */

/** "9.9h" / "48m" - hours played, compact, truncated. */
export const formatHours = (hours: unknown): string => {
  if (!finite(hours) || hours <= 0) return '0h';
  if (hours < 1) return `${Math.trunc(hours * 60)}m`;
  return `${truncFixed(hours, 1)}h`;
};

/**
 * "Just Now" / "12m Ago" / "3h Ago" / "2d Ago" / "Aug 30". Title Case because
 * it sits beside Title Case labels on the credential; null when unknown so
 * the caller can omit the plate instead of printing "Never".
 */
export const relativeTimeTitle = (
  iso: string | null | undefined,
  now = Date.now()
): string | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const m = Math.floor(Math.max(0, now - t) / 60000);
  if (m < 1) return 'Just Now';
  if (m < 60) return `${m}m Ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h Ago`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}d Ago`;
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

/** "Oct 2025" - one member-since format for every identity surface. */
export const formatMemberSince = (iso: string | null | undefined): string => {
  if (!iso) return 'Unknown';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'Unknown';
  return new Date(t).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};

/** 1 -> "1st", 22 -> "22nd", 113 -> "113th"; "-" when there is no finish. */
export const ordinal = (n: unknown): string => {
  if (!finite(n) || n <= 0) return '-';
  const v = Math.trunc(n);
  const mod100 = v % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${v}th`;
  const suffix = ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[v % 10] ?? 'th';
  return `${v}${suffix}`;
};

/**
 * EXACT FIGURES, NEVER ROUNDED OR ABBREVIATED (Dan 2026-11-13, binding,
 * supersedes the 2026-09-09 "1.2K / no decimals" forward-facing rule and the
 * 2026-10-16 compact win / loss rule): "IN THE PLAYER MANAGEMENT OR ANYWHERE
 * REAL DATA IS STORED. I DON'T WANT ROUNDED UP NUMBERS LIKE 393 OR 1.5K OR 1K
 * USE WHOLE NUMBERS AND DECIMALS ALWAYS ... FIX THIS LOGIC GLOBALLY FOR THE
 * POKER ARENA."
 *
 * Thousands separators, never a K/M/B suffix, and every real decimal the
 * stored value has is kept (at least two once there are any). A whole value
 * (a count, a tournament stack, a blind) reads whole.
 *
 * @example exactChips(1512.34) -> "1,512.34"
 * @example exactChips(1000)    -> "1,000"
 * @example exactChips(-136.5)  -> "-136.50"
 * @example exactChips(0.07)    -> "0.07"
 * @example exactChips(1.234)   -> "1.234"
 */
/**
 * A figure as the platform stores it: a JSON number, an exact decimal string
 * (what an RPC returns from `round(x, 2)::text` or `numeric::text`), or a
 * bigint. Declared columns reach numeric(20,2) and 792 columns are
 * unconstrained numeric, so a stored figure can carry more digits than a
 * JavaScript number holds.
 */
export type FigureInput = number | string | bigint | null | undefined;

/**
 * A STRING or BIGINT figure is formatted digit for digit with no limit, because
 * it never passes through a double: decimal text from the database is the
 * authority and is preserved exactly. A NUMBER figure prints the exact decimal
 * that number denotes (its shortest round-trip form, exponent expanded). The
 * formatter never decides that a trailing digit is noise; a caller that did
 * arithmetic applies its own explicit precision rule (for chips, cents via
 * sumChips) before formatting.
 */
const plainNumberText = (value: number): string => {
  const text = String(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(text);
  if (!match) return text;
  const [, sign, int, frac = '', expText] = match;
  const exp = Number(expText);
  const digits = int + frac;
  const point = int.length + exp;
  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${'0'.repeat(point - digits.length)}`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
};

const DECIMAL_TEXT = /^[-+]?(\d+(\.\d*)?|\.\d+)$/;

/** The exact sign and digits of a supported figure, or null when it is not a figure. */
export function figureDigits(
  value: FigureInput
): { negative: boolean; whole: string; fraction: string } | null {
  let text: string;
  if (typeof value === 'bigint') text = value.toString();
  else if (typeof value === 'string') {
    text = value.trim();
    if (!DECIMAL_TEXT.test(text)) return null;
  } else if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    text = plainNumberText(value);
  } else return null;
  const negative = text.startsWith('-');
  const [rawWhole = '', rawFraction = ''] = text.replace(/^[-+]/, '').split('.');
  const whole = rawWhole.replace(/^0+(?=\d)/, '') || '0';
  const fraction = rawFraction.replace(/0+$/, '');
  return { negative: negative && /[1-9]/.test(whole + fraction), whole, fraction };
}

/**
 * The magnitude of a figure, grouped, with every real decimal it carries and at
 * least `minFraction` places. Nothing is rounded: digits are copied, so
 * "123456789012345678.91" stays exactly that.
 */
export function figureMagnitude(
  digits: { whole: string; fraction: string },
  minFraction: number
): string {
  const grouped = digits.whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = digits.fraction.padEnd(minFraction, '0');
  return fraction ? `${grouped}.${fraction}` : grouped;
}

/** True when the figure is exactly zero (or not a figure). */
const isZeroFigure = (d: { whole: string; fraction: string }) =>
  !/[1-9]/.test(d.whole + d.fraction);

/**
 * THE ONE CHIP FIGURE (2026-11-14 consolidation). Every chip formatter in this
 * file is this function with its own minimum places, sign style and fallback
 * for something that is not a figure, so one value can never print two ways
 * because two copies of the logic drifted. `minFraction` null means "two
 * places only when the figure holds a fraction", the exactChips style.
 *   'unsigned' prints a minus for a negative figure and nothing for a positive;
 *   'signed' prints + or - (zero gets neither).
 */
function chipFigure(
  value: unknown,
  minFraction: number | null,
  sign: 'unsigned' | 'signed',
  notAFigure: string,
  zero?: string
): string {
  const d = figureDigits(value as FigureInput);
  if (!d) return notAFigure;
  const places = minFraction ?? (d.fraction ? 2 : 0);
  const magnitude = figureMagnitude(d, places);
  if (isZeroFigure(d)) return zero ?? magnitude;
  if (d.negative) return `-${magnitude}`;
  return sign === 'signed' ? `+${magnitude}` : magnitude;
}

export const exactChips = (n: FigureInput): string => chipFigure(n, null, 'unsigned', '0', '0');

/**
 * Historical name kept so its ~490 call sites need no churn. It no longer
 * compacts anything: it is exactChips (Dan 2026-11-13).
 */
export const compactChips = (n: FigureInput): string => exactChips(n);

/**
 * Fees stay exact to cents with separators, including large totals
 * (owner, 2026-10-27). Null means the viewer may not see it.
 */
export const feeFigure = (value: FigureInput): string =>
  value == null ? 'Restricted' : chipFigure(value, 2, 'unsigned', '-');

/**
 * PLAYER MANAGEMENT FIGURES: one formatter per kind, on the Players list, the
 * Player Record and Player Statistics alike, so one number never reads two
 * ways between screens. The latest dated ruling for each kind wins:
 *   fees and other unsigned ledger amounts  feeFigure       (Dan, 2026-10-14)
 *   signed results: win / loss, net, winnings winLossChips  (Dan 2026-11-13, exact)
 *   wallet balances                          formatWalletChips (Dan, 2026-10-18)
 *   counts                                    countFigure
 *   rates                                     one decimal    (Dan 2026-09-13)
 * The CSV export keeps exact values and does not use these.
 */

/** A count (hands, downlines): whole, with separators. Null means the viewer may not see it. */
export const countFigure = (value: number | null | undefined): string =>
  value == null ? 'Restricted' : (Number(value) || 0).toLocaleString();

/** Wallet balances always show separators and at least two decimals; every stored decimal is kept (Dan 2026-10-18, 2026-11-13). */
export const formatWalletChips = (amount: FigureInput): string =>
  chipFigure(amount, 2, 'unsigned', '-');

/** Whole Diamond wallet counts are always exact (Dan 2026-11-13: never abbreviated). */
export const formatWalletDiamonds = (amount: number | null | undefined): string => {
  if (amount == null || !Number.isFinite(Number(amount))) return '-';
  const value = Math.trunc(Number(amount));
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
};

/**
 * A signed win / loss figure for Player Management (Dan 2026-11-13): exact to
 * the stored precision with separators, at least two decimals so it lines up
 * with the fee and wallet figures beside it. "+392.57", "-1,512.34", "0.00",
 * and "+0.125" when the stored value carries three places.
 */
export const winLossChips = (n: FigureInput): string => chipFigure(n, 2, 'signed', '0.00', '0.00');
