/**
 * LIGHTNING POSITION FAIRNESS (20261110175018, Dan 2026-11-10: "I was SB 3
 * hands in a row and was on the button or in the bb multiple times within a
 * couple hands. this needs to be truly fair and corrected").
 *
 * The port of the live plan (m1, proven identical to fn_lightning_match_plan
 * on PostgreSQL by scripts/dev/test-lightning-matcher-parity.sh, section 14)
 * is driven over a pool whose players return from their hands at their own
 * pace, and every counter is kept exactly as fn_lightning_form_hand keeps it.
 * Each blind and the button must go to the player who has gone longest
 * without it: no repeats in a player's consecutive hands, shares close to
 * one per table size, bounded gaps. The same pool planned WITHOUT the
 * counters (the old rule) must show the defect, so this test can fail.
 */
import { describe, expect, it } from 'vitest';
import {
  LIGHTNING_MATCHER_PARAM_DEFAULTS,
  lightningMatcherModel,
  lightningRecencyPositions,
  type LightningPoolPlayer,
} from './LightningMatcherModel.js';
import { seededRandom } from './LightningMatcherSim.js';

type Role = 'bb' | 'sb' | 'btn' | 'other';

interface Sim {
  id: string;
  busyUntilMs: number;
  idleSinceMs: number;
  enteredAtMs: number;
  lastBbAtMs: number | null;
  handsSinceBb: number | null;
  handsSinceSb: number;
  handsSinceButton: number;
  lastButtonAtMs: number | null;
  positions: { btn: number; co: number; hj: number; utg: number };
  roles: Role[];
}

function runPool(recency: boolean, players = 40, hands = 4_000, seed = 11) {
  const rand = seededRandom(seed);
  const model = lightningMatcherModel('m1')!;
  const params = { ...LIGHTNING_MATCHER_PARAM_DEFAULTS };
  const pool: Sim[] = Array.from({ length: players }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    busyUntilMs: 0,
    idleSinceMs: i,
    enteredAtMs: i,
    // Everyone has been the big blind once already (no newcomers): the rule
    // under test is the steady state.
    lastBbAtMs: i,
    handsSinceBb: 0,
    handsSinceSb: 0,
    handsSinceButton: 0,
    lastButtonAtMs: null,
    positions: { btn: 0, co: 0, hj: 0, utg: 0 },
    roles: [],
  }));
  let dealt = 0;
  for (let nowMs = 1_000; dealt < hands; nowMs += 500) {
    const idle = pool.filter((p) => p.busyUntilMs <= nowMs);
    for (const p of idle) if (p.busyUntilMs > p.idleSinceMs) p.idleSinceMs = p.busyUntilMs;
    const snapshotPlayers: LightningPoolPlayer[] = idle.map((p) => ({
      playerId: p.id,
      legal: true,
      reasonCode: null,
      idleSinceMs: p.idleSinceMs,
      enteredAtMs: p.enteredAtMs,
      joinedAtMs: p.enteredAtMs,
      slotOpenedAtMs: p.enteredAtMs,
      lastBbAtMs: p.lastBbAtMs,
      bbUnresolved: false,
      debtSinceMs: p.enteredAtMs,
      handsSinceBb: p.handsSinceBb,
      newcomer: false,
      positions: { ...p.positions },
      ...(recency
        ? {
            handsSinceSb: p.handsSinceSb,
            handsSinceButton: p.handsSinceButton,
            lastButtonAtMs: p.lastButtonAtMs,
          }
        : {}),
    }));
    const plan = model.plan({ nowMs, players: snapshotPlayers, recentHands: [] }, params);
    for (const [ordinal, g] of plan.groups.entries()) {
      const stamp = nowMs + ordinal / 1000;
      dealt++;
      const size = g.players.length;
      g.players.forEach((id, i) => {
        const p = pool.find((x) => x.id === id)!;
        const isBb = id === g.bb;
        const isSb = size > 2 && id === g.sb && id !== g.bb;
        const isBtn = id === g.btn;
        p.roles.push(isBb ? 'bb' : isSb ? 'sb' : isBtn ? 'btn' : 'other');
        // fn_lightning_form_hand's bookkeeping, exactly.
        if (isBb) {
          p.lastBbAtMs = stamp;
          p.handsSinceBb = 0;
        } else p.handsSinceBb = (p.handsSinceBb ?? 0) + 1;
        p.handsSinceSb = isSb ? 0 : p.handsSinceSb + 1;
        if (isBtn) {
          p.handsSinceButton = 0;
          p.lastButtonAtMs = stamp;
          p.positions.btn++;
        } else p.handsSinceButton++;
        if (i === size - 2) p.positions.co++;
        if (i === size - 3) p.positions.hj++;
        if (i === 2) p.positions.utg++;
        // Each player is back in the pool at their own pace.
        p.busyUntilMs = nowMs + 1_500 + Math.floor(rand() * 20_000);
      });
    }
  }
  const measure = (role: Role) => {
    let total = 0;
    let repeats = 0;
    let maxGap = 0;
    const shares: number[] = [];
    for (const p of pool) {
      let last = -1;
      let count = 0;
      p.roles.forEach((r, i) => {
        if (r !== role) return;
        count++;
        if (i > 0 && p.roles[i - 1] === role) repeats++;
        if (last >= 0) maxGap = Math.max(maxGap, i - last);
        last = i;
      });
      total += count;
      if (p.roles.length >= 100) shares.push((count / p.roles.length) * 100);
    }
    return {
      repeatPct: total === 0 ? 0 : (100 * repeats) / total,
      maxGap,
      minShare: Math.min(...shares),
      maxShare: Math.max(...shares),
    };
  };
  return { sb: measure('sb'), bb: measure('bb'), btn: measure('btn'), hands: dealt };
}

describe('Lightning position fairness: the longest waiting player takes each blind and the button', () => {
  it('never gives a player the small blind, the big blind or the button twice in a row, and keeps every share fair', () => {
    // Three seeds; measured 2026-11-10: small blind repeats 0 to 0.025%,
    // button 0.05% (a new table whose every candidate has just held it at
    // another table cannot avoid one), every gap at most 11, every share
    // 15.6 to 17.9 per 100. The old rule on the same pools: small blind
    // repeats 26 to 27% with gaps to 55, button 6.5 to 7.3% (production,
    // 2026-11-10: 28.5% and 22.3%).
    for (const seed of [11, 12, 13]) {
      const r = runPool(true, 40, 4_000, seed);
      expect(r.hands).toBeGreaterThanOrEqual(4_000);
      // Six-handed: the fair share of each is 16.7 per 100 hands.
      for (const k of ['sb', 'bb', 'btn'] as const) {
        expect(r[k].repeatPct).toBeLessThan(0.2);
        expect(r[k].minShare).toBeGreaterThan(15);
        expect(r[k].maxShare).toBeLessThan(18.5);
        expect(r[k].maxGap).toBeLessThanOrEqual(13);
      }
    }
  });

  it('shows the defect it guards against when the counters are absent (the old rule)', () => {
    const r = runPool(false);
    // The old small blind is the next in the big-blind order, and the old
    // button the fewest lifetime buttons: both repeat, and small blinds bunch.
    expect(r.sb.repeatPct).toBeGreaterThan(20);
    expect(r.sb.maxGap).toBeGreaterThan(30);
    expect(r.btn.repeatPct).toBeGreaterThan(5);
  });

  it('applies the recency rule only when every legal player carries the counters', () => {
    const base = {
      legal: true,
      reasonCode: null,
      idleSinceMs: 0,
      enteredAtMs: 0,
      lastBbAtMs: 0,
      bbUnresolved: false,
      debtSinceMs: 0,
      handsSinceBb: 0,
      newcomer: false,
      positions: { btn: 0, co: 0, hj: 0, utg: 0 },
    };
    const a = { ...base, playerId: 'a', handsSinceSb: 3, handsSinceButton: 2 };
    const b = { ...base, playerId: 'b' };
    expect(lightningRecencyPositions([a, a])).toBe(true);
    expect(lightningRecencyPositions([a, b])).toBe(false);
    expect(lightningRecencyPositions([{ ...b, legal: false }, a])).toBe(true);
  });

  it('gives the small blind to the most hands since one, and the button to the most hands since it (never held first on a tie)', () => {
    const model = lightningMatcherModel('m1')!;
    const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    const mk = (i: number, over: Partial<LightningPoolPlayer>): LightningPoolPlayer => ({
      playerId: id(i),
      legal: true,
      reasonCode: null,
      idleSinceMs: i,
      enteredAtMs: i,
      lastBbAtMs: 1_000 + i,
      bbUnresolved: false,
      debtSinceMs: i,
      handsSinceBb: 1,
      newcomer: false,
      positions: { btn: 0, co: 0, hj: 0, utg: 0 },
      handsSinceSb: 1,
      handsSinceButton: 1,
      lastButtonAtMs: 500,
      ...over,
    });
    // Player 0 is the big blind (oldest last_bb_at). Player 1 is next in the
    // big-blind order and just posted the small blind (0 hands since): the
    // old rule seated them there again. Player 4 has gone longest.
    const players = [
      mk(0, { lastBbAtMs: 1 }),
      mk(1, { lastBbAtMs: 2, handsSinceSb: 0 }),
      mk(2, { handsSinceSb: 2 }),
      mk(3, { handsSinceSb: 3, handsSinceButton: 0 }),
      mk(4, { handsSinceSb: 5 }),
      // Player 5: most hands since the button. Player 2 and 3 tie with
      // others; player 2 has never held it.
      mk(5, { handsSinceButton: 9 }),
    ];
    const plan = model.plan(
      { nowMs: 10_000, players, recentHands: [] },
      LIGHTNING_MATCHER_PARAM_DEFAULTS
    );
    const g = plan.groups[0];
    expect(g.bb).toBe(id(0));
    expect(g.sb).toBe(id(4));
    expect(g.btn).toBe(id(5));
    // The cut-off (the seat before the button) is the next longest without it.
    expect(g.players[g.players.length - 2]).not.toBe(id(3));

    // Without the counters the old rule stands: the small blind is the next
    // in the big-blind order, the player who just posted it.
    const legacy = model.plan(
      {
        nowMs: 10_000,
        players: players.map(({ handsSinceSb, handsSinceButton, lastButtonAtMs, ...p }) => p),
        recentHands: [],
      },
      LIGHTNING_MATCHER_PARAM_DEFAULTS
    );
    expect(legacy.groups[0].sb).toBe(id(1));
  });
});
