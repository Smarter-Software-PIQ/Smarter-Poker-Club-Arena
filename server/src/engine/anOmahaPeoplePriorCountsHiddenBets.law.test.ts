/**
 * LAW: THE PEOPLE PRIOR COUNTS THE BETS PEOPLE NEVER SHOWED (omahaPeoplePriorCountsHiddenBets, default OFF; lead-8
 * lane OFA 2026-11-27). A person's flop / turn bet that he did not win uncontested and never showed (folded later in
 * the hand, mucked at showdown) is the weak end the shown sample misses; the option's split cells count it as
 * non-value, per game and split (flop pot type, turn line), and the bettor's own record counts his the same way.
 */
import { describe, expect, it } from 'vitest';
import {
  omahaFlopPeoplePriorShare,
  omahaPeopleFlopCell,
  omahaPeoplePriorCell,
  omahaPeoplePriorShare,
} from './HorseOmahaFacingBetPeoplePrior.js';
import {
  omahaPeoplePriorFlopPotOf,
  omahaPeoplePriorHiddenCell,
  omahaPeoplePriorHiddenKeyOf,
  omahaPeoplePriorTurnLineOf,
} from './HorseOmahaPeoplePriorHidden.js';
import { OMAHA_PEOPLE_PRIOR_HIDDEN_DATA } from './HorseOmahaPeoplePriorHidden.data.js';
import {
  omahaBetReadIncrementsOf,
  omahaBetReadLearn,
  omahaBetReadOwnCellOf,
  omahaBetReadReset,
} from './HorseOmahaBetRead.js';
import { OPTION_SWITCH_RELEASE_DEFAULT_OFF } from './HorseOptionSwitch.js';

const pre = (seat: number, action: string, amount: number) => ({
  stage: 'preflop',
  seat,
  action,
  amount,
});
const flop = (seat: number, action: string, amount: number) => ({
  stage: 'flop',
  seat,
  action,
  amount,
});

describe('LAW: the people prior counts the bets people never showed', () => {
  it('ships dark: release default off', () => {
    expect(OPTION_SWITCH_RELEASE_DEFAULT_OFF).toContain('omahaPeoplePriorCountsHiddenBets');
  });

  it('with no key every cell is exactly today (the option off changes nothing)', () => {
    expect(omahaPeoplePriorCell('turn', 0.8, false, false, null)).toEqual(
      omahaPeoplePriorCell('turn', 0.8, false, false)
    );
    expect(omahaPeopleFlopCell(0.8, false, false, null)).toEqual(
      omahaPeopleFlopCell(0.8, false, false)
    );
    const input = {
      street: 'turn' as const,
      potFrac: 0.8,
      isRaise: false,
      multiway: false,
      paid: 8,
      winnable: 18,
      rake: 0,
      twoStreet: true,
      record: null,
    };
    expect(omahaPeoplePriorShare({ ...input, hidden: null })).toEqual(omahaPeoplePriorShare(input));
  });

  it('the river is never read from the hidden cells (every called river bettor is shown)', () => {
    expect(
      omahaPeoplePriorHiddenCell('river', false, 'big', { game: 'plo5', split: 'b' })
    ).toBeNull();
    expect(omahaPeoplePriorCell('river', 0.8, false, false, { game: 'plo5', split: 'b' })).toEqual(
      omahaPeoplePriorCell('river', 0.8, false, false)
    );
  });

  it('a split cell counts its hidden bets as non-value: corrected share at or above the shown share', () => {
    for (const c of Object.values(OMAHA_PEOPLE_PRIOR_HIDDEN_DATA))
      if (c.share !== null && c.shownShare !== null)
        expect(c.share).toBeGreaterThanOrEqual(c.shownShare);
    const g = OMAHA_PEOPLE_PRIOR_HIDDEN_DATA['turn|plo5|hu|big|b']!;
    const a = OMAHA_PEOPLE_PRIOR_HIDDEN_DATA['turn|all|hu|big|b']!;
    const ng = g.shown + g.hidden;
    const pa = Math.min(30, a.shown + a.hidden);
    const cell = omahaPeoplePriorCell('turn', 0.8, false, false, { game: 'plo5', split: 'b' });
    // the per-game cell shrinks toward the same split over both games by 30 pseudo-bets (people data both)
    expect(cell.n).toBe(ng + pa);
    expect(cell.share!).toBeCloseTo((ng * g.share! + pa * a.share!) / (ng + pa), 9);
  });

  it('a thin or empty split cell is blended toward the anchor, never replaced by the pooled cell', () => {
    // no PLO4 heads-up limped big flop bet with a key that has no bets: the share is the balanced share alone
    const empty = omahaPeopleFlopCell(0.8, true, false, { game: 'plo4', split: 'limped' });
    const input = {
      potFrac: 0.8,
      isRaise: false,
      multiway: false,
      paid: 8,
      winnable: 18,
      rake: 0,
      final: false,
      record: null,
    };
    const hidden = omahaFlopPeoplePriorShare({
      ...input,
      hidden: { game: 'plo4', split: 'limped' },
    })!;
    const cell = omahaPeopleFlopCell(0.8, false, false, { game: 'plo4', split: 'limped' });
    if (cell.share === null) expect(hidden.share).toBe(hidden.balanced);
    else expect(hidden.peopleN).toBe(cell.n);
    expect(empty.n === 0 || empty.share !== null).toBe(true);
  });

  it('the split keys read public actions only: pot type and the turn line', () => {
    expect(
      omahaPeoplePriorFlopPotOf([
        pre(1, 'sb', 1),
        pre(2, 'bb', 2),
        pre(3, 'call', 2),
        pre(1, 'call', 1),
      ])
    ).toBe('limped');
    expect(
      omahaPeoplePriorFlopPotOf([
        pre(1, 'sb', 1),
        pre(2, 'bb', 2),
        pre(3, 'raise', 7),
        pre(2, 'call', 5),
      ])
    ).toBe('single');
    expect(
      omahaPeoplePriorFlopPotOf([
        pre(1, 'sb', 1),
        pre(2, 'bb', 2),
        pre(3, 'raise', 7),
        pre(2, 'raise', 24),
      ])
    ).toBe('reraised');
    expect(omahaPeoplePriorTurnLineOf([flop(2, 'check', 0), flop(3, 'check', 0)], 3)).toBe('x');
    expect(omahaPeoplePriorTurnLineOf([flop(2, 'check', 0), flop(3, 'bet', 10)], 3)).toBe('b');
    expect(omahaPeoplePriorTurnLineOf([flop(2, 'bet', 10), flop(3, 'call', 10)], 3)).toBe('c');
    expect(omahaPeoplePriorHiddenKeyOf('plo6', 'turn', [], 3)).toBeNull();
    expect(omahaPeoplePriorHiddenKeyOf('plo5', 'river', [], 3)).toBeNull();
  });

  const hand = (
    key: string,
    endFold: boolean,
    showdown: Array<{ user_id: string; mucked?: boolean }>
  ) => ({
    handKey: key,
    variant: 'plo5',
    mode: 'cash' as const,
    board: null,
    shown: new Map(),
    showdown,
    actions: [
      { userId: 'p', stage: 'flop', action: 'bet', amount: 8, publicNode: { pot: 10, toCall: 0 } },
      { userId: 'h', stage: 'flop', action: 'call', amount: 8, publicNode: { pot: 18, toCall: 8 } },
      {
        userId: 'p',
        stage: 'turn',
        action: 'check',
        amount: 0,
        publicNode: { pot: 26, toCall: 0 },
      },
      { userId: 'h', stage: 'turn', action: 'bet', amount: 20, publicNode: { pot: 26, toCall: 0 } },
      {
        userId: 'p',
        stage: 'turn',
        action: endFold ? 'fold' : 'call',
        amount: endFold ? 0 : 20,
        publicNode: { pot: 46, toCall: 20 },
      },
    ],
  });

  it('a bet he gave up later or mucked is hidden; a bet he won uncontested is not', () => {
    const gaveUp = omahaBetReadIncrementsOf(hand('a', true, []) as never).find(
      (i) => i.userId === 'p' && i.bet
    );
    expect(gaveUp?.bet?.hidden).toBe(true);
    const mucked = omahaBetReadIncrementsOf(
      hand('b', false, [{ user_id: 'h' }, { user_id: 'p', mucked: true }]) as never
    ).find((i) => i.userId === 'p' && i.bet);
    expect(mucked?.bet?.hidden).toBe(true);
    const won = omahaBetReadIncrementsOf({
      ...hand('c', false, []),
      actions: hand('c', false, [])
        .actions.slice(0, 1)
        .concat([
          {
            userId: 'h',
            stage: 'flop',
            action: 'fold',
            amount: 0,
            publicNode: { pot: 18, toCall: 8 },
          },
        ]),
    } as never).find((i) => i.userId === 'p' && i.bet);
    expect(won?.bet?.hidden).toBe(false);
  });

  it('a fold facing a raise of his own wager is not a give-up (a value hand can be outdrawn or priced out)', () => {
    const raised = omahaBetReadIncrementsOf({
      handKey: 'x',
      variant: 'plo5',
      mode: 'cash',
      board: null,
      shown: new Map(),
      showdown: [],
      actions: [
        {
          userId: 'p',
          stage: 'flop',
          action: 'bet',
          amount: 8,
          publicNode: { pot: 10, toCall: 0 },
        },
        {
          userId: 'h',
          stage: 'flop',
          action: 'raise',
          amount: 30,
          publicNode: { pot: 18, toCall: 8 },
        },
        {
          userId: 'p',
          stage: 'flop',
          action: 'fold',
          amount: 0,
          publicNode: { pot: 48, toCall: 22 },
        },
      ],
    } as never).find((i) => i.userId === 'p' && i.bet);
    expect(raised?.bet?.hidden).toBe(false);
  });

  it('his record counts his hidden bets only when asked (the option)', () => {
    omahaBetReadReset();
    omahaBetReadLearn(hand('r1', true, []) as never);
    omahaBetReadLearn(
      hand('r2', false, [{ user_id: 'h' }, { user_id: 'p', mucked: true }]) as never
    );
    const off = omahaBetReadOwnCellOf('p', 'plo5', 'flop', 0.8, false)!;
    const on = omahaBetReadOwnCellOf('p', 'plo5', 'flop', 0.8, false, true)!;
    expect(off.shown).toBe(0);
    expect(on.shown).toBeCloseTo(2, 6);
    expect(on.value).toBe(0);
    omahaBetReadReset();
  });
});
