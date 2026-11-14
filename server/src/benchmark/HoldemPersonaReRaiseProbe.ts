/**
 * HOLD'EM PERSONA RE-RAISE PROBE (2026-11-14, D3 option C, option
 * holdemPersonaReRaiseMix, default OFF). The opportunity-weighted measurement
 * of the three persona behaviours (3-bet bluff, squeeze bluff, 26-35bb
 * four-bet reshove bluff), built on HoldemPreflopProbe: a fleet of synthetic
 * ids in exactly the model's 25/20/40/15 archetype mix, every seat rotation,
 * preflop only, the option on and off on the same code.
 *
 * PAIRED (the primary table). The option-off run decides every spot a second
 * time with the option on FROM THE SAME STREAM POSITION and discards it. At
 * each spot that second look reaches a persona comparison, the pair is the
 * off decision and the on decision of the same Horse, cards, state and
 * draws: taken off, taken on, changed up (on only), changed down (off only),
 * with a 95% interval on each rate and on the paired difference.
 *
 * UNPAIRED (secondary). An option-on run and the option-off run dealt the
 * same cards from the same seeds. Their streams part at the first changed
 * decision, so later opponents act differently: two samples, not pairs.
 *
 * "Taken" is the FINAL action in both arms: the 3-bet bluff or squeeze bluff
 * branch itself (recorded after the fold-equity test), and for the reshove an
 * all-in. The persona's own verdict (its comparison, before any later layer)
 * is reported separately, from the engine's offline measurement tap, which
 * also gives the site's unscaled probability p. That is what lets the probe
 * report where min(1, p * scale) binds and where p is above 1 over the
 * largest scale (the one-sided region: a Horse above the average cannot pass
 * 1, a Horse below it still goes down), with the expected and measured loss.
 *
 * Limits: synthetic ids, not the fleet's; Horses against Horses; preflop
 * only; no top-up, no postflop, no humans; decisions made with mind off (so
 * no style read ever engages here). The CLI is
 * server/scripts/holdem-persona-reraise-probe.ts. Pure and seeded.
 */
import { seedFastRandom } from '../engine/HorseEval.js';
import {
  HOLDEM_ARCHETYPE_NLH_3BET_MIX,
  HOLDEM_MODEL_MEAN_NLH_3BET_MIX,
  holdemPersonaFor,
  holdemPersonaReRaiseScale,
  type HorseHoldemArchetype,
} from '../engine/HorsePersona.js';
import {
  setHoldemPersonaReRaiseTap,
  type HoldemPersonaReRaiseTapEvent,
} from '../engine/HorsePreflop.js';
import {
  PROBE_ARCHETYPES,
  playProbeHand,
  probeRng,
  syntheticFleet,
  syntheticHorseId,
  type ProbeArm,
  type ProbeMode,
  type ProbeRead,
  type ProbeTable,
} from './HoldemPreflopProbe.js';

export * from './HoldemPreflopProbe.js';

export type PersonaBehaviour = 'threeBetBluff' | 'squeezeBluff' | 'fourBetReshove';
export const PERSONA_BEHAVIOURS: readonly PersonaBehaviour[] = [
  'threeBetBluff',
  'squeezeBluff',
  'fourBetReshove',
];
const BEHAVIOUR_OF: Record<HoldemPersonaReRaiseTapEvent['kind'], PersonaBehaviour> = {
  three_bet: 'threeBetBluff',
  squeeze: 'squeezeBluff',
  four_bet: 'fourBetReshove',
};

/**
 * The reshove's effective-stack buckets (low exclusive, high inclusive). The
 * site is named 26-35bb but its gate is "over 25, up to 35", so the first
 * bucket is the part below 26 that the name leaves out.
 */
export const RESHOVE_STACK_BUCKETS: readonly (readonly [number, number])[] = [
  [25, 26],
  [26, 28],
  [28, 30],
  [30, 32],
  [32, 35],
];
const stackBucketOf = (effBB: number): string => {
  for (const [lo, hi] of RESHOVE_STACK_BUCKETS)
    if (effBB > lo && effBB <= hi) return `${lo}-${hi}bb`;
  return 'other';
};

/** The id-hash model's scales and their weights (two-decimal mixes). */
const MODEL_SCALES: readonly { scale: number; weight: number }[] = (() => {
  const w = new Map<number, number>();
  for (const a of HOLDEM_ARCHETYPE_NLH_3BET_MIX)
    for (let h = 0; h < 1000; h++) {
      const mix = Math.round((a.base + (h / 1000) * a.span) * 100) / 100;
      w.set(mix, (w.get(mix) ?? 0) + a.sharePct / 100 / 1000);
    }
  return [...w.entries()].map(([mix, weight]) => ({
    scale: mix / HOLDEM_MODEL_MEAN_NLH_3BET_MIX,
    weight,
  }));
})();
/** The largest scale a Horse can have, and the probability above which the
 *  3-bet and squeeze bluffs are one-sided (p * maxScale > 1). */
export const MAX_PERSONA_SCALE = Math.max(...MODEL_SCALES.map((m) => m.scale));
export const ONE_SIDED_P = 1 / MAX_PERSONA_SCALE;
const modelOn = (p: number): number =>
  MODEL_SCALES.reduce((a, m) => a + m.weight * Math.min(1, p * m.scale), 0);

/**
 * "Taken", ONE definition for both arms: the final action. The reshove is an
 * all-in; the 3-bet bluff and the squeeze bluff are the bluff branch itself.
 * Never the persona's own verdict, which a later layer can overrule.
 */
export const personaTaken = (
  b: PersonaBehaviour,
  r: Pick<ProbeRead, 'action' | 'bluffBranch'>
): boolean => (b === 'fourBetReshove' ? r.action === 'all_in' : r.bluffBranch);

export function wilson95(taken: number, n: number): { low: number; high: number } {
  if (n <= 0) return { low: 0, high: 0 };
  const z = 1.959963984540054;
  const p = taken / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const w = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { low: Math.max(0, (c - w) / d), high: Math.min(1, (c + w) / d) };
}

const pct1 = (x: number) => Math.round(x * 1000) / 10;
const pct2 = (x: number) => Math.round(x * 10000) / 100;

export interface Rate {
  taken: number;
  /** Percent, one decimal, with its 95% Wilson interval. */
  rate: number;
  low: number;
  high: number;
}
const rateOf = (taken: number, n: number): Rate => {
  const w = wilson95(taken, n);
  return { taken, rate: n > 0 ? pct1(taken / n) : 0, low: pct1(w.low), high: pct1(w.high) };
};

/** One row of the paired table: the same spots decided off and on. */
export interface PairedCell {
  /** Spots where the option-on look reached the persona comparison. */
  eligible: number;
  /** Final action taken, option off and option on. */
  off: Rate;
  on: Rate;
  /** On took it and off did not; off took it and on did not. */
  up: number;
  down: number;
  /** On minus off in percentage points, with a 95% paired (Wald) interval. */
  diff: number;
  diffLow: number;
  diffHigh: number;
  /** The comparison itself, before the fold-equity test and later layers. */
  verdictOff: number;
  verdictOn: number;
  /** min(1, p * scale) held at 1; the scale held at 1 by a style read. */
  capped: number;
  held: number;
  /** Expected rates from p: off = mean p, on = mean min(1, p * this Horse's
   *  scale), model = mean E[min(1, p * s)] over the 25/20/40/15 model. Percent. */
  expectedOff: number;
  expectedOn: number;
  expectedOnModel: number;
}
/** One row of the unpaired table: two separate runs. */
export interface UnpairedCell {
  onEligible: number;
  on: Rate;
  onVerdict: number;
  offEligible: number;
  off: Rate;
}

type Raw = {
  n: number;
  off: number;
  on: number;
  up: number;
  down: number;
  vOff: number;
  vOn: number;
  cap: number;
  held: number;
  eOff: number;
  eOn: number;
  eModel: number;
};
type RawU = { n: number; t: number; v: number };
const raw = (): Raw => ({
  n: 0,
  off: 0,
  on: 0,
  up: 0,
  down: 0,
  vOff: 0,
  vOn: 0,
  cap: 0,
  held: 0,
  eOff: 0,
  eOn: 0,
  eModel: 0,
});
const get = <T>(m: Map<string, T>, k: string, make: () => T): T => {
  let v = m.get(k);
  if (!v) m.set(k, (v = make()));
  return v;
};

const pairedCell = (r: Raw): PairedCell => {
  const n = r.n;
  const d = n > 0 ? (r.up - r.down) / n : 0;
  const se = n > 0 ? Math.sqrt(Math.max(0, r.up + r.down - (r.up - r.down) ** 2 / n)) / n : 0;
  return {
    eligible: n,
    off: rateOf(r.off, n),
    on: rateOf(r.on, n),
    up: r.up,
    down: r.down,
    diff: pct2(d),
    diffLow: pct2(d - 1.959963984540054 * se),
    diffHigh: pct2(d + 1.959963984540054 * se),
    verdictOff: r.vOff,
    verdictOn: r.vOn,
    capped: r.cap,
    held: r.held,
    expectedOff: n > 0 ? pct2(r.eOff / n) : 0,
    expectedOn: n > 0 ? pct2(r.eOn / n) : 0,
    expectedOnModel: n > 0 ? pct2(r.eModel / n) : 0,
  };
};

export interface PersonaReRaiseReport {
  seats: number;
  mode: ProbeMode;
  depthBB: number | readonly [number, number];
  /** Ids seated (whole tables only), and their archetypes. */
  ids: number;
  archetypeIds: Record<HorseHoldemArchetype, number>;
  tables: number;
  hands: number;
  seed: number;
  /** Each hand carried a table id and hand number (as live decisions do). */
  handIdentity: boolean;
  /** Mean of the scale over the ids seated. */
  meanScale: number;
  /** Scale range of each decile of the ids seated (decile 1 the tightest). */
  deciles: { decile: number; ids: number; low: number; high: number }[];
  /** The model's E[min(1, scale)], percent: the reshove bluff's expected rate. */
  modelMin1: number;
  oneSidedP: number;
  /** Rows: 'pooled', an archetype, 'decile N', a stack bucket (reshove), and
   *  for the 3-bet and squeeze bluffs 'one-sided' and 'one-sided <archetype>'
   *  (spots with p above oneSidedP) and 'p>=1'. */
  paired: Record<PersonaBehaviour, Record<string, PairedCell>>;
  unpaired: Record<PersonaBehaviour, Record<string, UnpairedCell>>;
  /** Paired: what a bluff class that shoved with the option off did with it on. */
  reshoveInstead: Record<string, number>;
}

export interface MeasureOptions {
  /** Seats per table (the fleet is cut into tables of this many). */
  seats?: number;
  mode?: ProbeMode;
  depthBB?: number | readonly [number, number];
  /** Hands dealt per table per seat rotation. */
  handsPerRotation?: number;
  seed?: number;
  /** The ids to seat, in table order. Default: syntheticFleet(). */
  ids?: readonly string[];
  /** Give every hand a table id and hand number, as the live worker does
   *  (default true). False measures the direct/offline fallback, where the
   *  persona's unit is public state and cards alone. */
  handIdentity?: boolean;
}

/**
 * The measurement. Every table plays every seat rotation; the option-on run
 * and the option-off run are dealt the same cards from the same seeds.
 */
export function measurePersonaReRaise(o: MeasureOptions = {}): PersonaReRaiseReport {
  const seats = o.seats ?? 9;
  const mode = o.mode ?? 'cash';
  const depthBB = o.depthBB ?? (mode === 'cash' ? 100 : ([20, 40] as const));
  const handsPerRotation = o.handsPerRotation ?? 700;
  const seed = o.seed ?? 20261114;
  const handIdentity = o.handIdentity !== false;
  const tables = Math.floor((o.ids ?? syntheticFleet()).length / seats);
  const ids = (o.ids ?? syntheticFleet()).slice(0, tables * seats);
  const archetypeOf = new Map(ids.map((id) => [id, holdemPersonaFor(id).archetype]));
  const scaleOf = new Map(ids.map((id) => [id, holdemPersonaReRaiseScale(id)]));
  const archetypeIds = Object.fromEntries(
    PROBE_ARCHETYPES.map((a) => [a, ids.filter((id) => archetypeOf.get(id) === a).length])
  ) as Record<HorseHoldemArchetype, number>;
  // Deciles of the ids seated, by scale (ties broken by id order).
  const ranked = ids
    .map((id, i) => ({ id, i, s: scaleOf.get(id)! }))
    .sort((x, y) => x.s - y.s || x.i - y.i);
  const decileOf = new Map(
    ranked.map((x, rank) => [x.id, Math.min(10, 1 + Math.floor((rank * 10) / ranked.length))])
  );
  const deciles = Array.from({ length: 10 }, (_, d) => {
    const xs = ranked.filter((x) => decileOf.get(x.id) === d + 1).map((x) => x.s);
    return {
      decile: d + 1,
      ids: xs.length,
      low: Math.round(Math.min(...xs) * 1000) / 1000,
      high: Math.round(Math.max(...xs) * 1000) / 1000,
    };
  });

  const paired: Record<PersonaBehaviour, Map<string, Raw>> = {
    threeBetBluff: new Map(),
    squeezeBluff: new Map(),
    fourBetReshove: new Map(),
  };
  const unOn: Record<PersonaBehaviour, Map<string, RawU>> = {
    threeBetBluff: new Map(),
    squeezeBluff: new Map(),
    fourBetReshove: new Map(),
  };
  const unOff: Record<PersonaBehaviour, Map<string, RawU>> = {
    threeBetBluff: new Map(),
    squeezeBluff: new Map(),
    fourBetReshove: new Map(),
  };
  const reshoveInstead: Record<string, number> = {};

  // The engine's offline tap: the events of the option-on decision in flight.
  let events: HoldemPersonaReRaiseTapEvent[] = [];
  let onEvents: HoldemPersonaReRaiseTapEvent[] = [];
  const tapped: ProbeArm['around'] = (decide) => {
    events = [];
    const out = decide();
    onEvents = events;
    return out;
  };

  let hands = 0;
  const run = (arm: 'on' | 'off'): void => {
    const r = probeRng(seed + seats * 7919);
    seedFastRandom((seed + seats * 104729) >>> 0);
    hands = 0;
    for (let t = 0; t < tables; t++) {
      const seated = ids.slice(t * seats, (t + 1) * seats);
      const tableId = syntheticHorseId(700000000 + t);
      for (let rot = 0; rot < seats; rot++) {
        const rotated = seated.map((_, i) => seated[(i + rot) % seats]);
        const table: ProbeTable = { variant: 'nlh', mode, ids: rotated, depthBB };
        for (let h = 0; h < handsPerRotation; h++) {
          hands++;
          const base = handIdentity
            ? {
                mindPlanContext: {
                  version: 1,
                  hand: { version: 1, tableId, handNumber: 1000000 + hands },
                },
              }
            : {};
          const ON: ProbeArm = {
            opts: { ...base, holdemPersonaReRaiseMix: true },
            around: tapped,
          };
          const OFF: ProbeArm = { opts: base };
          playProbeHand(table, r, arm === 'on' ? [ON] : [OFF, ON], (spot) => {
            const ev = onEvents[0];
            onEvents = [];
            if (!ev) return;
            const b = BEHAVIOUR_OF[ev.kind];
            const reshove = b === 'fourBetReshove';
            const archetype = archetypeOf.get(spot.heroId)!;
            const groups = [
              'pooled',
              archetype,
              `decile ${decileOf.get(spot.heroId)}`,
              ...(reshove ? [stackBucketOf(spot.effectiveBB)] : []),
              ...(!reshove && ev.p > ONE_SIDED_P ? ['one-sided', `one-sided ${archetype}`] : []),
              ...(!reshove && ev.p >= 1 ? ['p>=1'] : []),
            ];
            if (arm === 'on') {
              const real = spot.reads[0];
              for (const g of groups) {
                const c = get(unOn[b], g, () => ({ n: 0, t: 0, v: 0 }));
                c.n++;
                if (personaTaken(b, real)) c.t++;
                if (ev.fires) c.v++;
              }
              return;
            }
            // Off run: reads[0] is the off decision, reads[1] the on look
            // from the same stream position.
            const [off, on] = spot.reads;
            const tOff = personaTaken(b, off);
            const tOn = personaTaken(b, on);
            for (const g of groups) {
              const u = get(unOff[b], g, () => ({ n: 0, t: 0, v: 0 }));
              u.n++;
              if (tOff) u.t++;
              const c = get(paired[b], g, raw);
              c.n++;
              if (tOff) c.off++;
              if (tOn) c.on++;
              if (tOn && !tOff) c.up++;
              if (tOff && !tOn) c.down++;
              if (ev.unscaled) c.vOff++;
              if (ev.fires) c.vOn++;
              if (!reshove && ev.p * ev.scaleUsed > 1) c.cap++;
              if (ev.scaleUsed !== ev.scale) c.held++;
              c.eOff += Math.min(1, ev.p);
              c.eOn += Math.min(1, ev.p * ev.scaleUsed);
              c.eModel += modelOn(ev.p);
            }
            if (reshove && tOff && !tOn)
              reshoveInstead[on.action] = (reshoveInstead[on.action] ?? 0) + 1;
          });
        }
      }
    }
  };
  setHoldemPersonaReRaiseTap((e) => events.push(e));
  try {
    run('on');
    run('off');
  } finally {
    setHoldemPersonaReRaiseTap(null);
  }

  const rowsFor = (b: PersonaBehaviour): string[] => [
    'pooled',
    ...PROBE_ARCHETYPES,
    ...deciles.map((d) => `decile ${d.decile}`),
    ...(b === 'fourBetReshove'
      ? [
          ...RESHOVE_STACK_BUCKETS.map(([lo, hi]) => `${lo}-${hi}bb`),
          ...(paired[b].has('other') || unOn[b].has('other') ? ['other'] : []),
        ]
      : ['one-sided', ...PROBE_ARCHETYPES.map((a) => `one-sided ${a}`), 'p>=1']),
  ];
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, c) => a + c, 0) / xs.length : 0);
  return {
    seats,
    mode,
    depthBB,
    ids: ids.length,
    archetypeIds,
    tables,
    hands,
    seed,
    handIdentity,
    meanScale: Math.round(mean([...scaleOf.values()]) * 100000) / 100000,
    deciles,
    modelMin1: pct1(modelOn(1)),
    oneSidedP: Math.round(ONE_SIDED_P * 10000) / 10000,
    paired: Object.fromEntries(
      PERSONA_BEHAVIOURS.map((b) => [
        b,
        Object.fromEntries(rowsFor(b).map((k) => [k, pairedCell(paired[b].get(k) ?? raw())])),
      ])
    ) as PersonaReRaiseReport['paired'],
    unpaired: Object.fromEntries(
      PERSONA_BEHAVIOURS.map((b) => [
        b,
        Object.fromEntries(
          rowsFor(b).map((k) => {
            const on = unOn[b].get(k) ?? { n: 0, t: 0, v: 0 };
            const off = unOff[b].get(k) ?? { n: 0, t: 0, v: 0 };
            return [
              k,
              {
                onEligible: on.n,
                on: rateOf(on.t, on.n),
                onVerdict: on.v,
                offEligible: off.n,
                off: rateOf(off.t, off.n),
              },
            ];
          })
        ),
      ])
    ) as PersonaReRaiseReport['unpaired'],
    reshoveInstead,
  };
}

const LABEL: Record<PersonaBehaviour, string> = {
  threeBetBluff: 'RULE 1  3-bet bluff',
  squeezeBluff: 'RULE 2  squeeze bluff',
  fourBetReshove:
    'RULE 3  26-35bb four-bet reshove (gate: over 25bb, up to 35bb effective), bluff classes A5s-A2s',
};

export function formatPersonaReRaiseReport(rep: PersonaReRaiseReport): string {
  const lines: string[] = [];
  const depth = typeof rep.depthBB === 'number' ? `${rep.depthBB}bb` : `${rep.depthBB.join('-')}bb`;
  lines.push(
    `${rep.seats}-handed ${rep.mode} ${depth}: ${rep.ids} ids (LAG ${rep.archetypeIds.lag_shark} / TAG ${rep.archetypeIds.tag_crusher} / Tricky ${rep.archetypeIds.tricky_trap} / Nit ${rep.archetypeIds.nit_hunter}), ${rep.tables} tables x ${rep.seats} rotations, ${rep.hands} hands per arm, seed ${rep.seed}, mean scale ${rep.meanScale}, hand identity ${rep.handIdentity ? 'supplied' : 'absent (public-state fallback)'}`
  );
  lines.push(
    'LIMITS: decisions are made with opponent memory off, so the tight-read hold (scale held at 1 against a player the style read classifies as tight) is never exercised here; the ids are the model 25/20/40/15 quota of synthetic ids, not the real fleet; Horses against Horses, preflop only.'
  );
  const rate = (r: Rate, n: number) => `${r.taken}/${n} = ${r.rate}% (${r.low} to ${r.high})`;
  const label = (row: string) => {
    const d = row.startsWith('decile ') ? rep.deciles[Number(row.slice(7)) - 1] : undefined;
    const name = d
      ? `${row} (scale ${d.low}-${d.high})`
      : row.startsWith('one-sided')
        ? row.replace('one-sided', `p>${rep.oneSidedP}`)
        : row;
    return name.padEnd(30);
  };
  for (const b of PERSONA_BEHAVIOURS) {
    lines.push(LABEL[b]);
    lines.push(
      '  PAIRED (same spot, same draws): off taken | on taken | up / down | on minus off, points (95%) | persona verdict off / on | capped | held by style | expected off / on / on under the model'
    );
    for (const [row, c] of Object.entries(rep.paired[b]))
      lines.push(
        `  ${label(row)} off ${rate(c.off, c.eligible)} | on ${rate(c.on, c.eligible)} | up ${c.up} down ${c.down} | ${c.diff} (${c.diffLow} to ${c.diffHigh}) | verdict ${c.verdictOff} / ${c.verdictOn} | capped ${c.capped} | held ${c.held} | expected ${c.expectedOff}% / ${c.expectedOn}% / ${c.expectedOnModel}%`
      );
    if (b === 'fourBetReshove') {
      lines.push(
        `  expected on rate, share of today's bluff reshoves: model E[min(1, scale)] = ${rep.modelMin1}%`
      );
      lines.push(
        `  a bluff class that shoved off and did not shove on did instead: ${JSON.stringify(rep.reshoveInstead)}`
      );
    } else {
      const o = rep.paired[b]['one-sided'];
      lines.push(
        `  one-sided region (p > ${rep.oneSidedP}): ${o.eligible} of ${rep.paired[b].pooled.eligible} eligible spots; expected loss there ${Math.round((o.expectedOff - o.expectedOn) * 100) / 100} points for these Horses (${Math.round((o.expectedOff - o.expectedOnModel) * 100) / 100} under the model); measured verdict ${o.verdictOff} off, ${o.verdictOn} on; measured final ${o.diff} points (${o.diffLow} to ${o.diffHigh})`
      );
    }
    lines.push(
      '  UNPAIRED (two separate runs; streams part at the first changed decision): on taken | on persona verdict | off taken'
    );
    for (const [row, c] of Object.entries(rep.unpaired[b]))
      lines.push(
        `  ${label(row)} on ${rate(c.on, c.onEligible)} | verdict ${c.onVerdict} | off ${rate(c.off, c.offEligible)}`
      );
  }
  return lines.join('\n');
}
