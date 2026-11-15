/**
 * HOLD'EM PERSONA PREFLOP PROBE (2026-11-15, option holdemPersonaPreflop,
 * default OFF). The opportunity-weighted per-archetype preflop frequencies,
 * option off and option on, on the same deals: VPIP and PFR per hand dealt,
 * RFI per unopened opportunity, cold call and 3-bet per single-raise
 * opportunity (any number of callers, so squeezes are inside the 3-bet), with
 * Wilson 95% intervals. Built on HoldemPreflopProbe: 900 synthetic ids in
 * exactly the model's 25/20/40/15 archetype mix, tables of `seats`, every
 * seat rotation, a hand identity on every decision as in live play.
 *
 * The two arms are separate runs from the same seeds (the deck generator is
 * not the brain's), so they are dealt the same cards but their streams part
 * at the first changed decision: two samples, not pairs.
 *
 * Limits: synthetic ids, Horses against Horses, preflop only, decisions made
 * with opponent memory off (so the Nit Hunter's punish rule, which needs a
 * credible read, never engages here), no table VPIP floor. The CLI is
 * server/scripts/holdem-persona-preflop-probe.ts. Pure and seeded.
 */
import { seedFastRandom } from '../engine/HorseEval.js';
import { holdemPersonaFor, type HorseHoldemArchetype } from '../engine/HorsePersona.js';
import { HOLDEM_PERSONA_VPIP_BAND } from '../engine/HorseHoldemPersonaPreflop.js';
import {
  PROBE_ARCHETYPES,
  playProbeHand,
  probeRng,
  syntheticFleet,
  syntheticHorseId,
  type ProbeArm,
  type ProbeMode,
  type ProbeTable,
} from './HoldemPreflopProbe.js';
import { wilson95 } from './HoldemPersonaReRaiseProbe.js';

export interface FreqTally {
  hands: number;
  vpip: number;
  pfr: number;
  rfiOpp: number;
  rfi: number;
  facingOneRaise: number;
  coldCall: number;
  threeBet: number;
}
const emptyTally = (): FreqTally => ({
  hands: 0,
  vpip: 0,
  pfr: 0,
  rfiOpp: 0,
  rfi: 0,
  facingOneRaise: 0,
  coldCall: 0,
  threeBet: 0,
});

export type PersonaGroup = HorseHoldemArchetype | 'fleet';
export const PERSONA_GROUPS: readonly PersonaGroup[] = [...PROBE_ARCHETYPES, 'fleet'];

export interface PersonaPreflopOptions {
  seats?: number;
  mode?: ProbeMode;
  depthBB?: number | readonly [number, number];
  /** Hands per table per seat rotation (700 at nine seats: 630,000 hands). */
  handsPerRotation?: number;
  seed?: number;
  ids?: readonly string[];
}

export interface PersonaPreflopReport {
  seats: number;
  mode: ProbeMode;
  depthBB: number | readonly [number, number];
  seed: number;
  ids: number;
  tables: number;
  handsPerArm: number;
  arms: Record<'off' | 'on', Record<PersonaGroup, FreqTally>>;
}

const isRaise = (a: string) => a === 'raise' || a === 'bet' || a === 'all_in';

export function measurePersonaPreflop(o: PersonaPreflopOptions = {}): PersonaPreflopReport {
  const seats = o.seats ?? 9;
  const mode = o.mode ?? 'cash';
  const depthBB = o.depthBB ?? 100;
  const handsPerRotation = o.handsPerRotation ?? 700;
  const seed = o.seed ?? 20261115;
  const fleet = o.ids ?? syntheticFleet();
  const tables = Math.floor(fleet.length / seats);
  const ids = fleet.slice(0, tables * seats);
  const archetypeOf = new Map(ids.map((id) => [id, holdemPersonaFor(id).archetype]));
  const arms = {} as PersonaPreflopReport['arms'];
  let handsPerArm = 0;
  for (const arm of ['off', 'on'] as const) {
    const tally = Object.fromEntries(PERSONA_GROUPS.map((g) => [g, emptyTally()])) as Record<
      PersonaGroup,
      FreqTally
    >;
    const r = probeRng(seed + seats * 7919);
    seedFastRandom((seed + seats * 104729) >>> 0);
    let hands = 0;
    for (let t = 0; t < tables; t++) {
      const seated = ids.slice(t * seats, (t + 1) * seats);
      const tableId = syntheticHorseId(710000000 + t);
      for (let rot = 0; rot < seats; rot++) {
        const rotated = seated.map((_, i) => seated[(i + rot) % seats]);
        const table: ProbeTable = { variant: 'nlh', mode, ids: rotated, depthBB };
        for (let h = 0; h < handsPerRotation; h++) {
          hands++;
          const base = {
            mindPlanContext: {
              version: 1,
              hand: { version: 1, tableId, handNumber: 1000000 + hands },
            },
          };
          const A: ProbeArm = {
            opts: arm === 'on' ? { ...base, holdemPersonaPreflop: true } : base,
          };
          const voluntary = new Set<string>();
          const raised = new Set<string>();
          playProbeHand(table, r, [A], (spot) => {
            const action = spot.reads[0].action;
            const groups: PersonaGroup[] = [archetypeOf.get(spot.heroId)!, 'fleet'];
            const raise = isRaise(action);
            if (raise || action === 'call') voluntary.add(spot.heroId);
            if (raise) raised.add(spot.heroId);
            for (const g of groups) {
              const c = tally[g];
              if (spot.raises === 0 && spot.limpers === 0) {
                c.rfiOpp++;
                if (raise) c.rfi++;
              }
              if (spot.raises === 1) {
                c.facingOneRaise++;
                if (raise) c.threeBet++;
                else if (action === 'call') c.coldCall++;
              }
            }
          });
          for (const id of rotated) {
            for (const g of [archetypeOf.get(id)!, 'fleet'] as PersonaGroup[]) {
              const c = tally[g];
              c.hands++;
              if (voluntary.has(id)) c.vpip++;
              if (raised.has(id)) c.pfr++;
            }
          }
        }
      }
    }
    arms[arm] = tally;
    handsPerArm = hands;
  }
  return { seats, mode, depthBB, seed, ids: ids.length, tables, handsPerArm, arms };
}

const pct = (k: number, n: number) => (n > 0 ? (100 * k) / n : 0);
const fmtRate = (k: number, n: number): string => {
  if (n === 0) return 'n/a';
  const w = wilson95(k, n);
  return `${pct(k, n).toFixed(2)} (${(100 * w.low).toFixed(2)}-${(100 * w.high).toFixed(2)})`;
};

export function formatPersonaPreflopReport(rep: PersonaPreflopReport): string {
  const depth =
    typeof rep.depthBB === 'number' ? `${rep.depthBB}bb` : `${rep.depthBB[0]}-${rep.depthBB[1]}bb`;
  const lines = [
    `${rep.seats}-handed ${rep.mode} ${depth}: ${rep.ids} ids, ${rep.tables} tables x ${rep.seats} rotations, ${rep.handsPerArm} hands per arm, seed ${rep.seed}; arms unpaired (same deals); opponent memory off`,
    '',
    '| arm | group | hands | VPIP % (95%) | PFR % | RFI per unopened % | cold call per single raise % | 3-bet per single raise % | VPIP band | inside |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const arm of ['off', 'on'] as const)
    for (const g of PERSONA_GROUPS) {
      const c = rep.arms[arm][g];
      const band = g === 'fleet' ? ([25, 30] as const) : HOLDEM_PERSONA_VPIP_BAND[g];
      const v = pct(c.vpip, c.hands);
      lines.push(
        `| ${arm} | ${g} | ${c.hands} | ${fmtRate(c.vpip, c.hands)} | ${fmtRate(c.pfr, c.hands)} | ${fmtRate(c.rfi, c.rfiOpp)} (n ${c.rfiOpp}) | ${fmtRate(c.coldCall, c.facingOneRaise)} | ${fmtRate(c.threeBet, c.facingOneRaise)} (n ${c.facingOneRaise}) | ${band[0]}-${band[1]} | ${v >= band[0] && v <= band[1] ? 'yes' : 'NO'} |`
      );
    }
  lines.push(
    '',
    '| group | VPIP change on - off (points) | PFR change | 3-bet change |',
    '| --- | --- | --- | --- |'
  );
  for (const g of PERSONA_GROUPS) {
    const a = rep.arms.off[g];
    const b = rep.arms.on[g];
    lines.push(
      `| ${g} | ${(pct(b.vpip, b.hands) - pct(a.vpip, a.hands)).toFixed(2)} | ${(pct(b.pfr, b.hands) - pct(a.pfr, a.hands)).toFixed(2)} | ${(pct(b.threeBet, b.facingOneRaise) - pct(a.threeBet, a.facingOneRaise)).toFixed(2)} |`
    );
  }
  return lines.join('\n');
}
