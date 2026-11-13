/**
 * Chain through the DATABASE ACCEPT PATH, database boundary mocked (2026-11-13). The mock reproduces the semantics of
 * trigger horse_exact_accept_hand (migration 20261106091733): a settled hand is learned into horse_exact_profiles only
 * when its public_memory_domain is valid; the row is keyed (user, variant, mode, size, domain); counters are added with
 * the learner's increment function (the SQL fn_horse_exploit_increments mirrors exploitHandIncrements; the add mirrors
 * decayAndAdd); fn_horse_exact_profiles_read returns the rows of one domain. Then: profile -> HorseMind import ->
 * style read -> decision consults it -> bounded adjustment -> legal committed action.
 */
import { describe, expect, it } from 'vitest';
import { HorseMind } from './HorseMind.js';
import { decayAndAdd, exploitHandIncrements, freshExploitCounters, type ExploitCounters } from './HorseOpponentExploit.js';
import { HERO, VILLAIN, decide, turnPotBet } from './HorseOpponentStyle.contexts.test-support.js';

type Domain = { version: 1; speed: 'table' | 'lightning'; ante: 'none' | 'individual' | 'big_blind' };
interface ProfileRow { user_id: string; variant: string; mode: 'cash' | 'tournament'; size: 'hu' | 'short' | 'full'; public_memory_domain: Domain; counters: ExploitCounters; observed_hands: number; initialized: boolean }
const validDomain = (d: unknown): d is Domain => {
  const x = d as Domain;
  return !!x && x.version === 1 && ['table', 'lightning'].includes(x.speed) && ['none', 'individual', 'big_blind'].includes(x.ante);
};
/** The mocked database: the trigger's accept semantics and the read function. */
class MockDb {
  rows = new Map<string, ProfileRow>();
  accept(h: { game_variant: string; tournament_id: string | null; dealt: number; public_memory_domain: unknown; actions: Parameters<typeof exploitHandIncrements>[0] }): void {
    if (!validDomain(h.public_memory_domain)) return; // old/unknown-domain hands are never learned
    if (!(h.dealt >= 2 && h.dealt <= 10)) return;
    const mode = h.tournament_id === null ? 'cash' : 'tournament';
    const size = h.dealt <= 2 ? 'hu' : h.dealt <= 5 ? 'short' : 'full';
    for (const [user, inc] of exploitHandIncrements(h.actions)) {
      const key = `${user}|${h.game_variant}|${mode}|${size}|${JSON.stringify(h.public_memory_domain)}`;
      const row = this.rows.get(key) ?? { user_id: user, variant: h.game_variant, mode, size, public_memory_domain: h.public_memory_domain, counters: freshExploitCounters(), observed_hands: 0, initialized: true };
      decayAndAdd(row.counters, inc);
      row.observed_hands++;
      this.rows.set(key, row);
    }
  }
  read(ids: string[], variant: string, mode: string, size: string, domain: Domain): ProfileRow[] {
    return [...this.rows.values()].filter((r) => ids.includes(r.user_id) && r.variant === variant && r.mode === mode && r.size === size && JSON.stringify(r.public_memory_domain) === JSON.stringify(domain));
  }
}
const FILL = [3, 4, 5, 6].map((n) => `cccccccc-0000-4000-8000-00000000000${n}`);
/** A tight value-heavy villain hand: he folds preflop most hands, raises premiums. */
const handOf = (i: number) => ({
  game_variant: 'nlh',
  tournament_id: null,
  dealt: 6,
  actions: [
    ...(i % 9 === 0
      ? [{ userId: VILLAIN, action: 'raise', amount: 6, stage: 'preflop', origin: 'player' }, { userId: HERO, action: 'fold', amount: 0, stage: 'preflop', origin: 'player' }]
      : [{ userId: HERO, action: 'raise', amount: 6, stage: 'preflop', origin: 'player' }, { userId: VILLAIN, action: 'fold', amount: 0, stage: 'preflop', origin: 'player' }]),
    ...FILL.map((id) => ({ userId: id, action: 'fold', amount: 0, stage: 'preflop', origin: 'player' })),
  ],
});

describe('chain through the mocked database accept path', () => {
  it('only domain-stamped hands are learned; the learned profile reaches the decision', () => {
    const db = new MockDb();
    const domain: Domain = { version: 1, speed: 'table', ante: 'none' };
    for (let i = 0; i < 30; i++) db.accept({ ...handOf(i), public_memory_domain: undefined });
    expect(db.rows.size).toBe(0);
    for (let i = 0; i < 90; i++) db.accept({ ...handOf(i), public_memory_domain: domain });
    const rows = db.read([VILLAIN], 'nlh', 'cash', 'full', domain);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.observed_hands).toBe(90);

    HorseMind.reset();
    HorseMind.importDurableOpponentProfiles(rows as never);
    HorseMind.setDecisionScope('holdem:full', 'nlh', 'cash');
    const read = HorseMind.styleRead(VILLAIN);
    HorseMind.setDecisionScope(null);
    expect(read.evidence.state).toBe('supported_individual_read');
    expect(read.participation.side).toBe('tight');
    expect(read.receipt.provenance.preRepair).toBe('affected');

    // the decision consults the read and commits a legal action; the options-off decision is unchanged by it
    const off = decide(turnPotBet('cash'));
    HorseMind.reset();
    HorseMind.importDurableOpponentProfiles(rows as never);
    const on = decide(turnPotBet('cash'), { styleBigBetHonesty: true, styleRaiseRespect: true, styleValueBettorNotManiac: true });
    expect(on.fires.style_label_value_heavy_passive_seen ?? Object.keys(on.fires).some((k) => k.startsWith('style_label_'))).toBeTruthy();
    expect(['fold', 'call', 'raise', 'all_in']).toContain(on.decision.action);
    expect(['fold', 'call', 'raise', 'all_in']).toContain(off.decision.action);
  });
});
