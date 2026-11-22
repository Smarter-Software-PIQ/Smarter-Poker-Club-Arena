/**
 * THE SPARRING BENCH LEARNS THE LIFETIME OPPONENT HUD (benchmark-only; PLO-OWNER lane REPLACEMENTS-3 2026-11-21).
 *
 * Lead ruling: there is ONE source of opponent reads, the HUD provider (engine/opponentHud). A rule that reads it
 * cannot be measured on a bench that never installs it: every read would be the population prior for ever. This file
 * gives every arm of a sparring cell its own in-memory store of lifetime public profiles and
 *   - installs, before every decision of the deal, the acting seat's packet of its opponents (the same
 *     buildHudPacket production attaches, built from the profiles as they stood BEFORE the hand in flight);
 *   - after every hand, feeds the hand's PUBLIC record (blinds, actions, board, who won, the hand NAME of a seat that
 *     showed down) through the bench converter HudHistoryRows -> handRecordFromRow -> applyHudHandToProfiles, the
 *     path the engine and the backfill use.
 * No hole card is ever handed to this file: its hand type has no field for one.
 *
 * Deterministic: the clock is the pair index (store epoch + pair x HUD_BENCH_HAND_MS), ids are digests of the seed.
 * A store may start from profiles exported as DATA by an earlier block (exportProfiles / spec.preload). It is never
 * warmed by playing a block inside the measuring process: that design moved the base arm and is void.
 * No runtime source may import this file (law test SparringLearnsTheHud.law.test.ts).
 */
import type { HandStage } from '../types.js';
import {
  buildHudPacket,
  clearDecisionHud,
  installDecisionHud,
  type HudPriors,
  type OpponentHudPacket,
} from '../engine/opponentHud/OpponentHud.js';
import {
  applyHudHandToProfiles,
  cloneHudProfile,
  emptyHudProfile,
  handRecordFromRow,
  validHudProfile,
  type HudFamily,
  type HudStreet,
  type OpponentHudProfile,
} from '../engine/opponentHud/OpponentHudProfile.js';
import { simulatedHandToHistoryRow, type SimAction, type SimulatedHand } from './HudHistoryRows.js';

/** The bench clock: hand p of a cell is dealt at HUD_BENCH_T0 + p x HUD_BENCH_HAND_MS (30 s a hand). */
export const HUD_BENCH_T0 = Date.UTC(2026, 0, 1);
export const HUD_BENCH_HAND_MS = 30_000;

export interface SparringHudSpec {
  /** population priors of the cell's family (data: fitHudPriors of public hands). Absent = {} : a read with no
   *  lifetime count then answers the caller's own prior, exactly as in production with no population row. */
  priors?: HudPriors;
  /** profiles exported by an earlier block (exportProfiles), every arm and deal starts from a copy */
  preload?: readonly unknown[];
  /** return every store's profiles in the cell result (to pre-load a later block from data) */
  exportProfiles?: boolean;
}

/** The public facts of one finished deal, as the hand observer reports them. There is no card of a player here. */
export interface SparringHudHand {
  pair: number;
  /** which deal of the pair this store follows (keeps the two deals' hand ids apart) */
  deal: string;
  seed: number;
  variant: HudFamily;
  bigBlind: number;
  smallBlind: number;
  /** big-blind ante in chips, 0 = none */
  ante: number;
  /** 1-based */
  buttonSeat: number;
  /** user id by seat index, and the stack every seat started the hand with */
  users: readonly string[];
  stack: number;
  actions: ReadonlyArray<{ seatIdx: number; stage: HandStage; action: string; amount: number }>;
  board: readonly string[];
  shown: ReadonlyArray<{ seatIdx: number; handName: string }>;
  winnings: readonly number[];
}

const SIM_ACTIONS = new Set<string>(['fold', 'check', 'call', 'bet', 'raise', 'all_in']);
const STREETS = new Set<string>(['preflop', 'flop', 'turn', 'river']);

/** One arm's (and one deal's) lifetime store. */
export class SparringHudStore {
  private readonly profiles = new Map<string, OpponentHudProfile>();
  private readonly cache = new Map<string, OpponentHudPacket>();
  readonly counts = { hands: 0, refused: 0, applied: 0, packets: 0 };
  /** the time of this store's first hand: the bench epoch, or one hand after the newest pre-loaded hand */
  readonly t0: number;
  constructor(
    readonly family: HudFamily,
    private readonly priors: HudPriors = {},
    preload: readonly unknown[] = []
  ) {
    for (const p of preload)
      if (validHudProfile(p) && p.family === family) this.profiles.set(p.user, cloneHudProfile(p));
    let wm = -1;
    for (const p of this.profiles.values()) wm = Math.max(wm, p.wm);
    this.t0 = wm < 0 ? HUD_BENCH_T0 : Math.max(HUD_BENCH_T0, wm + HUD_BENCH_HAND_MS);
  }
  /** when hand `pair` of the cell is dealt in this store's time */
  clockMs(pair: number): number {
    return this.t0 + pair * HUD_BENCH_HAND_MS;
  }

  /** The packet seat `heroIdx` is given for a decision on `street` of the hand dealt at `atMs`. */
  packetFor(
    users: readonly string[],
    heroIdx: number,
    street: HudStreet,
    atMs: number
  ): OpponentHudPacket {
    const k = `${heroIdx}|${street}`;
    let pk = this.cache.get(k);
    if (!pk) {
      const hero = users[heroIdx];
      const ids = [...new Set(users)].filter((u) => u !== hero).sort();
      const profiles: OpponentHudProfile[] = [];
      for (const u of ids) {
        const p = this.profiles.get(u);
        if (p) profiles.push(p);
      }
      pk = buildHudPacket(this.family, profiles, this.priors, atMs, street);
      this.cache.set(k, pk);
      this.counts.packets++;
    }
    return pk;
  }

  /** Install the acting seat's packet for the decision about to be asked in hand `pair`. */
  install(users: readonly string[], heroIdx: number, stage: HandStage, pair: number): void {
    const atMs = this.clockMs(pair);
    if (!STREETS.has(stage)) {
      clearDecisionHud();
      return;
    }
    installDecisionHud(this.packetFor(users, heroIdx, stage as HudStreet, atMs));
  }

  /** Feed one finished hand (public record only). */
  learn(h: SparringHudHand): void {
    this.cache.clear();
    this.counts.hands++;
    const n = h.users.length;
    const idx = (seatNo: number) => (seatNo - 1 + n) % n;
    const sb = n === 2 ? idx(h.buttonSeat) : idx(h.buttonSeat + 1);
    const bb = n === 2 ? idx(h.buttonSeat + 1) : idx(h.buttonSeat + 2);
    const actions: SimulatedHand['actions'] = [
      { seat: sb + 1, stage: 'preflop', action: 'sb', amount: h.smallBlind },
      { seat: bb + 1, stage: 'preflop', action: 'bb', amount: h.bigBlind },
    ];
    if (h.ante > 0)
      actions.push({ seat: bb + 1, stage: 'preflop', action: 'ante', amount: h.ante });
    for (const a of h.actions) {
      if (!SIM_ACTIONS.has(a.action) || !STREETS.has(a.stage)) continue;
      actions.push({
        seat: a.seatIdx + 1,
        stage: a.stage as HudStreet,
        action: a.action as SimAction,
        amount: a.amount,
      });
    }
    const sim: SimulatedHand = {
      seed: `${h.seed}|${h.deal}|${this.t0}`,
      handNo: h.pair,
      startedAtMs: this.clockMs(h.pair),
      variant: h.variant,
      bigBlind: h.bigBlind,
      buttonSeat: h.buttonSeat,
      players: h.users.map((u, i) => ({ seat: i + 1, player: u, stack: h.stack })),
      actions,
      board: [...h.board],
      showdown: h.shown.map((s) => ({ seat: s.seatIdx + 1, mucked: false, handName: s.handName })),
      winners: h.winnings.map((amount, i) => ({ seat: i + 1, amount })).filter((w) => w.amount > 0),
    };
    const rec = handRecordFromRow(simulatedHandToHistoryRow(sim, { ids: 'keep' }));
    if (typeof rec === 'string') {
      this.counts.refused++;
      return;
    }
    const out = applyHudHandToProfiles(rec, (user) => {
      let p = this.profiles.get(user);
      if (!p) this.profiles.set(user, (p = emptyHudProfile(user, this.family)));
      return p;
    });
    for (const r of out.values()) r === null ? this.counts.applied++ : this.counts.refused++;
  }

  profileOf(user: string): OpponentHudProfile | undefined {
    return this.profiles.get(user);
  }
  /** The store as data (copies), users in order: what a later block pre-loads. */
  exportProfiles(): OpponentHudProfile[] {
    return [...this.profiles.keys()].sort().map((u) => cloneHudProfile(this.profiles.get(u)!));
  }
}

/** The board as hand_history writes it ('Ah', 'Td'). */
export function sparringBoardKeys(board: ReadonlyArray<{ rank: string; suit: string }>): string[] {
  return board.map((c) => (c.rank === '10' ? 'T' : c.rank) + c.suit[0].toLowerCase());
}
