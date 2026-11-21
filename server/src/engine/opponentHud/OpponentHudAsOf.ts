/**
 * OPPONENT HUD AS OF A HAND (2026-11-20, lane OPPONENT-HUD; lead: replay, sparring and production read the same
 * structure). Offline builder for the exact-replay harness (MATHCORE-2) and the sparring benchmark (SPARRING): from
 * hand_history rows, oldest first, it gives every player's lifetime public profile as it stood BEFORE a given hand
 * (that hand and every later one excluded) and the decision packet production would have attached, built with the
 * same handRecordFromRow / applyHudHand / buildHudPacket the engine uses. Public actions and showdown-shown hands
 * only: handRecordFromRow copies no card from a player.
 *
 * Order: hands are applied in (created_at, id) order, the order the engine accepts them. One forward pass serves any
 * number of increasing "as of" queries; an earlier query rebuilds from the start.
 */
import {
  applyHudHandToProfiles,
  emptyHudProfile,
  handRecordFromRow,
  type HudFamily,
  type HudHandRecord,
  type HudStreet,
  type OpponentHudProfile,
} from './OpponentHudProfile.js';
import { buildHudPacket, type HudPriors, type OpponentHudPacket } from './OpponentHud.js';

export class OpponentHudAsOf {
  private readonly hands: HudHandRecord[] = [];
  private readonly index = new Map<string, number>();
  private profiles = new Map<string, OpponentHudProfile>();
  private applied = 0;

  /** rows: hand_history rows (any order; public fields are taken, cards never). PLO4/PLO5 cash only. */
  constructor(rows: Iterable<unknown>) {
    for (const r of rows) {
      const rec = handRecordFromRow(r);
      if (typeof rec !== 'string') this.hands.push(rec);
    }
    this.hands.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    this.hands.forEach((h, i) => this.index.set(h.id, i));
  }

  /** hands known to the builder */
  get size(): number {
    return this.hands.length;
  }

  private advanceTo(position: number): void {
    if (position < this.applied) {
      this.profiles = new Map();
      this.applied = 0;
    }
    for (; this.applied < position; this.applied++) {
      const rec = this.hands[this.applied];
      applyHudHandToProfiles(rec, (user) => {
        const k = `${rec.family}|${user}`;
        let p = this.profiles.get(k);
        if (!p) this.profiles.set(k, (p = emptyHudProfile(user, rec.family)));
        return p;
      });
    }
  }

  /** Position of a hand in the builder's order, or null when the hand is not in the rows. */
  positionOf(handId: string): number | null {
    return this.index.get(handId) ?? null;
  }

  /**
   * Profiles as they stood before the hand `handId` (null when the hand is unknown). With `users`, only those players'
   * profiles (absent players get none: the population prior). The returned profiles are live objects of the builder:
   * copy them (cloneHudProfile) before keeping them across another query.
   */
  profilesBefore(
    handId: string,
    family: HudFamily,
    users?: readonly string[]
  ): OpponentHudProfile[] | null {
    const pos = this.positionOf(handId);
    if (pos === null) return null;
    this.advanceTo(pos);
    const want = users ? new Set(users) : null;
    const out: OpponentHudProfile[] = [];
    for (const p of this.profiles.values())
      if (p.family === family && (!want || want.has(p.user))) out.push(p);
    return out.sort((a, b) => (a.user < b.user ? -1 : 1));
  }

  /**
   * Lifetime public counts [opportunities, hits] of the named statistics (registered ids, or context aliases resolved
   * with hudContextStatId) as they stood before the hand `handId`, per player: the replay twin of what production
   * reads through hudStat / hudStatIn (MATHCORE-2 opponent layer, STAB-DEFENCE). Null when the hand is unknown.
   */
  countsBefore(
    handId: string,
    family: HudFamily,
    users: readonly string[],
    stats: readonly string[]
  ): Record<string, Record<string, [number, number]>> | null {
    const profiles = this.profilesBefore(handId, family, users);
    if (profiles === null) return null;
    const out: Record<string, Record<string, [number, number]>> = {};
    for (const u of users) out[u] = {};
    for (const p of profiles)
      for (const st of stats) {
        const c = p.life[st];
        out[p.user][st] = c ? [c[0], Math.min(c[0], c[1])] : [0, 0];
      }
    return out;
  }

  /** The packet production would attach to a decision in hand `handId` facing `opponents` at `street`. */
  packetBefore(
    handId: string,
    family: HudFamily,
    opponents: readonly string[],
    priors: HudPriors,
    atMs: number,
    street: HudStreet
  ): OpponentHudPacket | null {
    const profiles = this.profilesBefore(handId, family, opponents);
    return profiles === null ? null : buildHudPacket(family, profiles, priors, atMs, street);
  }
}
