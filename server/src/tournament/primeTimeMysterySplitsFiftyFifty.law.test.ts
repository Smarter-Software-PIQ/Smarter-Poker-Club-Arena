/**
 * THE PRIME TIME FREE BUY MYSTERY SPLITS EVERY CHIP 50/50 (Dan, 2026-11-05).
 *
 * Dan, verbatim: "Yes, split all entries, rebuys and add-ons 50/50". The
 * Midway Union's 8:30 PM Prime Time Free Buy (NLH) is a mystery bounty where
 * every chip that enters the event (the promo-funded one-chip entry head, each
 * 1-chip rebuy, each 1-chip add-on) goes 0.50 to the mystery bounty pool and
 * 0.50 to the regular prize pool.
 *
 * How the split is carried, so the keys are read for what they mean:
 *
 *   bountyAmount 0.50            the bounty HEAD per entering chip: the half
 *                                that lands in tournaments.bounty_pool. The
 *                                database predicate fn_ca_midway_free_buy_format
 *                                names the event "mystery" only at exactly 0.50,
 *                                and the registration, rebuy and add-on rails
 *                                (migration 20261105035220) book 0.50 bounty and
 *                                0.50 prize for every chip.
 *   mysteryBountyPoolPercent 100 how the BOUNTY POOL (already the 0.50 half) is
 *   mysteryBountyRegular... 0    divided between the chest inventory (mystery)
 *                                and flat pre-money knockouts (regular). 100/0
 *                                means chests only: the whole bounty half seals
 *                                into chests at the money and no knockout pays
 *                                before the money. These two keys never touch
 *                                the regular prize pool, which is funded at the
 *                                till with its own 0.50 per chip.
 *   mysteryBountyTopPercent 20   the largest chest is 20% of the chest pool; a
 *                                ladder shape, not a split.
 *   mysteryBountyActivation      at_the_money: the chests open when the field
 *                                reaches the paid places.
 *
 * So the schedule as it stands IS the 50/50 split end to end. This law pins
 * the policy, the fixed board config it writes, the row it produces, the
 * database rails that book it, and the chest pool the engine draws from it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FIXED_BOARD, FIXED_BOARD_CLUBS, fixedBoardRowFor } from '../config/fixedBoard.js';
import {
  MIDWAY_FREE_BUY_FORMATS,
  MIDWAY_FREE_BUY_SLOT_FORMATS,
  MIDWAY_FREE_BUY_UNION_ID,
  midwayFreeBuyPolicyFor,
  withMidwayFreeBuyPolicy,
} from './midwayFreeBuyPolicy.js';
import {
  isChestsOnlyMysteryRow,
  mysteryPoolCents,
  shouldActivateMysteryBounty,
} from './mysteryBountyActivation.js';

const PRIME_TIME = 'Prime Time Free Buy (NLH)';

/** The one shape every Prime Time schedule config and event row must carry. */
const FIFTY_FIFTY = {
  buyIn: 0,
  buyInFee: 0,
  isRebuy: true,
  rebuyCost: 1,
  addOnAvailable: true,
  addonCost: 1,
  isBounty: true,
  isPko: false,
  isMysteryBounty: true,
  bountyAmount: 0.5,
  mysteryBountyPoolPercent: 100,
  mysteryBountyRegularPoolPercent: 0,
  mysteryBountyActivation: 'at_the_money',
  guaranteedPrize: 0,
} as const;

const MIGRATION = join(
  process.cwd(),
  '..',
  'supabase',
  'migrations',
  '20261105035220_midway_free_buy_rotation_formats_and_promo_funded_entries.sql'
);

describe('the Prime Time Free Buy mystery splits every chip 50/50 (owner 2026-11-05)', () => {
  it('the engine policy for the 8:30 PM slot is the 50/50 mystery', () => {
    expect(MIDWAY_FREE_BUY_SLOT_FORMATS[PRIME_TIME]).toBe('mystery');
    expect(midwayFreeBuyPolicyFor(PRIME_TIME)).toBe(MIDWAY_FREE_BUY_FORMATS.mystery);
    expect(MIDWAY_FREE_BUY_FORMATS.mystery).toMatchObject(FIFTY_FIFTY);
    // Half of a one-chip head on both sides: the rebuy and the add-on are the
    // same one chip as the entry, so each splits the same way.
    const p = MIDWAY_FREE_BUY_FORMATS.mystery;
    expect(p.bountyAmount * 2).toBe(p.rebuyCost);
    expect(p.bountyAmount * 2).toBe(p.addonCost);
  });

  it('the fixed board writes that split into the Midway Prime Time schedule config', () => {
    const midway = FIXED_BOARD_CLUBS.find((c) => c.clubId === MIDWAY_FREE_BUY_UNION_ID)!;
    expect(midway).toBeTruthy();
    const event = FIXED_BOARD.find((e) => e.name === PRIME_TIME)!;
    expect(event).toBeTruthy();
    expect(event.times).toEqual(['20:30']);
    const { config } = fixedBoardRowFor(midway, event);
    expect(config).toMatchObject({
      fixedBoard: PRIME_TIME,
      midwayFreeBuyFormat: 'midway-free-buy-mystery-v1',
      ...FIFTY_FIFTY,
    });
  });

  it('the event row it builds carries the split in the columns the rails read', () => {
    const row: Record<string, unknown> = withMidwayFreeBuyPolicy({
      union_id: MIDWAY_FREE_BUY_UNION_ID,
      club_id: MIDWAY_FREE_BUY_UNION_ID,
      name: PRIME_TIME,
      tournament_type: 'MTT',
      free_buy: true,
      buy_in_amount: 0,
      buy_in_fee: 0,
    } as Record<string, unknown>);
    expect(row).toMatchObject({
      is_bounty: true,
      is_pko: false,
      is_mystery_bounty: true,
      bounty_amount: 0.5,
      rebuy_cost: 1,
      addon_cost: 1,
      add_on_available: true,
      mystery_bounty_pool_percent: 100,
      mystery_bounty_regular_pool_percent: 0,
      mystery_bounty_activation: 'at_the_money',
      guaranteed_prize: 0,
      buy_in_fee: 0,
    });
    expect(isChestsOnlyMysteryRow(row)).toBe(true);
    expect(row.short_description).toContain('Half To The Mystery Bounty Pool, Half To The Prize Pool');
    expect(row.short_description).toContain('Rebuys And Add-Ons For The First Hour Split The Same Way');
  });

  it('the database rails book 0.50 bounty and 0.50 prize for the entry, the rebuy and the add-on', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    // The format predicate keys "mystery" on exactly the 0.50 head.
    expect(sql).toMatch(
      /coalesce\(t\.is_mystery_bounty,false\) AND NOT coalesce\(t\.is_pko,false\)\s+AND t\.bounty_amount=0\.50 THEN 'mystery'/
    );
    // Registration: the promo chip splits in half at the till (both doors).
    const entrySplit = sql.match(
      /ELSIF v_mfb='mystery' THEN\s+v_split\.charge:=0; v_split\.rake:=0; v_split\.bounty:=0\.50; v_split\.prize:=0\.50;/g
    );
    expect(entrySplit?.length).toBeGreaterThanOrEqual(2);
    // Rebuy and add-on: the head (bounty_amount 0.50) comes off the one-chip
    // purchase for a rebuy always, and for an add-on on the mystery format.
    expect(sql).toMatch(
      /IF v_is_bounty AND \(p_rebuy_type<>'addon'\s+OR public\.fn_ca_midway_free_buy_format\(p_tournament_id\)='mystery'\) THEN\s+v_bounty_head:=/
    );
    // No fee is taken from a Midway Free Buy purchase, so the other half is
    // the whole prize half.
    expect(sql).toContain(
      "IF public.fn_ca_midway_free_buy_format(p_tournament_id) IS NOT NULL THEN v_fee_ratio:=0; END IF;"
    );
    // The creation trigger writes the same chests-only terms on the row.
    expect(sql).toMatch(
      /NEW\.bounty_amount:=0\.50; NEW\.guaranteed_prize:=0;[\s\S]{0,400}NEW\.mystery_bounty_pool_percent:=100;\s+NEW\.mystery_bounty_regular_pool_percent:=0;/
    );
  });

  it('the whole bounty half becomes chests at the money; the prize half is untouched by the pool percents', () => {
    const p = MIDWAY_FREE_BUY_FORMATS.mystery;
    // 40 entries, 10 rebuys, 5 add-ons: 55 chips in. Each rail books 0.50/0.50.
    const chipsIn = 40 + 10 + 5;
    const bountyPoolCents = Math.round(chipsIn * p.bountyAmount * 100);
    const prizePoolCents = Math.round(chipsIn * (p.rebuyCost - p.bountyAmount) * 100);
    expect(bountyPoolCents).toBe(2750);
    expect(prizePoolCents).toBe(2750);
    expect(bountyPoolCents).toBe(prizePoolCents);
    // 100/0 seals the whole bounty half into chests, on whole chips (the odd
    // half chip stays in the bounty pool for the champion's residual). Nothing
    // of it is paid as a flat pre-money knockout.
    const chestPool = mysteryPoolCents(
      bountyPoolCents,
      p.mysteryBountyPoolPercent,
      p.mysteryBountyRegularPoolPercent,
      0,
      100
    );
    expect(chestPool).toBe(2700);
    expect(bountyPoolCents - chestPool).toBeLessThan(100);
    // At the money, chests only: a small field opens too.
    const decision = shouldActivateMysteryBounty({
      isMysteryBounty: true,
      stage: 'pending',
      entryClosed: true,
      allTablesBetweenHands: true,
      playersRemaining: 6,
      totalEntries: chipsIn,
      paidPlaces: 6,
      mode: p.mysteryBountyActivation,
      modeValue: null,
      mysteryPoolCents: chestPool,
      chestsOnly: p.mysteryBountyRegularPoolPercent === 0,
    });
    expect(decision.activate).toBe(true);
    expect(
      shouldActivateMysteryBounty({
        isMysteryBounty: true,
        stage: 'pending',
        entryClosed: true,
        allTablesBetweenHands: true,
        playersRemaining: 7,
        totalEntries: chipsIn,
        paidPlaces: 6,
        mode: p.mysteryBountyActivation,
        modeValue: null,
        mysteryPoolCents: chestPool,
        chestsOnly: true,
      }).activate
    ).toBe(false);
  });
});
