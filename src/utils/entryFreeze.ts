/**
 * WHEN A FREEZE ENDS, READ FROM THE DOOR THAT REFUSES (Dan 2026-11-07).
 *
 * At 13:20 Chicago Dan tapped Join on NLH and PLO Lightning eleven times and
 * was refused every time. The platform was frozen for an owner-ordered engine
 * cutover; the engine itself was back at 13:20:17, but the database kept new
 * entries closed until its release boundary at 13:21:37. Nothing on the screen
 * said so: the Join buttons looked open, the banner (if any) followed the
 * engine, and the refusal sentence named no time at all.
 *
 * The database that refuses is the only authority on when it stops refusing.
 * `fn_maintenance_break_state()` is its public read of exactly that: one row
 * while a break is announced or a release boundary is still ahead, with the
 * milliseconds remaining (null end while the engine is finishing and no
 * instant is certain yet), and no row at all when entry is open. The guards
 * `fn_entry_purchases_frozen` / `fn_platform_frozen` read the same two
 * sources (engine_maintenance_break and the active release boundary).
 *
 * This file is pure: the shape of that row, the button label and the
 * refusal sentence. The live store is src/hooks/useEntryFreeze.ts.
 */
import { PLATFORM_FROZEN_MESSAGE } from './platformFrozen';

export interface EntryFreeze {
  /** The database is refusing new entries right now. */
  frozen: boolean;
  /** Absolute server-clock ms when entry reopens, or null when not yet certain. */
  endsAtMs: number | null;
}

export const ENTRY_OPEN: EntryFreeze = Object.freeze({ frozen: false, endsAtMs: null });

/**
 * The row from `fn_maintenance_break_state()` as an entry freeze.
 *
 * Any row means frozen: the function returns a row only for an announced
 * break or a release boundary that has not passed. The remaining
 * milliseconds are measured by the database at read time, so the end instant
 * is `readAt + remaining_ms`, immune to a skewed device clock.
 */
export function entryFreezeFromRow(data: unknown, readAt: number): EntryFreeze {
  const row = (Array.isArray(data) ? data[0] : data) as
    | { remaining_ms?: unknown; phase?: unknown }
    | null
    | undefined;
  if (!row || typeof row !== 'object') return ENTRY_OPEN;
  const remaining = Number(row.remaining_ms);
  return {
    frozen: true,
    endsAtMs: Number.isFinite(remaining) && remaining > 0 ? readAt + remaining : null,
  };
}

/**
 * The guard's own answer decides frozen-or-open; the break row only supplies
 * the end. `fn_entry_purchases_frozen()` is the function the entry triggers
 * call, so a stale or malformed break row that the guard ignores can never
 * hold a Join door shut. When the guard cannot be read (signed out, a
 * network fault) the break row alone is used, as before.
 */
export function entryFreezeFrom(
  guard: boolean | null,
  breakRow: unknown,
  readAt: number
): EntryFreeze {
  if (guard === false) return ENTRY_OPEN;
  const fromRow = entryFreezeFromRow(breakRow, readAt);
  if (guard === true && !fromRow.frozen) return { frozen: true, endsAtMs: null };
  return fromRow;
}

/** Whole seconds until `endsAtMs`, never negative. */
export function secondsUntil(endsAtMs: number, now: number): number {
  return Math.max(0, Math.ceil((endsAtMs - now) / 1000));
}

/** 47 -> "0:47", 125 -> "2:05". */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * What a Join button says while entry is frozen, or undefined when it is open.
 * A button that always fails is worse than a button that says when it works.
 */
export function entryFreezeLabel(freeze: EntryFreeze, now: number): string | undefined {
  if (!freeze.frozen) return undefined;
  if (freeze.endsAtMs === null || freeze.endsAtMs <= now) return 'Opening Shortly';
  return `Opens In ${formatClock(secondsUntil(freeze.endsAtMs, now))}`;
}

/**
 * The refusal sentence with the time in it, when the time is known.
 * Without a certain end it is the plain PLATFORM_FROZEN_MESSAGE.
 */
export function platformFrozenMessageUntil(endsAtMs: number | null, now: number): string {
  if (endsAtMs === null || endsAtMs <= now) return PLATFORM_FROZEN_MESSAGE;
  const s = secondsUntil(endsAtMs, now);
  const when =
    s < 60
      ? `${s} Second${s === 1 ? '' : 's'}`
      : `${Math.ceil(s / 60)} Minute${Math.ceil(s / 60) === 1 ? '' : 's'}`;
  return `The Platform Is On A Short Maintenance Break. Nothing Is Lost. Seats Reopen In About ${when}.`;
}
