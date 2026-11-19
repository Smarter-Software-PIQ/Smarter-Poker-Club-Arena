/**
 * THE RAISE-LADDER STAMP (2026-11-18, MEASUREMENT ONLY). HandController's half of RaiseLadderAlarm.ts, kept free of
 * imports so the controller's module graph gains nothing: the run of consecutive minimum raises at an accepted
 * record, retained by object identity (as HorseTurnClockReceipt.ts), never in the record, the event or the hand.
 */
/** The run of consecutive minimum raises on one street that fires the alarm (once per street). */
export const RAISE_LADDER_ALARM_RUN = 4;

export interface RaiseLadderStamp {
  /** The number of consecutive minimum raises on this street, this raise included. */
  run: number;
  /** The raisers of the run, in order (user ids; one per raise, so a seat can repeat). */
  raisers: readonly string[];
  /** The table's variant as HandController was configured with it. */
  variant: string;
}

const stamps = new WeakMap<object, RaiseLadderStamp>();

/** HandController: the run this accepted minimum raise belongs to. Never throws. */
export function retainRaiseLadder(record: object, stamp: RaiseLadderStamp): void {
  try {
    stamps.set(record, Object.freeze({ ...stamp, raisers: Object.freeze([...stamp.raisers]) }));
  } catch {
    /* measurement only */
  }
}

/** The continuation lane clones events: carry the stamp to the copy, by identity, as carryHorseTurnClock does. */
export function carryRaiseLadder(record: object | undefined, copy: object | undefined): void {
  const stamp = record && stamps.get(record);
  if (stamp && copy) stamps.set(copy, stamp);
}

export function raiseLadderStampOf(record: object | undefined): RaiseLadderStamp | undefined {
  return record ? stamps.get(record) : undefined;
}
