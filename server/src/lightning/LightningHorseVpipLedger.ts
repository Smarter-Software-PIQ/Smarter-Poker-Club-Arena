/**
 * A LIGHTNING HORSE KNOWS ITS OWN VPIP THIS SITTING (2026-11-18)
 *
 * Owner, 2026-11-18 10:52 Chicago: "yes if a game requires a vpip horses must
 * always follow". Every Lightning Games row carries a 40% floor in the
 * ten-hand mode (migration 20261023230001: "Lightning uses 40% minimum VPIP
 * and a BB ante"), and the Lightning decision snapshot carried neither the
 * floor nor the Horse's own figure, so a Lightning Horse could not follow it
 * (production 2026-11-18, PLO5 1/2 pool: 49 Horses, 19,842 dealt hands, VPIP
 * 24.6%; 48 of 48 Horses with ten or more hands under 40%).
 *
 * WHAT THIS IS. The count the decision needs and nothing else: for one pool
 * sitting (the pool session, LightningParticipant.poolSessionId), the hands
 * the Horse was dealt and the hands it voluntarily entered. A hand is entered
 * exactly as ca_hand_facts.vpip says (handFacts.deriveFlowFlags): an own
 * preflop call, bet, raise or all-in. Blind and ante postings, a big blind
 * that checks and a walk are dealt hands that were not entered. A limp that
 * folds to a raise is entered.
 *
 * THE WINDOW (2026-11-19). The decision judges the game's own window, rolling
 * (HorseLogic.lightningVpipFloorLimpOnlyInputs), so each sitting also keeps
 * its most recent hands, entered or not (LIGHTNING_HORSE_VPIP_RECENT_HANDS),
 * and readWindow hands the decision the last window - 1 of them.
 *
 * WHY A COUNT IN MEMORY, HERE. At a table the Horse reads the judge's own
 * figure (fn_nit_status, ServerTableEngineBase.horseVpipDecisionInputs). A
 * pool has no judge today: a parked anchor runs the sit-out clock alone
 * (ServerTableEngineDealing, sitOutOnly), and no pool session has ever ended
 * on the floor (30 days to 2026-11-18: 0, people and Horses). The ten-hand
 * mode judges the whole sitting once ten hands are dealt, so the figure is the
 * sitting's running count. When a pool judge is built, this file is replaced
 * by a read of that judge, as at a table. A restart of the process starts the
 * count again: the Horse then takes no floor action until the count holds
 * window - 1 hands (nine in a ten-hand game), which fails toward the
 * unfloored decision and bounds a restart at those hands.
 *
 * Never throws. Bounded: the oldest sittings leave first.
 */

/** One sitting's running count. */
export interface LightningHorseVpipCount {
  hands: number;
  vpipHands: number;
}

/** The last hands of a sitting (readWindow): how many, how many entered, and whether the oldest of them was entered. */
export interface LightningHorseVpipWindow extends LightningHorseVpipCount {
  leavingEntered: boolean;
}

/** Recent hands kept per sitting: every fast-table game's window is ten; a longer window than this takes no action. */
export const LIGHTNING_HORSE_VPIP_RECENT_HANDS = 64;

/** What the Lightning snapshot carries for a floored pool (HorseGameStateV2.lightningVpipFloor). */
export interface LightningHorseVpipFloorInput {
  /** The game's floor, percent (tables.maintain_percent_min of the host table). */
  floor: number;
  /** The game's judged window, hands (tables.maintain_hands; ten in the ten-hand mode). */
  windowHands: number;
  /** The Horse's last windowHands - 1 settled hands this sitting (fewer while the count is younger). */
  own: LightningHorseVpipWindow;
}

/** Sittings kept. A pool holds at most a few hundred at once; this is a memory bound, not a rule. */
export const LIGHTNING_HORSE_VPIP_LEDGER_MAX_SITTINGS = 20_000;

const ENTERED = new Set(['call', 'bet', 'raise', 'all_in']);

/** True when `userId` voluntarily entered the pot preflop in this action log. Pure. */
export function lightningHandWasEntered(
  userId: string,
  actions: ReadonlyArray<Record<string, unknown>>
): boolean {
  for (const a of actions) {
    if (!a || a.userId !== userId || a.stage !== 'preflop') continue;
    if (a.origin === 'forced' || a.dead === true) continue;
    if (ENTERED.has(String(a.action))) return true;
  }
  return false;
}

export class LightningHorseVpipLedger {
  private readonly sittings = new Map<string, LightningHorseVpipCount & { recent: boolean[] }>();

  constructor(private readonly maxSittings = LIGHTNING_HORSE_VPIP_LEDGER_MAX_SITTINGS) {}

  /** The sitting's count so far (zeros before its first settled hand). */
  read(poolSessionId: string | null | undefined): LightningHorseVpipCount {
    const row = poolSessionId ? this.sittings.get(poolSessionId) : undefined;
    return row ? { hands: row.hands, vpipHands: row.vpipHands } : { hands: 0, vpipHands: 0 };
  }

  /** The sitting's last `n` settled hands (fewer while the count is younger), oldest first. */
  readWindow(poolSessionId: string | null | undefined, n: number): LightningHorseVpipWindow {
    const recent = (poolSessionId ? this.sittings.get(poolSessionId)?.recent : undefined) ?? [];
    const want = Number.isInteger(n) && n > 0 ? n : 0;
    const k = Math.min(want, recent.length);
    const last = recent.slice(recent.length - k);
    return {
      hands: k,
      vpipHands: last.filter(Boolean).length,
      leavingEntered: k > 0 && k === want ? last[0] === true : false,
    };
  }

  /** One settled hand: every Horse dealt in counts one hand, entered or not. */
  record(
    participants: ReadonlyArray<{ playerId: string; poolSessionId: string; isHorse: boolean }>,
    actions: ReadonlyArray<Record<string, unknown>>
  ): void {
    try {
      for (const p of participants) {
        if (!p || p.isHorse !== true || !p.poolSessionId || !p.playerId) continue;
        const row = this.sittings.get(p.poolSessionId) ?? { hands: 0, vpipHands: 0, recent: [] };
        const entered = lightningHandWasEntered(p.playerId, actions);
        row.hands += 1;
        if (entered) row.vpipHands += 1;
        row.recent.push(entered);
        if (row.recent.length > LIGHTNING_HORSE_VPIP_RECENT_HANDS) row.recent.shift();
        // Re-insert so the Map's order is least recently dealt first.
        this.sittings.delete(p.poolSessionId);
        this.sittings.set(p.poolSessionId, row);
      }
      while (this.sittings.size > this.maxSittings) {
        const oldest = this.sittings.keys().next().value;
        if (oldest === undefined) break;
        this.sittings.delete(oldest);
      }
    } catch {
      /* a count that cannot be kept leaves the Horse on its unfloored decision */
    }
  }

  size(): number {
    return this.sittings.size;
  }
}

/** The process-wide ledger (one engine process hosts a pool's hands). */
export const lightningHorseVpipLedger = new LightningHorseVpipLedger();

/**
 * What a floored pool hands the Horse's decision: null when the host table
 * runs no floor (read exactly as LightningHorseResults.lightningVpipFloor and
 * the table engine's vpipFloor() read it). Pure.
 */
export function lightningHorseVpipFloorInput(
  rules: Record<string, unknown> | null | undefined,
  /** The Horse's last `hands` settled hands this sitting (LightningHorseVpipLedger.readWindow). */
  ownFor: (hands: number) => LightningHorseVpipWindow
): LightningHorseVpipFloorInput | null {
  if (!rules || rules.nit_game !== true) return null;
  const floor = Number(rules.maintain_percent_min ?? 0);
  if (!Number.isFinite(floor) || !(floor > 0)) return null;
  const raw = Number(rules.maintain_hands ?? 10);
  const windowHands = Number.isInteger(raw) && raw > 0 ? raw : 10;
  const own = ownFor(windowHands - 1);
  return {
    floor,
    windowHands,
    own: {
      hands: own.hands,
      vpipHands: own.vpipHands,
      leavingEntered: own.leavingEntered === true,
    },
  };
}
