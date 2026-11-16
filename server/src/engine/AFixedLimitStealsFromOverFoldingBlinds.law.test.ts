/**
 * LAW: A FIXED-LIMIT STEAL WIDENS AGAINST OVER-FOLDING BLINDS ONLY (Fixed-Limit
 * lane W5, 2026-11-15; HorseDecideOpts.fixedLimitStealVsTightBlinds, read
 * `=== true`, DEFAULT OFF).
 *
 * The read recognises a player who over-folds (foldToBet engaged high), but
 * on main no hold'em or fixed-limit consumer widens a late-position open
 * against such blinds (O-TIGHT-FL-DIAGNOSIS: flh/flo8 first in from the
 * button, 0 decisions differ against a tight-passive blind). With the option
 * on, first in from the cutoff, button or small blind (or the heads-up
 * button) the open widens by at most FIXED_LIMIT_STEAL_MAX_WIDEN, and only
 * when EVERY player still to act has his own adequate over-folder read: not
 * presumed, foldToBet engaged high on at least FIXED_LIMIT_STEAL_MIN_OPPS
 * decayed opportunities, nothing preflop engaged wide. Unknown, presumed,
 * sparse or wrong-opponent reads change nothing; a folded player is not a
 * player still to act, whatever his read.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deal, decide, lcg, type Table } from './HuVariantSpot.test-support.js';
import { HorseMind } from './HorseMind.js';
import {
  EXPLOIT_STATS,
  OPPONENT_EXPLOIT_VERSION,
  type ExploitStatRead,
  type OpponentExploitRead,
} from './HorseOpponentExploit.js';
import {
  FIXED_LIMIT_OPEN_BAND,
  FIXED_LIMIT_STEAL_FULL_EXCESS,
  FIXED_LIMIT_STEAL_MAX_WIDEN,
  FIXED_LIMIT_STEAL_MIN_OPPS,
  fixedLimitOpenShare,
  fixedLimitOverFolder,
  fixedLimitStealWiden,
} from './HorseFixedLimitPreflop.js';
import type { HorseDecision } from '../types.js';

const uid = (seat: number) => `10000000-0000-4000-8000-00000000000${seat}`;
const STRANGER = '10000000-0000-4000-8000-0000000000aa';

function read(
  o: { fold?: Partial<ExploitStatRead>; presumed?: boolean; wide?: boolean } = {}
): OpponentExploitRead {
  const stats = Object.fromEntries(
    EXPLOIT_STATS.map((s) => [s, { mean: 0.3, n: 40, engaged: null, excess: 0 }])
  ) as Record<string, ExploitStatRead>;
  stats.foldToBet = { mean: 0.78, n: 40, engaged: 'high', excess: 0.3, ...o.fold };
  if (o.wide) stats.pfr = { mean: 0.6, n: 40, engaged: 'high', excess: 0.4 };
  return {
    version: OPPONENT_EXPLOIT_VERSION,
    envelope: 'test',
    scope: 'holdem:short',
    stats: stats as OpponentExploitRead['stats'],
    ...(o.presumed ? { presumed: true as const } : {}),
  };
}
const FOLDER = read();

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the over-folder read (pure)', () => {
  it('needs its own adequate, credible, non-wide fold read', () => {
    expect(fixedLimitOverFolder(FOLDER)).toBe(true);
    expect(fixedLimitOverFolder(null)).toBe(false); // unknown
    expect(fixedLimitOverFolder(read({ presumed: true }))).toBe(false);
    expect(fixedLimitOverFolder(read({ fold: { n: FIXED_LIMIT_STEAL_MIN_OPPS - 0.5 } }))).toBe(
      false
    ); // sparse (decayed opportunities)
    expect(fixedLimitOverFolder(read({ fold: { engaged: null } }))).toBe(false); // not credible
    expect(fixedLimitOverFolder(read({ fold: { engaged: 'low' } }))).toBe(false); // a caller
    expect(fixedLimitOverFolder(read({ wide: true }))).toBe(false); // raises wide
  });

  it('every player left must be one; the widen is bounded and scaled by the weakest read', () => {
    expect(fixedLimitStealWiden([])).toBeNull();
    expect(fixedLimitStealWiden([FOLDER, null])).toBeNull();
    expect(fixedLimitStealWiden([FOLDER, read({ presumed: true })])).toBeNull();
    const full = fixedLimitStealWiden([FOLDER, FOLDER])!;
    expect(full.widenShare).toBeCloseTo(FIXED_LIMIT_STEAL_MAX_WIDEN, 9);
    const half = fixedLimitStealWiden([
      FOLDER,
      read({ fold: { excess: FIXED_LIMIT_STEAL_FULL_EXCESS / 2 } }),
    ])!;
    expect(half.widenShare).toBeCloseTo(FIXED_LIMIT_STEAL_MAX_WIDEN / 2, 9);
  });
});

const DEALS = 300;

function table(variant: string, n: number, seed: number): Table {
  return deal({ variant, fmt: 'cash', stacks: Array(n).fill(200), rnd: lcg(seed) });
}
function foldTo(t: Table, seat: number): void {
  for (let k = 0; k < 12; k++) {
    const cur = t.controller.getCurrentPlayer()!;
    if (cur.seat === seat) return;
    t.controller.performAction(cur.seat, 'fold', undefined, 'player');
  }
  throw new Error(`seat ${seat} never reached`);
}
const pick = (d: HorseDecision) => ({ action: d.action, amount: d.amount, thinkTime: d.thinkTime });

/** Reads by user id for the spy; anything absent is unknown (null). */
function withReads(reads: Record<string, OpponentExploitRead | null>): void {
  vi.spyOn(HorseMind, 'opponentRead').mockImplementation((id: string) => reads[id] ?? null);
}

/** Raise share at a seat, and how many decisions differ from the steal-off arm. */
function stealRun(
  variant: string,
  n: number,
  seat: number,
  base: Record<string, unknown>
): { share: number; offShare: number; differ: number } {
  let raises = 0;
  let offRaises = 0;
  let differ = 0;
  for (let i = 0; i < DEALS; i++) {
    const t = table(variant, n, 21000 + i);
    foldTo(t, seat);
    const on = decide(t, 22000 + i, { mind: true, ...base, fixedLimitStealVsTightBlinds: true }).d;
    const off = decide(t, 22000 + i, { mind: true, ...base }).d;
    if (on.action === 'raise') raises++;
    if (off.action === 'raise') offRaises++;
    if (JSON.stringify(pick(on)) !== JSON.stringify(pick(off))) differ++;
  }
  return { share: raises / DEALS, offShare: offRaises / DEALS, differ };
}

describe('the steal widens only against read over-folders (decisions, option on)', () => {
  for (const variant of ['flh', 'flo8']) {
    for (const base of [{ fixedLimitPricedPreflop: true }, {}]) {
      const label = `${variant}${'fixedLimitPricedPreflop' in base ? ' (priced)' : ' (legacy bars)'}`;

      it(`${label}: button vs two over-folding blinds opens wider, within the bound`, () => {
        withReads({ [uid(2)]: FOLDER, [uid(3)]: FOLDER });
        const r = stealRun(variant, 6, 1, base);
        expect(r.share).toBeGreaterThan(r.offShare + 0.05);
        const ref = fixedLimitOpenShare(variant as 'flh', 6, 2)!.raise;
        if ('fixedLimitPricedPreflop' in base)
          expect(r.share).toBeLessThanOrEqual(
            ref + FIXED_LIMIT_STEAL_MAX_WIDEN + FIXED_LIMIT_OPEN_BAND
          );
        // Widen only: every changed decision is a fold that became a raise.
        expect(r.differ).toBeGreaterThan(0);
      }, 240_000);

      it(`${label}: unknown, presumed, sparse and wide blinds change nothing`, () => {
        for (const reads of [
          {},
          { [uid(2)]: read({ presumed: true }), [uid(3)]: read({ presumed: true }) },
          { [uid(2)]: FOLDER, [uid(3)]: read({ fold: { n: 3 } }) },
          { [uid(2)]: FOLDER, [uid(3)]: read({ wide: true }) },
        ]) {
          vi.restoreAllMocks();
          withReads(reads);
          expect(stealRun(variant, 6, 1, base).differ).toBe(0);
        }
      }, 240_000);

      it(`${label}: the wrong opponent's read and a folded player's read change nothing`, () => {
        // An over-folder who is not at this table, the blinds unknown.
        withReads({ [STRANGER]: FOLDER });
        expect(stealRun(variant, 6, 1, base).differ).toBe(0);
        // The over-folders FOLDED before the button acted; the blinds unknown.
        vi.restoreAllMocks();
        withReads({ [uid(4)]: FOLDER, [uid(5)]: FOLDER, [uid(6)]: FOLDER });
        expect(stealRun(variant, 6, 1, base).differ).toBe(0);
        // Folded unknown players do not block a steal against folding blinds.
        vi.restoreAllMocks();
        withReads({ [uid(2)]: FOLDER, [uid(3)]: FOLDER });
        expect(stealRun(variant, 6, 1, base).differ).toBeGreaterThan(0);
      }, 240_000);

      it(`${label}: an early seat never steals; the cutoff needs the button too`, () => {
        withReads({ [uid(1)]: FOLDER, [uid(2)]: FOLDER, [uid(3)]: FOLDER, [uid(6)]: FOLDER });
        expect(stealRun(variant, 6, 4, base).differ).toBe(0); // UTG, four behind
        vi.restoreAllMocks();
        withReads({ [uid(2)]: FOLDER, [uid(3)]: FOLDER }); // the button unknown
        expect(stealRun(variant, 6, 6, base).differ).toBe(0);
      }, 240_000);
    }
  }
});
