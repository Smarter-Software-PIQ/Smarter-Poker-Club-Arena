/**
 * A FAST-TABLE PLAYER'S OWN VPIP THIS SITTING (2026-11-18, window 2026-11-19)
 *
 * Owner, 2026-11-18 10:52 Chicago: "yes if a game requires a vpip horses must
 * always follow". Every Lightning Games row carries a 40% floor in the
 * ten-hand mode (migration 20261023230001: "Lightning uses 40% minimum VPIP
 * and a BB ante"). The fast-table decision snapshot carried neither the
 * floor nor the Horse's own figure, so a Horse in a pool could not follow it
 * (production 2026-11-18, PLO5 1/2 pool: 49 Horses, 19,842 dealt hands, VPIP
 * 24.6%; 48 of 48 Horses with ten or more hands were under 40%).
 *
 * WHAT THIS IS. The count the decision needs and nothing else. For one pool
 * sitting (the pool session, LightningParticipant.poolSessionId) it holds the
 * hands dealt and the hands voluntarily entered. Every player is counted,
 * people and Horses alike; only a Horse's decision reads it. A hand is
 * entered exactly as ca_hand_facts.vpip says (handFacts.deriveFlowFlags): an
 * own preflop call, bet, raise or all-in. Blind and ante postings, a big
 * blind that checks and a walk are dealt hands that were not entered. A limp
 * that folds to a raise is entered.
 *
 * IN DEAL ORDER, AT THE MOMENT THE HAND IS OVER FOR THE PLAYER (review F1,
 * 2026-11-19). A fast fold releases the player to the next hand before the
 * folded hand commits. The host therefore records a player's hand when it
 * folds (LightningHandHost.afterFold), and every other player's hand at
 * settlement, once per (sitting, hand). Each hand is filed under its hand
 * number, so the window is the last hands as dealt, not as settled. When
 * the player is dealt the next hand, every earlier hand of the sitting is on
 * the count: a player still in a hand is never dealt another.
 *
 * THE WINDOW. The decision judges the game's own window, rolling
 * (HorseLogic.lightningVpipFloorLimpOnlyInputs). Each sitting keeps its last
 * LIGHTNING_HORSE_VPIP_RECENT_HANDS hands, and readWindow hands the decision
 * the last window - 1 of them.
 *
 * WHY A COUNT IN MEMORY, HERE. At a table the Horse reads the judge's own
 * figure (fn_nit_status, ServerTableEngineBase.horseVpipDecisionInputs). A
 * pool has no judge today: a parked anchor runs the sit-out clock alone
 * (ServerTableEngineDealing, sitOutOnly), and no pool session has ever ended
 * on the floor (30 days to 2026-11-18: 0, people and Horses). Until
 * 2026-11-21 the pool sitting WAS judged once, at the switch-off: the anchor
 * became an ordinary table and its first eviction pass read every pool hand
 * of the sitting (220 of 236 Lightning-game bars in 30 days, 235 of them
 * Horses). Since migration 20261121152102 the table's sample starts at the
 * switch-off (fn_nit_sitting_since), so pool hands are judged by nothing.
 * When a pool judge is built, this file is replaced by a read of that judge,
 * as at a table, and the line must then follow the judge's mode (rolling or whole
 * sitting, fn_nit_policy.rolling).
 *
 * RESTART AND NEW SITTINGS (review F3). A restart of the process empties the
 * count. A sitting this process saw from its first hand has its whole history
 * here (fromFirstHand), so it is judged from its first hand. A sitting first
 * seen within LIGHTNING_HORSE_VPIP_CARRYOVER_MS of this ledger's first
 * activity was already running when the process started. Its history is not
 * here, so the decision takes no floor action until the count holds
 * window - 1 hands (nine in a ten-hand game). That is the bound a restart
 * costs.
 *
 * Never throws. Bounded: the sittings dealt longest ago leave first.
 */

/** One sitting's running count. */
export interface LightningHorseVpipCount {
  hands: number;
  vpipHands: number;
}

/** The last hands of a sitting (readWindow). */
export interface LightningHorseVpipWindow extends LightningHorseVpipCount {
  /** The oldest of these hands was entered: it leaves the window at the next hand. */
  leavingEntered: boolean;
  /** This process has seen the sitting from its first hand: `hands` is its whole history so far. */
  fromFirstHand: boolean;
}

/** Recent hands kept per sitting: every fast-table game's window is ten; a longer window than this takes no action. */
export const LIGHTNING_HORSE_VPIP_RECENT_HANDS = 64;

/**
 * A sitting first seen this long after the ledger's first activity is a new
 * sitting, not one carried over a restart. Measured 2026-11-18, PLO5 1/2
 * pool, 61,275 gaps between a Horse's consecutive dealt hands in one sitting:
 * median 6.9 s, p99 65 s, p99.9 101 s. A carried sitting is therefore dealt
 * again within this window after the restart in all but about one case in a
 * thousand. Such a case is treated as new: it is judged from its first hand
 * here, which binds it sooner, never later.
 */
export const LIGHTNING_HORSE_VPIP_CARRYOVER_MS = 120_000;

/** What the fast-table snapshot carries for a floored pool (HorseGameStateV2.lightningVpipFloor). */
export interface LightningHorseVpipFloorInput {
  /** The game's floor, percent (tables.maintain_percent_min of the host table). */
  floor: number;
  /** The game's judged window, hands (vpip_window when the rules carry it, else tables.maintain_hands). */
  windowHands: number;
  /** The player's last windowHands - 1 hands this sitting (fewer while the count is younger). */
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

interface Sitting {
  hands: number;
  vpipHands: number;
  /** The last hands in deal order (hand number ascending; null = no number given, filed last). */
  recent: Array<{ hand: number | null; entered: boolean }>;
  fromFirstHand: boolean;
}

export class LightningHorseVpipLedger {
  private readonly sittings = new Map<string, Sitting>();
  private firstActivityAt: number | null = null;

  constructor(
    private readonly maxSittings = LIGHTNING_HORSE_VPIP_LEDGER_MAX_SITTINGS,
    private readonly now: () => number = Date.now,
    private readonly carryoverMs = LIGHTNING_HORSE_VPIP_CARRYOVER_MS
  ) {}

  private touch(poolSessionId: string): Sitting {
    const at = this.now();
    if (this.firstActivityAt === null) this.firstActivityAt = at;
    let row = this.sittings.get(poolSessionId);
    if (!row) {
      row = {
        hands: 0,
        vpipHands: 0,
        recent: [],
        fromFirstHand: at - this.firstActivityAt > this.carryoverMs,
      };
    }
    // Re-insert so the Map's order is least recently used first.
    this.sittings.delete(poolSessionId);
    this.sittings.set(poolSessionId, row);
    while (this.sittings.size > this.maxSittings) {
      const oldest = this.sittings.keys().next().value;
      if (oldest === undefined) break;
      this.sittings.delete(oldest);
    }
    return row;
  }

  /** The sitting's count so far (zeros before its first recorded hand). */
  read(poolSessionId: string | null | undefined): LightningHorseVpipCount {
    const row = poolSessionId ? this.sittings.get(poolSessionId) : undefined;
    return row ? { hands: row.hands, vpipHands: row.vpipHands } : { hands: 0, vpipHands: 0 };
  }

  /**
   * The sitting's last `n` hands (fewer while the count is younger), oldest
   * first. The first read of a sitting files it, so a sitting this process
   * meets from its first hand is known as such.
   */
  readWindow(poolSessionId: string | null | undefined, n: number): LightningHorseVpipWindow {
    try {
      if (!poolSessionId)
        return { hands: 0, vpipHands: 0, leavingEntered: false, fromFirstHand: false };
      const row = this.touch(poolSessionId);
      const want = Number.isInteger(n) && n > 0 ? n : 0;
      const k = Math.min(want, row.recent.length);
      const last = row.recent.slice(row.recent.length - k);
      return {
        hands: k,
        vpipHands: last.filter((h) => h.entered).length,
        leavingEntered: k > 0 && k === want ? last[0].entered : false,
        // The whole history is here only while nothing has been dropped from the tail.
        fromFirstHand: row.fromFirstHand && row.hands === row.recent.length,
      };
    } catch {
      return { hands: 0, vpipHands: 0, leavingEntered: false, fromFirstHand: false };
    }
  }

  /**
   * Hands that are over for these players: each counts one dealt hand, entered
   * or not, once per (sitting, hand number). With no hand number the hand is
   * filed last and never deduplicated.
   */
  record(
    participants: ReadonlyArray<{ playerId: string; poolSessionId: string }>,
    actions: ReadonlyArray<Record<string, unknown>>,
    handNumber?: number | null
  ): void {
    try {
      const hand =
        Number.isFinite(Number(handNumber)) && handNumber !== null ? Number(handNumber) : null;
      for (const p of participants) {
        if (!p || !p.poolSessionId || !p.playerId) continue;
        const row = this.touch(p.poolSessionId);
        if (hand !== null && row.recent.some((h) => h.hand === hand)) continue;
        const entered = lightningHandWasEntered(p.playerId, actions);
        row.hands += 1;
        if (entered) row.vpipHands += 1;
        let at = row.recent.length;
        if (hand !== null)
          while (at > 0 && row.recent[at - 1].hand !== null && row.recent[at - 1].hand! > hand)
            at--;
        row.recent.splice(at, 0, { hand, entered });
        if (row.recent.length > LIGHTNING_HORSE_VPIP_RECENT_HANDS) row.recent.shift();
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
 * the table engine's vpipFloor() read it). The window is the game's
 * vpip_window when the rules carry it, else tables.maintain_hands, as
 * fn_nit_policy reads it (review F8; the host rules carry only the table row
 * today, and both are ten in every fast-table game). Pure.
 */
export function lightningHorseVpipFloorInput(
  rules: Record<string, unknown> | null | undefined,
  /** The player's last `hands` hands this sitting (LightningHorseVpipLedger.readWindow). */
  ownFor: (hands: number) => LightningHorseVpipWindow
): LightningHorseVpipFloorInput | null {
  if (!rules || rules.nit_game !== true) return null;
  const floor = Number(rules.maintain_percent_min ?? 0);
  if (!Number.isFinite(floor) || !(floor > 0)) return null;
  const snapshot = rules.ruleset_snapshot as Record<string, unknown> | null | undefined;
  const fromGame = Number(rules.vpip_window ?? snapshot?.vpip_window);
  const fromTable = Number(rules.maintain_hands ?? 10);
  const raw = Number.isInteger(fromGame) && fromGame > 0 ? fromGame : fromTable;
  const windowHands = Number.isInteger(raw) && raw > 0 ? raw : 10;
  const own = ownFor(windowHands - 1);
  return {
    floor,
    windowHands,
    own: {
      hands: own.hands,
      vpipHands: own.vpipHands,
      leavingEntered: own.leavingEntered === true,
      fromFirstHand: own.fromFirstHand === true,
    },
  };
}
