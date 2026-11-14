/**
 * PER-HORSE UPGRADE EVIDENCE (2026-11-14)
 *
 * The brain counters (BrainTelemetry.noteFire) are fleet totals: "upgrade 02
 * fired 81,000 times today" says nothing about which of the 1,000 Horses it
 * fired for. This module keeps, per UTC day, Horse, game variant, lane and
 * upgrade, two counters:
 *
 *   decisions  opportunities: the FAST brain decisions that Horse made in
 *              that variant and lane (written by the decision worker to every
 *              enabled upgrade the manifest declares there), plus that Horse's
 *              host-side opportunities for the upgrade (noteHorseUpgradeEvent);
 *   invoked    the opportunities among them in which the upgrade was
 *              exercised: brain decisions in which at least one of its evidence
 *              counters fired (HORSE_UPGRADE_LIVE_EVIDENCE), plus every
 *              host-side opportunity. No opportunity is reported twice; the
 *              rule is stated at noteHorseUpgradeEvent.
 *
 * MEASUREMENT ONLY. Nothing here is read by a decision; the fold happens after
 * the decision is made. No IO: services/HorseUpgradeEvidenceFlush.ts drains
 * the aggregate every 300 seconds. Off until that service arms it, so a league run,
 * a replay or a test that never starts the flush accumulates nothing.
 *
 * BOUNDED. At most HORSE_UPGRADE_EVIDENCE_MAX_CELLS (day, Horse, variant, lane,
 * upgrade) cells are held between drains. An increment that would open a cell
 * beyond that is dropped and counted (per_horse_evidence_cell_dropped_seen),
 * never queued.
 *
 * WHAT A NEEDLE IS. The manifest lists each upgrade's counters as source text:
 * a quoted needle is one exact counter name, a needle that opens with a
 * backtick is the fixed prefix of a templated name. That is the manifest's own
 * rule (HorseUpgradeActivationManifest.ts) and the one
 * HorseStyleVariantModeMatrix.law.test.ts applies; it is compiled once here.
 */
import {
  normalizeWatchcounterMode,
  normalizeWatchcounterVariant,
  noteFire,
} from './BrainTelemetry.js';
import {
  HORSE_UPGRADE_LIVE_EVIDENCE,
  computeHorseUpgradeActivationManifest,
} from './HorseUpgradeActivationManifest.js';

export const HORSE_UPGRADE_EVIDENCE_MAX_CELLS = 8192;

export type HorseUpgradeEvidenceLane = 'cash' | 'tournament';

export interface HorseUpgradeEvidenceRow {
  /** UTC day, YYYY-MM-DD. */
  day: string;
  horseUserId: string;
  gameVariant: string;
  lane: HorseUpgradeEvidenceLane;
  upgradeId: string;
  decisions: number;
  invoked: number;
}

interface NeedleTable {
  /** The manifest's upgrade ids, in its order; every per-upgrade array is indexed like this. */
  ids: readonly string[];
  index: ReadonlyMap<string, number>;
  exact: ReadonlyMap<string, readonly number[]>;
  prefixes: ReadonlyArray<{ prefix: string; index: number }>;
  scratch: Uint8Array;
}
let compiled: NeedleTable | null = null;
/**
 * Compiled once, on first use rather than at import: the host files that
 * import this module sit in import cycles with the manifest's own imports, and
 * a table built while this module is being evaluated could read the manifest
 * before it exists.
 */
function needles(): NeedleTable {
  if (compiled) return compiled;
  const ids = Object.keys(HORSE_UPGRADE_LIVE_EVIDENCE);
  const index = new Map(ids.map((id, at) => [id, at]));
  const exact = new Map<string, number[]>();
  const prefixes: Array<{ prefix: string; index: number }> = [];
  for (const [id, list] of Object.entries(HORSE_UPGRADE_LIVE_EVIDENCE)) {
    const at = index.get(id)!;
    for (const needle of list) {
      if (needle.startsWith('`')) prefixes.push({ prefix: needle.slice(1), index: at });
      else {
        const key = needle.slice(1, -1);
        const owners = exact.get(key);
        if (owners) owners.push(at);
        else exact.set(key, [at]);
      }
    }
  }
  compiled = { ids, index, exact, prefixes, scratch: new Uint8Array(ids.length) };
  return compiled;
}

/** Mark, in `flags`, every upgrade one of whose evidence counters is in `fired`. */
function markInvoked(fired: Iterable<string>, flags: Uint8Array): void {
  const { exact, prefixes } = needles();
  for (const key of fired) {
    const owners = exact.get(key);
    if (owners) for (const index of owners) flags[index] = 1;
    for (const { prefix, index } of prefixes) if (key.startsWith(prefix)) flags[index] = 1;
  }
}

/** The upgrades whose evidence counters appear in `fired`, in manifest order. Unknown counters map to nothing. */
export function upgradeIdsForFires(fired: Iterable<string>): string[] {
  const { ids } = needles();
  const flags = new Uint8Array(ids.length);
  markInvoked(fired, flags);
  return ids.filter((_, index) => flags[index] === 1);
}

interface Group {
  day: string;
  horseUserId: string;
  gameVariant: string;
  lane: HorseUpgradeEvidenceLane;
  /** Indexed like the needle table's ids. A cell exists when its decisions are above zero. */
  decisions: number[];
  invoked: number[];
}

const groups = new Map<string, Group>();
let cells = 0;
let armed = false;
/** `${variant}|${lane}` -> the enabled upgrades the manifest declares there (indexes into the needle table's ids). */
const declared = new Map<string, readonly number[]>();
const NONE: readonly number[] = [];

/**
 * Armed once by the flush service at boot (so nothing accumulates in a process
 * that will never drain). Reads the manifest's enabled upgrades and where each
 * is declared, once, outside any decision.
 */
export function enableHorseUpgradeEvidence(): void {
  if (armed) return;
  const byScope = new Map<string, number[]>();
  for (const entry of computeHorseUpgradeActivationManifest().upgrades) {
    const index = needles().index.get(entry.id);
    if (!entry.enabled || index === undefined) continue;
    for (const variant of entry.variants)
      for (const mode of entry.modes) {
        const scope = `${variant}|${mode}`;
        const list = byScope.get(scope);
        if (list) list.push(index);
        else byScope.set(scope, [index]);
      }
  }
  for (const [scope, list] of byScope) declared.set(scope, list);
  armed = true;
}

/**
 * True once the flush service has armed the aggregate. Host call sites check it
 * before they read the variant and lane for an event, so a process (or a test
 * fixture) that never drains evidence does no work for it at all.
 */
export function horseUpgradeEvidenceArmed(): boolean {
  return armed;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The writer stores a uuid; anything else is refused here so it can never fail a whole batch there. */
function horseId(userId: unknown): string | null {
  if (typeof userId !== 'string') return null;
  if (UUID.test(userId)) return userId;
  const lower = userId.toLowerCase();
  return UUID.test(lower) ? lower : null;
}

let dayIndex = -1;
let dayText = '';
function utcDay(): string {
  const index = Math.floor(Date.now() / 86_400_000);
  if (index !== dayIndex) {
    dayIndex = index;
    dayText = new Date(index * 86_400_000).toISOString().slice(0, 10);
  }
  return dayText;
}

const groupKey = (
  day: string,
  horseUserId: string,
  gameVariant: string,
  lane: HorseUpgradeEvidenceLane
): string => `${day}|${horseUserId}|${gameVariant}|${lane}`;

/**
 * Add to one cell, opening it if the cap allows. A refused cell is counted and
 * dropped. `key` is groupKey of the four fields, built once per decision.
 */
function add(
  key: string,
  day: string,
  horseUserId: string,
  gameVariant: string,
  lane: HorseUpgradeEvidenceLane,
  index: number,
  decisions: number,
  invoked: number
): void {
  let group = groups.get(key);
  const opens = !group || group.decisions[index] === 0;
  if (opens && cells >= HORSE_UPGRADE_EVIDENCE_MAX_CELLS) {
    noteFire('per_horse_evidence_cell_dropped_seen');
    return;
  }
  if (!group) {
    group = {
      day,
      horseUserId,
      gameVariant,
      lane,
      decisions: new Array<number>(needles().ids.length).fill(0),
      invoked: new Array<number>(needles().ids.length).fill(0),
    };
    groups.set(key, group);
  }
  if (opens) cells++;
  group.decisions[index] += decisions;
  group.invoked[index] += invoked;
}

/**
 * One finished decision by one Horse. `fired` is the set of counters that
 * decision fired (BrainTelemetry.withDecisionFireScope). Every enabled upgrade
 * declared for the variant and lane gets one decision; the ones with a fired
 * evidence counter also get one invocation. An upgrade that fired where the
 * manifest does not declare it is recorded as it happened (one decision, one
 * invocation), so invoked never exceeds decisions.
 */
export function noteHorseUpgradeDecision(
  userId: string,
  variant: string | undefined,
  mode: string | undefined,
  fired: Iterable<string>
): void {
  if (!armed) return;
  const horse = horseId(userId);
  if (!horse) {
    noteFire('per_horse_evidence_identity_refused_seen');
    return;
  }
  const gameVariant = normalizeWatchcounterVariant(variant);
  const lane = normalizeWatchcounterMode(mode);
  const day = utcDay();
  const key = groupKey(day, horse, gameVariant, lane);
  const { scratch } = needles();
  scratch.fill(0);
  markInvoked(fired, scratch);
  for (const index of declared.get(`${gameVariant}|${lane}`) ?? NONE) {
    add(key, day, horse, gameVariant, lane, index, 1, scratch[index]!);
    scratch[index] = 0;
  }
  for (let index = 0; index < scratch.length; index++)
    if (scratch[index] === 1) add(key, day, horse, gameVariant, lane, index, 1, 1);
}

/**
 * One host-side opportunity of an upgrade for one Horse, outside any brain
 * decision: a run-it-twice choice or answer, an insurance offer, a purged
 * pre-action. It is its own opportunity, so it counts one decision and one
 * invocation in that upgrade's cell.
 *
 * WHAT THE TWO COUNTERS MEAN FOR AN UPGRADE WITH BOTH SOURCES (08, 09). The
 * workers and the main process write to the same cell and the writer adds
 * them, so the rule is that no opportunity is reported by both:
 *   decisions = the Horse's FAST brain decisions in that variant and lane
 *               (worker fold) + its host-side opportunities (this function);
 *   invoked   = the brain decisions in which an evidence counter of the
 *               upgrade fired + every host-side opportunity.
 * So a host counter that describes a brain decision (kill-pot or seven-deuce
 * context on a decision request) must NOT call this: that decision is counted
 * once, by the worker fold, with the brain's own upgrade08 reads. And a counter
 * that is the same opportunity seen again (the three insurance answers after
 * the offer) must not call it either. HorsePerHorseUpgradeEvidence.law.test.ts
 * pins both. An id the manifest does not list is ignored.
 */
export function noteHorseUpgradeEvent(
  userId: string,
  variant: string | undefined,
  mode: string | undefined,
  upgradeId: string
): void {
  if (!armed) return;
  const index = needles().index.get(upgradeId);
  if (index === undefined) return;
  const horse = horseId(userId);
  if (!horse) {
    noteFire('per_horse_evidence_identity_refused_seen');
    return;
  }
  const day = utcDay();
  const gameVariant = normalizeWatchcounterVariant(variant);
  const lane = normalizeWatchcounterMode(mode);
  add(groupKey(day, horse, gameVariant, lane), day, horse, gameVariant, lane, index, 1, 1);
}

/** Take every cell and empty the aggregate (the flush service and tests). */
export function drainHorseUpgradeEvidence(): HorseUpgradeEvidenceRow[] {
  const rows: HorseUpgradeEvidenceRow[] = [];
  if (groups.size === 0) return rows;
  const { ids } = needles();
  for (const group of groups.values())
    for (let index = 0; index < ids.length; index++)
      if (group.decisions[index]! > 0)
        rows.push({
          day: group.day,
          horseUserId: group.horseUserId,
          gameVariant: group.gameVariant,
          lane: group.lane,
          upgradeId: ids[index]!,
          decisions: group.decisions[index]!,
          invoked: group.invoked[index]!,
        });
  groups.clear();
  cells = 0;
  return rows;
}

/**
 * Put rows back after a write that is known not to have landed. Additive: a
 * cell that has counted since the drain keeps both. The cap still holds; a row
 * that would open a cell beyond it is dropped and counted like any other.
 */
export function restoreHorseUpgradeEvidence(rows: readonly HorseUpgradeEvidenceRow[]): void {
  for (const row of rows) {
    const index = needles().index.get(row.upgradeId);
    if (index === undefined || !(row.decisions > 0)) continue;
    add(
      groupKey(row.day, row.horseUserId, row.gameVariant, row.lane),
      row.day,
      row.horseUserId,
      row.gameVariant,
      row.lane,
      index,
      row.decisions,
      row.invoked
    );
  }
}
