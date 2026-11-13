import { it } from 'vitest';
import { HERO, VILLAIN, VILLAINS, decide, install, preflopOpen, preflopThreeBet } from './HorseOpponentStyle.contexts.test-support.js';
import { HorseMind } from './HorseMind.js';
import { FX, ON, installFixture, spotOf } from './HorseOpponentStyle.fixtures.test-support.js';
const supply = () => HorseMind.importPostReleaseObservations([{ user_id: VILLAIN, variant: 'nlh', mode: 'tournament', size: 'full', opportunities: { foldToBet: 120, riverCall: 120, foldTo3Bet: 120, betCheckedTo: 120 } }]);
function arbiterSpot(mk: () => any, stackBB: number, playersLeft: number) {
  const s = mk();
  const gs = s.gs;
  const bb = 2;
  for (const p of gs.players) if (!p.is_folded || p.user_id === HERO || p.user_id === VILLAIN) { p.stack = Math.max(0, stackBB * bb - p.bet); }
  const hero = gs.players.find((p: any) => p.user_id === HERO);
  const toCall = gs.currentBet - hero.bet;
  const stacks = gs.players.map((p: any) => p.stack + p.totalInvested);
  const stackByUser = Object.fromEntries(gs.players.map((p: any) => [p.user_id, p.stack + p.totalInvested]));
  Object.assign(gs, { stateSchemaVersion: 1, heroSeat: hero.seat, currentPlayerSeat: hero.seat, format: 'mtt', legalActions: ['fold', 'call', 'raise', 'all_in'], toCall, minRaiseTo: gs.currentBet + Math.max(bb, gs.minRaise), maxRaiseTo: hero.stack + hero.bet, pots: [{ amount: gs.pot, eligiblePlayers: gs.players.filter((p: any) => !p.is_folded).map((p: any) => p.user_id) }], contestablePot: gs.pot,
    tournament: { schemaVersion: 1, contextStatus: 'complete', contextIssues: [], format: 'mtt', tournamentType: 'mtt', tournamentStatus: 'running', gameVariant: 'nlh', tournamentId: 't', sourceAgeMs: 0, entrants: 18, playersLeft: gs.players.length, spotsPaid: playersLeft, payoutPct: [50, 30, 20, 10, 5].slice(0, playersLeft), stacks, stackByUser, avgStackChips: stacks.reduce((a: number, b: number) => a + b, 0) / stacks.length, currentSmallBlind: 1, currentBigBlind: 2, currentAnte: 0, anteType: 'none', seatsPerTable: 9, currentLevel: 5, finalTable: true, inMoney: false, nearBubble: true, startingStackChips: 200, prizePoolCents: 1800, prizePoolFinalized: true, bountyPoolCents: 0, bountyFactor: 0, rebuyOpen: false, rebuyAllowed: false, reentryOpen: false, registrationOpen: false, lateRegistrationOpen: false, addOnAvailable: false } });
  return s;
}
it('d', () => {
  for (const id of ['F026', 'F032', 'F027', 'F030', 'F028', 'F023'])
    for (const st of [8, 12, 16, 25, 40])
      for (const pl of [3, 4, 5]) {
        const f = FX.find((x) => x.id === id)!;
        const mk = () => spotOf(f);
        installFixture(f);
        const off = decide(arbiterSpot(mk, st, pl), { telemetry: true });
        installFixture(f);
        const on = decide(arbiterSpot(mk, st, pl), { ...ON, telemetry: true });
        const tu = (on.decision as any).tournamentUtility;
        const sf = Object.keys(on.fires).filter((k) => k.startsWith('style_') && !k.startsWith('style_label'));
        if (tu && tu.baselineAction !== tu.selectedAction) console.log('D4', id, st, pl, 'OFF', off.decision.action, '| ON', on.decision.action, `${tu.baselineAction}>${tu.selectedAction}`, sf.join(','));
      }
});
