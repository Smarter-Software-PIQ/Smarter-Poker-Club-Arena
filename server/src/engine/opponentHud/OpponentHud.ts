/**
 * OPPONENT HUD: THE ONE ACCESSOR (2026-11-20, PLO-OWNER lane OPPONENT-HUD)
 *
 * The decision side of the lifetime public profile (OpponentHudProfile.ts). The engine's main thread holds the warm
 * profiles (services/OpponentHudStore.ts) and, for a PLO4/PLO5 cash decision with the option omahaOpponentLifetimeHud
 * on, puts a compact packet of every live opponent's profile into the decision snapshot (`opponentHud`), so the
 * packet is journaled with the decision and an exact replay reads the same evidence. The worker installs that packet
 * for the decision in flight (installDecisionHud) and every rule reads it through hudStat / hudRecall here: one
 * function, one formula, for every opponent. Nothing here reads a database, a clock, a person/Horse flag or a name;
 * nothing here can throw into a decision (every entry point catches and answers with the population prior).
 *
 * The formula (no sample cliff): n = the opportunities of the statistic, blended HUD_LIFETIME_FLOOR of the lifetime
 * layer plus the rest of the recency layer at the decision time; p = (hits + k * prior) / (n + k), weight n / (n + k).
 * prior and k come per statistic from the population (fitted by the build job across every player; k by the method
 * of moments: how fast each statistic separates players), so a statistic contributes from its first observation in
 * proportion to its evidence and a new opponent reads exactly the population prior.
 */
import {
  HUD_LIFETIME_FLOOR,
  HUD_PROFILE_VERSION,
  HUD_RECENCY_HALF_LIFE_MS,
  HUD_STATS,
  hudStatIsRegistered,
  recallKeys,
  type HudBand,
  type HudCount,
  type HudDepth,
  type HudFamily,
  type HudPosition,
  type HudRecallCell,
  type HudStreet,
  type HudTexture,
  type OpponentHudProfile,
} from './OpponentHudProfile.js';
import { noteFire } from '../BrainTelemetry.js';

export const OPPONENT_HUD_OPTION = 'omahaOpponentLifetimeHud' as const;
export const HUD_PACKET_VERSION = 1 as const;
/** k when the population has no measured k for a statistic */
export const HUD_DEFAULT_K = 20;
export const HUD_K_MIN = 2;
export const HUD_K_MAX = 400;
/** L2 recall cells shipped per opponent (most observed first); L0 cells are all shipped, L1 for the current street */
export const HUD_PACKET_MAX_FINE_CELLS = 24;

/** stat -> [prior p, k] */
export type HudPriors = Record<string, [number, number]>;

export interface HudPacketOpponent {
  /** lifetime hands of this opponent in this family */
  hands: number;
  /** blended opportunities and hits per statistic at the decision time */
  eff: Record<string, HudCount>;
  /** recall cells: every L0 cell, L1 and L2 cells of the decision's street */
  rc: Record<string, HudRecallCell>;
}
export interface OpponentHudPacket {
  v: typeof HUD_PACKET_VERSION;
  family: HudFamily;
  /** the profile version the packet was built from */
  pv: typeof HUD_PROFILE_VERSION;
  /** population priors for this family */
  pri: HudPriors;
  opp: Record<string, HudPacketOpponent>;
}

const round = (x: number): number => Math.round(x * 100) / 100;
/** the packet's clock: the decision time to the minute, so a packet is cacheable and replays exactly */
export const hudPacketMinute = (at: number): number => Math.floor(at / 60_000) * 60_000;

/** Blend the two layers of one statistic at time `at` (pure). */
export function blendedCount(p: OpponentHudProfile, stat: string, at: number): HudCount {
  const life = p.life[stat] ?? [0, 0];
  const rec = p.rec[stat] ?? [0, 0];
  const k = at > p.recAt ? Math.pow(0.5, (at - p.recAt) / HUD_RECENCY_HALF_LIFE_MS) : 1;
  return [
    HUD_LIFETIME_FLOOR * life[0] + (1 - HUD_LIFETIME_FLOOR) * rec[0] * k,
    HUD_LIFETIME_FLOOR * life[1] + (1 - HUD_LIFETIME_FLOOR) * rec[1] * k,
  ];
}

/**
 * The packet of the live opponents for one decision (main thread). Deterministic for its inputs; bounded size.
 * Profiles of another family are skipped. `street` selects the detailed recall cells shipped.
 */
export function buildHudPacketOpponent(
  p: OpponentHudProfile,
  at: number,
  street: HudStreet
): HudPacketOpponent {
  const eff: Record<string, HudCount> = {};
  for (const stat of Object.keys(p.life)) {
    const c = blendedCount(p, stat, at);
    if (c[0] >= 0.005) eff[stat] = [round(c[0]), round(Math.min(c[0], c[1]))];
  }
  const rc: Record<string, HudRecallCell> = {};
  const fine: [string, HudRecallCell][] = [];
  for (const [key, cell] of Object.entries(p.recall)) {
    const parts = key.split('|');
    if (parts.length === 2) rc[key] = [...cell] as HudRecallCell;
    else if (parts[0] === street) {
      if (parts.length === 3) rc[key] = [...cell] as HudRecallCell;
      else fine.push([key, cell]);
    }
  }
  fine.sort((a, b) => b[1][0] - a[1][0] || (a[0] < b[0] ? -1 : 1));
  for (const [key, cell] of fine.slice(0, HUD_PACKET_MAX_FINE_CELLS))
    rc[key] = [...cell] as HudRecallCell;
  return { hands: p.hands, eff, rc };
}

/**
 * The packet of the live opponents for one decision (main thread). Deterministic for its inputs (the clock is taken
 * to the minute); bounded size. Profiles of another family are skipped. `street` selects the detailed recall cells.
 * `opponent` lets the caller supply a cached per-opponent entry (same inputs, same entry).
 */
export function buildHudPacket(
  family: HudFamily,
  profiles: readonly OpponentHudProfile[],
  priors: HudPriors,
  at: number,
  street: HudStreet,
  opponent: (
    p: OpponentHudProfile,
    minute: number,
    street: HudStreet
  ) => HudPacketOpponent = buildHudPacketOpponent
): OpponentHudPacket {
  const minute = hudPacketMinute(at);
  const opp: Record<string, HudPacketOpponent> = {};
  for (const p of profiles) {
    if (p.family !== family || p.v !== HUD_PROFILE_VERSION) continue;
    opp[p.user] = opponent(p, minute, street);
  }
  const pri: HudPriors = {};
  for (const stat of HUD_STATS) if (priors[stat]) pri[stat] = [priors[stat][0], priors[stat][1]];
  return { v: HUD_PACKET_VERSION, family, pv: HUD_PROFILE_VERSION, pri, opp };
}

/** Structural check of a packet arriving at the worker (a malformed packet is ignored, never thrown). */
export function validHudPacket(x: unknown): x is OpponentHudPacket {
  if (!x || typeof x !== 'object') return false;
  const p = x as OpponentHudPacket;
  if (p.v !== HUD_PACKET_VERSION || p.pv !== HUD_PROFILE_VERSION) return false;
  if (p.family !== 'plo4' && p.family !== 'plo5') return false;
  if (!p.pri || typeof p.pri !== 'object' || !p.opp || typeof p.opp !== 'object') return false;
  for (const o of Object.values(p.opp)) {
    if (!o || typeof o !== 'object' || !Number.isSafeInteger(o.hands)) return false;
    if (!o.eff || typeof o.eff !== 'object' || !o.rc || typeof o.rc !== 'object') return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Worker side: the packet of the decision in flight
// ---------------------------------------------------------------------------------------------------------------

let installed: OpponentHudPacket | null = null;
/** Install the decision's packet (worker, around the decide call). A malformed packet installs nothing. */
export function installDecisionHud(packet: unknown): void {
  installed = validHudPacket(packet) ? packet : null;
}
export function clearDecisionHud(): void {
  installed = null;
}
/** The installed packet's family, or null (test and receipt use). */
export function decisionHudFamily(): HudFamily | null {
  return installed?.family ?? null;
}

/** The installed blended counts of one opponent (OpponentHudExploit.ts), or undefined. */
export function decisionHudCounts(
  opponentId: string,
  family: HudFamily
): Readonly<Record<string, HudCount>> | undefined {
  return installed && installed.family === family ? installed.opp[opponentId]?.eff : undefined;
}

export interface HudRead {
  stat: string;
  family: HudFamily;
  /** shrunk estimate; null only when no prior is known and the opponent has no evidence */
  p: number | null;
  /** his own raw rate, null with no opportunity */
  raw: number | null;
  /** blended opportunities */
  n: number;
  hits: number;
  k: number;
  weight: number;
  prior: number | null;
  source: 'lifetime' | 'prior' | 'none';
  hands: number;
}

/**
 * THE accessor: any opponent statistic of the decision in flight, already shrunk. `prior` overrides the population
 * prior when the caller has a better context prior (its own measured cell for this spot); k stays the statistic's.
 * Never throws; with no packet, no opponent or an unregistered statistic it answers the prior (source 'prior') or
 * nothing (source 'none').
 */
export function hudStat(
  opponentId: string,
  family: HudFamily,
  stat: string,
  prior?: number | null,
  receipt = true
): HudRead {
  try {
    const pk = installed && installed.family === family ? installed : null;
    const pri = pk?.pri[stat];
    const k = pri ? Math.min(HUD_K_MAX, Math.max(HUD_K_MIN, pri[1])) : HUD_DEFAULT_K;
    const pr =
      typeof prior === 'number' && Number.isFinite(prior)
        ? Math.min(1, Math.max(0, prior))
        : pri
          ? pri[0]
          : null;
    const o = hudStatIsRegistered(stat) ? pk?.opp[opponentId] : undefined;
    const c = o?.eff[stat];
    const n = c ? c[0] : 0;
    const hits = c ? Math.min(c[0], c[1]) : 0;
    const raw = n > 0 ? hits / n : null;
    const weight = n / (n + k);
    const p = pr === null ? (n > 0 ? (hits + k * 0.5) / (n + k) : null) : (hits + k * pr) / (n + k);
    const source: HudRead['source'] = n > 0 ? 'lifetime' : pr !== null ? 'prior' : 'none';
    if (receipt) noteFire(`opponent_hud_read_${family}_${n > 0 ? 'lifetime' : 'prior'}`);
    return { stat, family, p, raw, n, hits, k, weight, prior: pr, source, hands: o?.hands ?? 0 };
  } catch {
    return {
      stat,
      family,
      p: typeof prior === 'number' ? prior : null,
      raw: null,
      n: 0,
      hits: 0,
      k: HUD_DEFAULT_K,
      weight: 0,
      prior: typeof prior === 'number' ? prior : null,
      source: typeof prior === 'number' ? 'prior' : 'none',
      hands: 0,
    };
  }
}

export interface HudSpot {
  street: HudStreet;
  /** preflop: p0 unopened, p1 vs one raise, p2 vs a 3-bet, p3 vs more. postflop: xA no bet yet and he was the last
   *  aggressor, x0 no bet yet, b1 facing a bet, b1x facing a bet after his check, r2 facing a raise, r2a facing a
   *  raise of his own wager */
  line: string;
  band?: HudBand | '-';
  position?: HudPosition;
  texture?: HudTexture | '-';
  depth?: HudDepth | '-';
}
export interface HudRecallLevel {
  key: string;
  instances: number;
  did: { fold: number; call: number; raise: number; check: number; bet: number };
  shown: number;
  shownStrong: number;
  won: number;
}
export interface HudRecall {
  family: HudFamily;
  /** the finest level with at least one instance, then the coarser ones (finest first) */
  levels: HudRecallLevel[];
  hands: number;
}

/** "What has this opponent done in spots like this before": his past instances of the spot at three levels of
 *  detail, what he did and what he showed when it went to showdown. Never throws. */
export function hudRecall(
  opponentId: string,
  family: HudFamily,
  spot: HudSpot,
  receipt = true
): HudRecall {
  try {
    const pk = installed && installed.family === family ? installed : null;
    const o = pk?.opp[opponentId];
    const keys = recallKeys({
      s: spot.street,
      ln: spot.line,
      b: spot.band ?? '-',
      pos: spot.position ?? 'EP',
      tx: spot.texture ?? '-',
      d: spot.depth ?? '-',
    });
    const levels: HudRecallLevel[] = [];
    // finest first; a fine key is only meaningful when every component was supplied
    const usable = [
      spot.position && spot.texture !== undefined && spot.depth !== undefined ? keys[2] : null,
      spot.band !== undefined ? keys[1] : null,
      keys[0],
    ];
    for (const key of usable) {
      if (!key) continue;
      const c = o?.rc[key];
      if (!c || !(c[0] > 0)) continue;
      levels.push({
        key,
        instances: c[0],
        did: { fold: c[1], call: c[2], raise: c[3], check: c[4], bet: c[5] },
        shown: c[6],
        shownStrong: c[7],
        won: c[8],
      });
    }
    if (receipt) noteFire(`opponent_hud_recall_${family}_${levels.length ? 'found' : 'none'}`);
    return { family, levels, hands: o?.hands ?? 0 };
  } catch {
    return { family, levels: [], hands: 0 };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Population (the build job and the main thread)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Fit the population prior and k of every statistic from a set of profiles (lifetime layer): prior = pooled rate;
 * k by the beta-binomial method of moments over players with at least `minOpp` opportunities:
 * between-player variance V of the rates (minus the binomial noise) gives k = p(1-p)/V - 1, clamped to
 * [HUD_K_MIN, HUD_K_MAX]; a statistic too thin to measure keeps HUD_DEFAULT_K.
 */
export function fitHudPriors(profiles: readonly OpponentHudProfile[], minOpp = 30): HudPriors {
  const out: HudPriors = {};
  for (const stat of HUD_STATS) {
    let O = 0;
    let H = 0;
    const rates: [number, number][] = [];
    for (const p of profiles) {
      const c = p.life[stat];
      if (!c || !(c[0] > 0)) continue;
      O += c[0];
      H += c[1];
      if (c[0] >= minOpp) rates.push([c[1] / c[0], c[0]]);
    }
    if (!(O > 0)) continue;
    const prior = H / O;
    let k = HUD_DEFAULT_K;
    if (rates.length >= 8 && prior > 0 && prior < 1) {
      const mean = rates.reduce((s, r) => s + r[0], 0) / rates.length;
      const varObs = rates.reduce((s, r) => s + (r[0] - mean) ** 2, 0) / (rates.length - 1);
      const noise = rates.reduce((s, r) => s + (prior * (1 - prior)) / r[1], 0) / rates.length;
      const between = varObs - noise;
      k = between > 0 ? (prior * (1 - prior)) / between - 1 : HUD_K_MAX;
      k = Math.min(HUD_K_MAX, Math.max(HUD_K_MIN, k));
    }
    out[stat] = [round(prior), round(k)];
  }
  return out;
}
