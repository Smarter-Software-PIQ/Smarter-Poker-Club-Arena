/**
 * The L-017 scenario shared by the regression test and its fix-shape check:
 * six-handed NLH, big-blind ante, only the big blind a Horse (scripted lane:
 * an early look answers fold, the turn answers call), UTG opens to 3 bb, HJ and
 * CO call, BTN and SB fold. The caller owns the module mocks (database, error
 * reporter) and the host cleanup (hosts).
 */
import { vi } from 'vitest';
import * as kit from '../testing/lightningHostTestKit.js';

export const BB = 2;
export const hosts: any[] = [];

export async function sixHandedOpenThenTwoCalls() {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
  const formed = kit.formedHand(6, 4_700);
  const bbId = formed.bb;
  const t = kit.buildHost(
    formed,
    formed.players.map(() => 100 * BB),
    {
      horses: new Set([bbId]),
      rules: {
        game_variant: 'nlh',
        big_blind: BB,
        small_blind: 1,
        ante_enabled: true,
        ante: BB,
        big_blind_ante_enabled: true,
      },
      deps: { random: () => 0.5 },
    }
  );
  hosts.push(t.host);
  const host = t.host as any;
  const asked: Array<{ early: boolean; stillToAct: number[]; toCall: number; pot: number }> = [];
  const brain = t.horseLane.raw.decideFast.getMockImplementation()!;
  t.horseLane.raw.decideFast.mockImplementation(async (snap: any) => {
    const r = await brain(snap);
    const gs = snap.gameState;
    const early = String(snap.fence).endsWith(':early');
    if (gs.stage === 'preflop')
      asked.push({
        early,
        stillToAct: gs.players
          .filter(
            (p: any) =>
              p.seat !== gs.heroSeat && !p.is_folded && !p.is_all_in && p.bet < gs.currentBet
          )
          .map((p: any) => p.seat)
          .sort(),
        toCall: gs.toCall,
        pot: gs.pot,
      });
    const action = gs.stage !== 'preflop' ? 'check' : early ? 'fold' : 'call';
    const amount = action === 'call' ? gs.toCall : undefined;
    return { ...r, decision: { action, amount, thinkTime: 1_500 } };
  });
  await t.host.start();
  // The people: UTG opens to 3 bb; HJ and CO call; BTN and SB fold; each acts
  // 3 s into its turn (long after a Horse's look-and-press time).
  const preflop = (seat: number) =>
    seat === 3
      ? { action: 'raise', amount: 3 * BB }
      : seat === 4 || seat === 5
        ? { action: 'call' }
        : { action: 'fold' };
  for (let i = 0; i < 1_500 && t.host.lifecycle === 'dealing'; i++) {
    await vi.advanceTimersByTimeAsync(100);
    const st = t.host.peekState();
    if (!st || st.stage !== 'preflop') {
      if (st && ['flop', 'turn', 'river'].includes(st.stage)) {
        const cur = st.players.find((p: any) => p.seat === st.currentPlayerSeat);
        if (cur && cur.user_id !== bbId && host.turnUser === cur.user_id)
          t.host.handlePlayerAction(cur.user_id, 'check');
      }
      continue;
    }
    const cur = st.players.find((p: any) => p.seat === st.currentPlayerSeat);
    if (!cur || cur.user_id === bbId) continue;
    if (host.turnUser !== cur.user_id || Date.now() - host.turnStartMs < 3_000) continue;
    const a = preflop(cur.seat);
    t.host.handlePlayerAction(cur.user_id, a.action, (a as any).amount);
  }
  const bbPreflop = (host.actions as any[])
    .filter((a) => a.userId === bbId && a.stage === 'preflop' && a.origin !== 'forced')
    .map((a) => a.action);
  return { t, bbId, asked, bbPreflop };
}
