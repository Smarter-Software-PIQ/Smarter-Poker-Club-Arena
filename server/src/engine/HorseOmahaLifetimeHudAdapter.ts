/**
 * ADAPTER: OPPONENT-HUD's lifetime public reads -> the stab defence's provider (EMERG lane STAB-DEFENCE-3 2026-11-20).
 *
 * The stab defence (HorseOmahaStabDefence.ts) and the strong-hand check (HorseOmahaStrongHandCheck.ts) read one
 * interface, OmahaLifetimeStreetRecordProvider (HorseMind.ts). OPPONENT-HUD owns the store and the two read functions
 * (hudFirstWagerRecord and hudLifetimeCount in opponentHud/OpponentHud.ts). This file only maps one to the other; it
 * holds no counts and copies no store. The two functions are passed in, so this module does not depend on the HUD
 * build being present: the wiring that installs the provider hands them over
 * (HorseMind.setOmahaLifetimeStreetRecordProvider(omahaLifetimeProviderFromHud({ hudFirstWagerRecord,
 * hudLifetimeCount }))).
 *
 * One mapping for every opponent. Public history only: the HUD reads carry counts of public actions and never a
 * card. A read that throws, or a profile the decision's packet does not hold, is "no record" (null): the consumer
 * then prices the population exactly.
 */
import type { OmahaLifetimeStreetRecordProvider } from './HorseMind.js';

type Game = 'plo4' | 'plo5';
type Street = 'turn' | 'river';
type Players = 'hu' | 'mw';

/** The two OPPONENT-HUD reads this adapter needs (their signatures at head a96e2af688c). */
export interface OmahaLifetimeHudReads {
  hudFirstWagerRecord(
    opponentId: string,
    family: Game,
    street: Street,
    players: Players
  ): {
    bets: number;
    opps: number;
    checkedTo: { bets: number; opps: number; sizeSum?: number };
    firstToAct: { bets: number; opps: number };
  } | null;
  hudLifetimeCount(
    opponentId: string,
    family: Game | 'nlh',
    alias: 'x.foldToBet.small' | 'x.foldToBet.big',
    ctx: { street: Street; players: Players }
  ): { n: number; hits: number };
}

const ok = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;

export function omahaLifetimeProviderFromHud(
  hud: OmahaLifetimeHudReads
): OmahaLifetimeStreetRecordProvider {
  return {
    unopenedWagerRecord(opponentId, game, street, players) {
      try {
        const r = hud.hudFirstWagerRecord(opponentId, game, street, players);
        if (!r || !ok(r.bets) || !ok(r.opps) || !(r.opps > 0)) return null;
        return { bets: Math.min(r.bets, r.opps), opps: r.opps };
      } catch {
        return null;
      }
    },
    firstWagerFoldRecord(opponentId, game, street, players, size) {
      try {
        const c = hud.hudLifetimeCount(
          opponentId,
          game,
          size === 'big' ? 'x.foldToBet.big' : 'x.foldToBet.small',
          { street, players }
        );
        if (!c || !ok(c.n) || !ok(c.hits) || !(c.n > 0)) return null;
        return { folds: Math.min(c.hits, c.n), opps: c.n };
      } catch {
        return null;
      }
    },
    stabSizeRecord(opponentId, game, street, players) {
      try {
        const r = hud.hudFirstWagerRecord(opponentId, game, street, players);
        const stabs = r?.checkedTo?.bets;
        const sizeSum = r?.checkedTo?.sizeSum;
        if (!ok(stabs) || !ok(sizeSum) || !(stabs > 0)) return null;
        return { stabs, sizeSum: Math.min(sizeSum, 2 * stabs) };
      } catch {
        return null;
      }
    },
  };
}
