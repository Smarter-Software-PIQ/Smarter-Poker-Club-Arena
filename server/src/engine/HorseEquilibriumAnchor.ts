/**
 * THE EQUILIBRIUM ANCHOR OF THE OPPONENT READS (2026-11-26, PLO-OWNER lead-7 lane prior-anchor). Pure arithmetic and
 * one decision-scoped mode flag; it reads no packet itself (OpponentHud.hudStat and OpponentHudExploit read it).
 *
 * The Horse rules' prior-anchor law: a prior is anchored to solved / equilibrium play, never to the mis-playing Horse
 * field, and the opponent's own record dominates as its sample grows. The population row the store serves
 * (fitHudPriors over every stored profile) is 99.5% (PLO5) / 99.8% (PLO4) Horse play (grade of 2026-11-26), so a
 * reader that shrinks toward it reads a thin opponent as a Horse.
 *
 * While a decision runs with one of the HUD readers graded against that law switched on
 * (omahaOpponentLifetimeHudDecides, omahaPreflopReadIsPricedFromLifetime; HorseLogic.decide sets the mode), every
 * HUD statistic is shrunk toward the anchor below instead of the population row:
 *   p = (hits + k x anchor) / (n + k),  k = max(HUD_ANCHOR_K_FLOOR, the statistic's fitted k)
 * so a record of 5 opportunities carries at most 20% of the read and one of 300 carries at least 94%. The recency
 * layer stays in n (OpponentHud.blendedCount: 25% lifetime floor plus the 7-day recency layer), so a player who
 * changes gears moves the read through his recent hands.
 *
 * Two kinds of anchor, both stated:
 *  - INDIFFERENCE (exact equilibrium properties of the betting game, no data): a responder's fold to a wager of pot
 *    share s is s / (1 + s) (minimum defence; multiway each of m responders folds 1 - (1 / (1 + s))^(1 / m)); the
 *    value share of a wager is 1 - s / (1 + 2s) (the bettor's bluff share that leaves a bluff-catcher indifferent);
 *    a pot-sized preflop raise (3-bet, 4-bet, isolation) is answered with fold 0.5; a blind facing a pot-sized open
 *    defends to its price (fold 1/3). The continuing part splits call : raise as 85 : 15 (stated reference, not
 *    an indifference point; the preflop split is the plo-preflop worker's HorsePreflopIndifferenceAnchor once merged).
 *  - REFERENCE FREQUENCIES (no closed form exists: first-in entry by position, bet when checked to, c-bet, barrel,
 *    showdown shares): approximate six-max PLO solver reference frequencies, stated per row below, to be replaced
 *    by a fitted PLO solve. They are never Horse data. A statistic not listed reads the neutral 0.5.
 * Public information only; no identity, no person/Horse key, no unshown card.
 */

/** Pseudo-opportunities of the anchor: no record shorter than this carries half of a read. */
export const HUD_ANCHOR_K_FLOOR = 20;
/** The share of a continuing response that raises (stated reference). */
export const HUD_ANCHOR_RAISE_SHARE = 0.15;
/** Pot share at the middle of each wager band (OpponentHudProfile.hudBand: s < 0.4, m < 0.75, l <= 1.1, o above). */
export const HUD_ANCHOR_BAND_POT_SHARE: Readonly<Record<string, number>> = Object.freeze({
  s: 0.3,
  m: 0.6,
  l: 0.9,
  o: 1.5,
  sm: 0.5,
  bg: 1.0,
});

/** fold of one responder to a wager of pot share s with m responders (joint minimum defence). */
export function anchorFold(s: number, responders = 1): number {
  const single = 1 / (1 + s);
  return 1 - Math.pow(single, 1 / Math.max(1, responders));
}
/** value share of a wager of pot share s (bluff-catcher indifference). */
export function anchorValueShare(s: number): number {
  return 1 - s / (1 + 2 * s);
}

const R = (x: number) => Math.round(x * 10000) / 10000;

function build(): Record<string, number> {
  const a: Record<string, number> = {};
  // preflop: indifference rows
  a['pf.f3bet'] = 0.5;
  a['pf.f4bet'] = 0.5;
  a['pf.c4bet'] = R(0.5 * (1 - HUD_ANCHOR_RAISE_SHARE));
  // preflop: reference frequencies (six-max PLO solver reference, approximate)
  Object.assign(a, {
    'pf.vpip': 0.3,
    'pf.pfr': 0.22,
    'pf.open': 0.28,
    'pf.3bet': 0.09,
    'pf.4bet': 0.035,
    'pf.cold4': 0.015,
    'pf.cc': 0.12,
    'pf.limp': 0.02,
    'pf.vpip@EP': 0.18,
    'pf.pfr@EP': 0.17,
    'pf.vpip@CO': 0.29,
    'pf.pfr@CO': 0.26,
    'pf.vpip@BTN': 0.48,
    'pf.pfr@BTN': 0.42,
    'pf.vpip@SB': 0.4,
    'pf.pfr@SB': 0.3,
    'pf.vpip@BB': 0.55,
    'pf.pfr@BB': 0.1,
    'sd.wtsd': 0.3,
    'sd.wsd': 0.5,
  });
  for (const s of ['f', 't', 'r']) {
    // indifference rows: answers to a wager by size band
    for (const b of ['s', 'm', 'l', 'o']) {
      const f = anchorFold(HUD_ANCHOR_BAND_POT_SHARE[b]);
      a[`${s}.fBet.${b}`] = R(f);
      a[`${s}.cBet.${b}`] = R((1 - f) * (1 - HUD_ANCHOR_RAISE_SHARE));
      a[`${s}.rBet.${b}`] = R((1 - f) * HUD_ANCHOR_RAISE_SHARE);
    }
    const fAny = anchorFold(0.6);
    a[`${s}.fBet`] = R(fAny);
    a[`${s}.cBet`] = R((1 - fAny) * (1 - HUD_ANCHOR_RAISE_SHARE));
    a[`${s}.rBet`] = R((1 - fAny) * HUD_ANCHOR_RAISE_SHARE);
    a[`${s}.rBet.hu`] = a[`${s}.rBet`];
    a[`${s}.rBet.mw`] = R((1 - anchorFold(0.6, 2)) * HUD_ANCHOR_RAISE_SHARE);
    for (const z of ['sm', 'bg']) {
      a[`${s}.fb.${z}.hu`] = R(anchorFold(HUD_ANCHOR_BAND_POT_SHARE[z], 1));
      a[`${s}.fb.${z}.mw`] = R(anchorFold(HUD_ANCHOR_BAND_POT_SHARE[z], 2));
      for (const ln of ['stab', 'lead', 'raise'])
        a[`vs.${s}.${ln}.${z}`] = R(anchorValueShare(HUD_ANCHOR_BAND_POT_SHARE[z]));
    }
    // a pot-sized raise of his own wager
    a[`${s}.fRaise`] = 0.5;
    a[`${s}.rRaise`] = R(0.5 * HUD_ANCHOR_RAISE_SHARE);
    // reference frequencies (approximate solver reference)
    a[`${s}.betCk`] = s === 'f' ? 0.5 : s === 't' ? 0.42 : 0.38;
    a[`${s}.stab.hu`] = a[`${s}.betCk`];
    a[`${s}.stab.mw`] = R(a[`${s}.betCk`] * 0.7);
    a[`${s}.lead.hu`] = 0.1;
    a[`${s}.lead.mw`] = 0.08;
    a[`${s}.donk`] = 0.06;
    a[`${s}.xr`] = 0.1;
    if (s === 'f') a['f.cbet'] = 0.55;
    else {
      a[`${s}.barrel`] = s === 't' ? 0.5 : 0.45;
      a[`${s}.probe`] = 0.35;
    }
  }
  for (const t of ['conn', 'dry', 'mono', 'paired']) {
    a[`f.fBet.${t}`] = a['f.fBet'];
    a[`f.betCk.${t}`] = a['f.betCk'];
  }
  return a;
}

/** stat -> anchor rate (frozen). */
export const HUD_EQUILIBRIUM_ANCHOR: Readonly<Record<string, number>> = Object.freeze(build());

/** The anchor rate of a statistic: its row, or the neutral 0.5 (never the population row). */
export function hudAnchorOf(stat: string): number {
  const v = HUD_EQUILIBRIUM_ANCHOR[stat];
  return typeof v === 'number' ? v : 0.5;
}

let anchorMode = false;
/** True while a decision runs with an anchored reader switched on. */
export function hudAnchorMode(): boolean {
  return anchorMode;
}
/** Run `fn` with the anchor mode set to `on` (restored afterwards; nests). */
export function withHudEquilibriumAnchor<T>(on: boolean, fn: () => T): T {
  if (on === anchorMode) return fn();
  const was = anchorMode;
  anchorMode = on;
  try {
    return fn();
  } finally {
    anchorMode = was;
  }
}
/** The options whose decisions read the anchor (with the lifetime store on). The math core (omahaMathCore) anchors
 *  its own responder model inside the core (OmahaMathCore.ts anchoredResponse), only on the streets it owns. */
export function hudAnchorOptionsOn(opts: {
  omahaOpponentLifetimeHud?: boolean;
  omahaOpponentLifetimeHudDecides?: boolean;
  omahaPreflopReadIsPricedFromLifetime?: boolean;
}): boolean {
  return (
    opts.omahaOpponentLifetimeHud === true &&
    (opts.omahaOpponentLifetimeHudDecides === true ||
      opts.omahaPreflopReadIsPricedFromLifetime === true)
  );
}

/** Shrink one count pair toward the anchor (hits rescaled, opportunities kept): the anchored rate times n. */
export function anchoredHits(
  stat: string,
  n: number,
  hits: number,
  k = HUD_ANCHOR_K_FLOOR
): number {
  if (!(n > 0)) return 0;
  const kk = Math.max(HUD_ANCHOR_K_FLOOR, k);
  return (n * (Math.min(n, Math.max(0, hits)) + kk * hudAnchorOf(stat))) / (n + kk);
}
