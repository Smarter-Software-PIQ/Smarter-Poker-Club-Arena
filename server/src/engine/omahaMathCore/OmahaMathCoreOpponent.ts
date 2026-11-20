/**
 * omahaMathCore opponent model (lane OPPMODEL, 2026-11-19). One general model for
 * EVERY opponent, person or Horse: the same code path, keyed only by the request's
 * user id (union-wide: no club key) and seat kind. No player is named anywhere in
 * source (law test).
 *
 * PUBLIC INFORMATION ONLY (lead ruling 2026-11-19): the shipped snapshot
 * (opponentModel.v1.json, provenance "public_actions") is built from public actions
 * only: responses to bets (fold / call / raise by street, size band, players, bettor
 * kind), preflop actions (position x raise level) and bet-versus-check frequencies.
 * No hole card that was not shown at the table is read by the builder.
 *
 * Math (hierarchical Dirichlet, shrunk to the population cell the core passes in):
 *   level 1: his pooled (game, street, bettor kind) counts, exponentially decayed
 *            (half-life in params), shrunk with m0 to the population => lift per category;
 *   level 2: prior = population cell x lift (renormalised); posterior =
 *            (his decayed counts in the exact cell + m x prior) / (n + m).
 * m, m0 and half-life were chosen out of sample (fit Nov 1-18, test Nov 19 Chicago).
 * Scope: PLO4 and PLO5 only (owner 8:26 PM Nov 19); any other game returns the population
 * cell unchanged. Game is a key; a PLO4/PLO5 game he has no read in borrows his lift from
 * the other one at half weight, before the same shrink.
 *
 * Runtime: snapshot parsed once at import, Map lookups only, synchronous and
 * deterministic for (snapshot version, request); never throws: any miss returns the
 * population cell unchanged with source "population". Every source string carries
 * the snapshot version.
 */
import snapshotJson from './opponentModel.v1.json' with { type: 'json' };

export type OppTier =
  | 'nutted'
  | 'strong'
  | 'medium'
  | 'medium_draw'
  | 'strong_draw'
  | 'draw'
  | 'weak'
  | 'air';
export interface OppFoldCell {
  p: number;
  n: number;
  source: string;
}
export interface OppTierMix {
  tiers: Partial<Record<OppTier, number>>;
  key: string;
  n: number;
}
export type OppActor = 'person' | 'horse';
export type OppGame = 'plo4' | 'plo5';
export interface OppSpot {
  game: OppGame | string;
  mode?: string;
  street: 'flop' | 'turn' | 'river';
  line?: string;
  band: string;
  players: 'hu' | 'mw';
  /** kind of the player whose wager is faced; the core's wagers are the Horse's */
  vs?: OppActor;
}
export interface OppPreflopCell {
  fold: number;
  call: number;
  raise: number;
  check: number;
  n: number;
  source: string;
}

interface CoarseRow {
  lift: Record<string, number>;
  nEff: number;
  n: number;
  recentZ: number | null;
  cells: Record<string, Record<string, number>>;
}
interface OpponentRow {
  a: OppActor;
  response: Record<string, CoarseRow>;
  preflop: Record<string, CoarseRow>;
  wager: Record<string, { bets: number; opps: number }>;
}
interface Snapshot {
  version: string;
  provenance: 'public_actions' | 'showdown_only';
  params: {
    response: { m: number; m0: number; H: number };
    preflop: { m: number; m0: number; H: number };
    wager: { m: number; beta: number };
  };
  population: { betRate: Record<string, { p: number; n: number }> };
  opponents: Record<string, OpponentRow>;
}

export const OPPONENT_MODEL_SNAPSHOT = snapshotJson as unknown as Snapshot;
export const OPPONENT_MODEL_VERSION = `${OPPONENT_MODEL_SNAPSHOT.version}@e298f1ca`;
/** Provenance of every table this module ships (law: never hidden cards). */
export const OPPONENT_MODEL_PROVENANCE: 'public_actions' | 'showdown_only' =
  OPPONENT_MODEL_SNAPSHOT.provenance;
/**
 * Frequency-implied bet-composition tilt (public: his bet rate when no bet is faced
 * vs the population's). Out of sample it was mixed (persons log-loss 1.9746 ->
 * 1.9719, Horses 1.5714 -> 1.5752, all 1.7045 -> 1.7062): a failed candidate stays
 * OFF, so opponentWagerMix returns the population mix unless this is switched on.
 */
export const OPPONENT_WAGER_TILT_ENABLED = false;
/** Tiers that are not value (RANGES tier map: nutted/strong/medium/medium_draw are made value). */
const NON_VALUE: ReadonlySet<string> = new Set(['strong_draw', 'draw', 'weak', 'air']);
/** Scope (owner 8:26 PM Nov 19): PLO4 and PLO5 only; any other game reads the population unchanged. */
const GAMES: readonly string[] = ['plo4', 'plo5'];

const OPP = new Map<string, OpponentRow>(Object.entries(OPPONENT_MODEL_SNAPSHOT.opponents ?? {}));

function finite(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}
function clamp01(x: number): number {
  return Math.max(0.0005, Math.min(0.9995, x));
}
function row(user: string | null, actor: OppActor, game?: unknown): OpponentRow | null {
  if (!user || !GAMES.includes(String(game))) return null;
  const r = OPP.get(user);
  return r && r.a === actor ? r : null;
}
/** His coarse row for (game, rest): exact game, else his other PLO games pooled by evidence. */
function coarseFor(
  table: Record<string, CoarseRow>,
  game: string,
  rest: (g: string) => string
): {
  lift: Record<string, number>;
  nEff: number;
  recentZ: number | null;
  key: string;
  borrowed: boolean;
} | null {
  const exact = table[rest(game)];
  if (exact)
    return {
      lift: exact.lift,
      nEff: exact.nEff,
      recentZ: exact.recentZ,
      key: rest(game),
      borrowed: false,
    };
  let w = 0;
  const acc: Record<string, number> = {};
  for (const g of GAMES) {
    if (g === game) continue;
    const c = table[rest(g)];
    if (!c || !(c.nEff > 0)) continue;
    w += c.nEff;
    for (const [k, v] of Object.entries(c.lift)) if (finite(v)) acc[k] = (acc[k] ?? 0) + v * c.nEff;
  }
  if (w <= 0) return null;
  for (const k of Object.keys(acc)) acc[k] /= w;
  // borrowed evidence counts half (a different game): pull the borrowed lift halfway to 1
  for (const k of Object.keys(acc)) acc[k] = 1 + 0.5 * (acc[k] - 1);
  return {
    lift: acc,
    nEff: w * 0.5,
    recentZ: null,
    key: `${rest('*')} (borrowed from the other PLO4/PLO5 game)`,
    borrowed: true,
  };
}

/**
 * Fold probability of `user` facing a wager in `spot`, as the Bayesian posterior
 * shrunk to the population cell `pop` the core already looked up.
 */
export function opponentFold(
  user: string | null,
  actor: OppActor,
  spot: OppSpot,
  pop: OppFoldCell
): OppFoldCell {
  try {
    if (!pop || !finite(pop.p)) return pop;
    const r = row(user, actor, spot.game);
    if (!r)
      return {
        ...pop,
        source: `${pop.source}; opponent ${OPPONENT_MODEL_VERSION}: population (no read)`,
      };
    const vs = `vs_${spot.vs ?? 'horse'}`;
    const c = coarseFor(r.response, String(spot.game), (g) => `${g}|${spot.street}|${vs}`);
    const { m } = OPPONENT_MODEL_SNAPSHOT.params.response;
    const p0 = clamp01(pop.p);
    let prior = p0;
    if (c) {
      const lf = finite(c.lift.fold) ? c.lift.fold : 1;
      const lnf = finite(c.lift.notFold) && c.lift.notFold > 0 ? c.lift.notFold : 1;
      prior = (p0 * lf) / (p0 * lf + (1 - p0) * lnf);
    }
    const cell =
      r.response[`${spot.game}|${spot.street}|${vs}`]?.cells?.[
        `${spot.game}|${spot.street}|${spot.band}|${spot.players}|${vs}`
      ];
    const k = cell ? Number(cell.fold ?? 0) : 0;
    const n = cell ? Number(cell.fold ?? 0) + Number(cell.call ?? 0) + Number(cell.raise ?? 0) : 0;
    const p = (k + m * prior) / (n + m);
    if (!finite(p)) return pop;
    const conf = (c ? c.nEff : 0) + n;
    return {
      p: Math.max(0, Math.min(1, p)),
      n: pop.n,
      source:
        `${pop.source}; opponent ${OPPONENT_MODEL_VERSION} public_actions: lift ${c ? `${c.key} nEff=${c.nEff.toFixed(1)}` : 'none'}` +
        `, cell nEff=${n.toFixed(1)}, m=${m}, prior=${prior.toFixed(3)}, conf=${(conf / (conf + m)).toFixed(2)}` +
        (c?.recentZ != null ? `, recentZ=${c.recentZ}` : ''),
    };
  } catch {
    return pop;
  }
}

/**
 * The wagerer's holding mix. Public-only: frequency-implied tilt of the population mix
 * by his bet rate when no bet was faced (value-bet arithmetic), OFF by default.
 */
export function opponentWagerMix(
  user: string | null,
  actor: OppActor,
  spot: OppSpot,
  pop: OppTierMix
): OppTierMix {
  try {
    if (!pop || !pop.tiers) return pop;
    const r = row(user, actor, spot.game);
    if (!OPPONENT_WAGER_TILT_ENABLED || !r)
      return { ...pop, key: `${pop.key}; opponent ${OPPONENT_MODEL_VERSION}: population` };
    const w = r.wager[`${spot.game}|${spot.street}`];
    const pr = OPPONENT_MODEL_SNAPSHOT.population.betRate[`${spot.game}|${spot.street}|${actor}`];
    if (!w || !pr || !(pr.p > 0))
      return { ...pop, key: `${pop.key}; opponent ${OPPONENT_MODEL_VERSION}: population` };
    const { m, beta } = OPPONENT_MODEL_SNAPSHOT.params.wager;
    const fu = (w.bets + m * pr.p) / (w.opps + m);
    const tot = Object.values(pop.tiers).reduce((s, x) => s + (finite(x) ? x : 0), 0);
    if (!(tot > 0)) return pop;
    let nv = 0;
    for (const [t, x] of Object.entries(pop.tiers))
      if (NON_VALUE.has(t) && finite(x)) nv += x / tot;
    if (nv <= 0 || nv >= 1) return pop;
    const target = Math.min(0.95, Math.max(0.02, 1 - (1 - nv) * Math.pow(pr.p / fu, beta)));
    const out: Partial<Record<OppTier, number>> = {};
    for (const [t, x] of Object.entries(pop.tiers) as [OppTier, number][])
      if (finite(x))
        out[t] = (x / tot) * (NON_VALUE.has(t) ? target / nv : (1 - target) / (1 - nv)) * tot;
    return {
      tiers: out,
      n: pop.n,
      key: `${pop.key}; opponent ${OPPONENT_MODEL_VERSION} public bet rate ${fu.toFixed(3)} vs ${pr.p.toFixed(3)} (opps=${w.opps}, m=${m}, beta=${beta}) => non-value ${nv.toFixed(3)}->${target.toFixed(3)}`,
    };
  } catch {
    return pop;
  }
}

/** A passive holding's mix. No public per-opponent read is validated yet: population, labelled. */
export function opponentPassiveMix(
  user: string | null,
  actor: OppActor,
  spot: OppSpot,
  pop: OppTierMix
): OppTierMix {
  if (!pop) return pop;
  return {
    ...pop,
    key: `${pop.key}; opponent ${OPPONENT_MODEL_VERSION}: population (no public passive read)`,
  };
}

/** Preflop action mix at (position, level 0 unopened .. 3 facing 4-bet+), posterior shrunk to `pop`. */
export function opponentPreflop(
  user: string | null,
  actor: OppActor,
  spot: { game: OppGame | string; position: string; level: 0 | 1 | 2 | 3 },
  pop: OppPreflopCell
): OppPreflopCell {
  try {
    const r = row(user, actor, spot.game);
    if (!r || !pop)
      return (
        pop && {
          ...pop,
          source: `${pop.source}; opponent ${OPPONENT_MODEL_VERSION}: population (no read)`,
        }
      );
    const lvl = `lvl${spot.level}`;
    const c = coarseFor(r.preflop, String(spot.game), (g) => `${g}|${lvl}`);
    const cats = ['fold', 'call', 'raise', 'check'] as const;
    const base = cats.map((k) => (finite(pop[k]) ? Math.max(0, pop[k]) : 0));
    const sb = base.reduce((s, x) => s + x, 0);
    if (!(sb > 0)) return pop;
    let prior = base.map((x, i) => (x / sb) * (c && finite(c.lift[cats[i]]) ? c.lift[cats[i]] : 1));
    const sp = prior.reduce((s, x) => s + x, 0);
    prior = prior.map((x) => x / sp);
    const cell =
      r.preflop[`${spot.game}|${lvl}`]?.cells?.[`${spot.game}|${spot.position}|${lvl}`] ?? {};
    const v = cats.map((k) => Number(cell[k] ?? 0));
    const n = v.reduce((s, x) => s + x, 0);
    const { m } = OPPONENT_MODEL_SNAPSHOT.params.preflop;
    const post = v.map((x, i) => (x + m * prior[i]) / (n + m));
    return {
      fold: post[0],
      call: post[1],
      raise: post[2],
      check: post[3],
      n: pop.n,
      source: `${pop.source}; opponent ${OPPONENT_MODEL_VERSION} public_actions: lift ${c ? `${c.key} nEff=${c.nEff.toFixed(1)}` : 'none'}, cell nEff=${n.toFixed(1)}, m=${m}`,
    };
  } catch {
    return pop;
  }
}

/**
 * P(he wagers when checked to / no bet faced) on this street: his public bets on
 * cbet/barrel/stab/probe/donk lines over (those bets + his checks), Beta-shrunk with
 * the wager m to the population rate the caller passes (or the snapshot's population
 * bet rate for his seat kind when `pop` is null). No line or size split in v1: the
 * snapshot counts are per game|street.
 */
export function opponentBetRate(
  user: string | null,
  actor: OppActor,
  spot: Pick<OppSpot, 'game' | 'street'>,
  pop: OppFoldCell | null
): OppFoldCell | null {
  try {
    const sp = OPPONENT_MODEL_SNAPSHOT.population.betRate[`${spot.game}|${spot.street}|${actor}`];
    const base: OppFoldCell | null =
      pop && finite(pop.p)
        ? pop
        : sp
          ? {
              p: sp.p,
              n: sp.n,
              source: `${OPPONENT_MODEL_VERSION} population.betRate ${spot.game}|${spot.street}|${actor}`,
            }
          : null;
    if (!base) return pop;
    const r = row(user, actor, spot.game);
    const w = r?.wager[`${spot.game}|${spot.street}`];
    if (!w)
      return {
        ...base,
        source: `${base.source}; opponent ${OPPONENT_MODEL_VERSION}: population (no read)`,
      };
    const { m } = OPPONENT_MODEL_SNAPSHOT.params.wager;
    const p = (w.bets + m * base.p) / (w.opps + m);
    return {
      p,
      n: base.n,
      source: `${base.source}; opponent ${OPPONENT_MODEL_VERSION} public_actions: bets=${w.bets} opps=${w.opps} m=${m}`,
    };
  } catch {
    return pop;
  }
}

/**
 * His full response (fold / call / raise) facing a wager, same hierarchy as
 * opponentFold, with the population response split passed in. The snapshot does not
 * separate a bet from a raise being faced (cell key game|street|band|players|vs).
 */
export function opponentResponse(
  user: string | null,
  actor: OppActor,
  spot: OppSpot,
  pop: { fold: number; call: number; raise: number; n: number; source: string }
): { fold: number; call: number; raise: number; n: number; source: string } {
  try {
    const r = row(user, actor, spot.game);
    if (!r || !pop)
      return (
        pop && {
          ...pop,
          source: `${pop.source}; opponent ${OPPONENT_MODEL_VERSION}: population (no read)`,
        }
      );
    const vs = `vs_${spot.vs ?? 'horse'}`;
    const c = coarseFor(r.response, String(spot.game), (g) => `${g}|${spot.street}|${vs}`);
    const cats = ['fold', 'call', 'raise'] as const;
    const base = cats.map((k) => (finite(pop[k]) ? Math.max(0, pop[k]) : 0));
    const sb = base.reduce((s, x) => s + x, 0);
    if (!(sb > 0)) return pop;
    let prior = base.map((x, i) => (x / sb) * (c && finite(c.lift[cats[i]]) ? c.lift[cats[i]] : 1));
    const sp = prior.reduce((s, x) => s + x, 0);
    prior = prior.map((x) => x / sp);
    const cell =
      r.response[`${spot.game}|${spot.street}|${vs}`]?.cells?.[
        `${spot.game}|${spot.street}|${spot.band}|${spot.players}|${vs}`
      ] ?? {};
    const v = cats.map((k) => Number(cell[k] ?? 0));
    const n = v.reduce((s, x) => s + x, 0);
    const { m } = OPPONENT_MODEL_SNAPSHOT.params.response;
    const post = v.map((x, i) => (x + m * prior[i]) / (n + m));
    return {
      fold: post[0],
      call: post[1],
      raise: post[2],
      n: pop.n,
      source: `${pop.source}; opponent ${OPPONENT_MODEL_VERSION} public_actions: lift ${c ? `${c.key} nEff=${c.nEff.toFixed(1)}` : 'none'}, cell nEff=${n.toFixed(1)}, m=${m}`,
    };
  } catch {
    return pop;
  }
}
