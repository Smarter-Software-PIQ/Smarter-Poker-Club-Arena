import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { displayTotalPool, guaranteeShortfall } from '../src/utils/tournamentPrizeFunding';
import { effectivePrizePool } from '../src/components/tournament/details/types';

// Dan, 2026-11-05: "The full qualifying player-funded tournament payment
// counts toward the buy-in guarantee before deducting bounty allocations or
// rake." H = max(0, G - C), funded once; guarantee credit is not money.
const MIGRATION =
  'supabase/migrations/20261105222502_a_buyin_guarantee_counts_the_whole_player_payment.sql';

describe('a buy-in guarantee counts the whole player payment', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it('the house owes max(0, guarantee - gross), reconciled against what it already posted', () => {
    expect(sql).toContain("'house_required', greatest(0, v.g - v.c)");
    expect(sql).toContain("'house_due', greatest(0, greatest(0, v.g - v.c) - v.p)");
  });

  it('gross is player wallet buy-ins, rebuys and add-ons, seats and redeemed tickets; never house or promo money', () => {
    expect(sql).toContain("l.category IN ('tournament_buyin', 'rebuy', 'addon')");
    expect(sql).toContain("l.category IN ('overlay', 'promo_send')");
    const paidIn = sql.slice(sql.indexOf('coalesce(sum(l.amount)'), sql.indexOf('AS paid_in'));
    expect(paidIn).not.toContain('promo_send');
    expect(paidIn).not.toContain('overlay');
  });

  it('every finalization and settlement guard reads the gross floor, Diamonds keep their book', () => {
    for (const f of [
      'fn_ca_apply_prize_guarantee_core',
      'fn_apply_prize_guarantee_before_atomic_proof',
      'fn_settle_tournament_places_atomic',
      'fn_settle_final_table_deal_atomic',
      'fn_settle_tournament_final_table_deal',
      'fn_settle_tournament_places',
      'trg_tournament_atomic_place_completion_guard',
      'fn_ca_overlay_shortfall',
    ]) {
      expect(sql).toContain(`'public.${f}(`);
    }
    expect(sql).toContain('public.fn_poker_diamond_tournament(p_tournament_id)');
    expect(sql).toMatch(/an unpatched place guarantee remains/);
  });

  it('the owner examples: 13 x 40 against 500 needs zero; 10 x 40 needs 100', () => {
    expect(guaranteeShortfall(500, 13 * 26, 13 * 10, 13 * 4)).toBe(0);
    expect(guaranteeShortfall(500, 10 * 26, 10 * 10, 10 * 4)).toBe(100);
    // Places carry no pending overlay (Dan 2026-11-06); the house share is
    // shown beside the guarantee and funded at close.
    expect(effectivePrizePool(260, 500, 100, 40)).toBe(260);
    expect(effectivePrizePool(338, 500, 130, 52)).toBe(338);
  });

  it('a screen never stacks the guarantee on collected money', () => {
    expect(displayTotalPool(41 * 27, 1500, 0, 41 * 3)).toBe(1107);
    expect(displayTotalPool(41 * 27, 1500, 0, 41 * 3)).not.toBe(2445);
  });

  it.each([
    ['src/components/tournament/TournamentLobbyCard.tsx', 'tournament.totalRake'],
    ['src/components/lobby/GameLobbyPanel.tsx', 'tournament.total_rake'],
    ['src/components/table/TournamentBreakScreen.tsx', 't.total_rake'],
    ['src/pages/XMTTPage.tsx', 'detail.tournament?.total_rake'],
    ['src/components/tournament/details/RewardsTab.tsx', 't.total_rake'],
  ])('%s passes the rake into the guarantee arithmetic', (file, token) => {
    expect(readFileSync(file, 'utf8')).toContain(token);
  });
});

describe('a guaranteed Free Buy ticket funding is part of H, never on top of it', () => {
  const promo = readFileSync(
    'supabase/migrations/20261105225426_guaranteed_free_buy_ticket_funding_is_part_of_h.sql',
    'utf8'
  );
  it('returns promo above max(0, G - C) to the promo wallet once, before the pool finalizes', () => {
    expect(promo).toContain("(v_funding->>'house_over_required')::numeric, v_promo");
    expect(promo).toContain("':guarantee_promo_excess_return'");
    expect(promo).toContain(
      'PERFORM public.fn_ca_return_excess_guarantee_promo_locked(p_tournament_id);'
    );
    expect(promo).toContain(
      "IF v_format IS NULL OR v_format NOT IN ('regular', 'aiof') THEN RETURN 0; END IF;"
    );
  });
  it('owner example: G 500, 250 tickets, 160 player chips -> promo 340, pool 500', () => {
    const G = 500,
      C = 160,
      V = 250;
    const H = Math.max(0, G - C);
    expect(H).toBe(340);
    expect(Math.max(0, V - H)).toBe(0);
    expect(C + H).toBe(500);
  });
});

describe('the overlay gates count the whole player payment too', () => {
  // Dan, 2026-11-05 applied to every door that sizes an overlay BEFORE the
  // close-out: the Game Management readiness read and the publish and start
  // guards behind it, the announce-time affordability trigger, the owners'
  // bank-short notice, the satellite seat funding at lock and its return,
  // and the digest's estimate. Each read guarantee - prize_pool, which
  // charged the bank the bounty pool and the rake as if they were owed:
  // 2,448 against the ledger's 2,420 on the registering 2.5K GTD bounty
  // freezeout, 1,304 against a true 660 at 46 entries.
  const GATES =
    'supabase/migrations/20261107183629_overlay_gates_count_the_whole_player_payment.sql';
  const sql = readFileSync(GATES, 'utf8');
  const CREDIT = 'COALESCE(t.prize_pool, 0) + COALESCE(t.bounty_pool, 0) + COALESCE(t.total_rake, 0)';

  it('rewrites exactly the six doors, pinned pre and post', () => {
    for (const f of [
      'fn_tournament_management_readiness_for_row(jsonb)',
      'trg_tournaments_guarantee_affordable()',
      'fn_notify_guarantee_bank_short(uuid)',
      'fn_ca_fund_overlay_on_lock()',
      'fn_ca_return_excess_start_overlay_locked(uuid)',
      'fn_audit_overlays(date)',
    ]) {
      expect(sql).toContain(`'public.${f}'`);
    }
    expect(sql).toContain("'972c60949b7d9001a4fe32f45ff8fb0a'");
    expect(sql).toContain("'1fa678744a8743a1f7594f2fbe118f8c'");
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql).toMatch(/^COMMIT;$/m);
    expect(sql).not.toMatch(/^\s*(GRANT|REVOKE|ALTER TABLE|INSERT|DELETE|UPDATE) /m);
  });

  it('the readiness overlay and every exposure sum are guarantee - (places + bounties + rake)', () => {
    expect(sql).toContain('v_credit numeric := v_pool + v_bounty + v_rake;');
    expect(sql).toContain('v_required := greatest(v_effective_guarantee - v_credit, 0);');
    expect(sql).toContain(`) - (${CREDIT}),`);
    expect(sql).toContain(
      "v_this     := greatest(coalesce(new.guaranteed_prize,0) - (coalesce(new.prize_pool,0) + coalesce(new.bounty_pool,0) + coalesce(new.total_rake,0)), 0);"
    );
    expect(sql).toContain(
      ') - (coalesce(t.prize_pool, 0) + coalesce(t.bounty_pool, 0) + coalesce(t.total_rake, 0)),'
    );
    expect(sql).toContain("'guarantee_credit', v_credit,");
  });

  it('the lock and its return read the ledger floor; a satellite seat keeps its full value', () => {
    expect(sql).toContain(
      'GREATEST(public.fn_ca_guarantee_place_floor(NEW.id, NEW.prize_pool, NEW.guaranteed_prize, NEW.bounty_pool),'
    );
    expect(sql).toContain("(public.fn_ca_guarantee_funding(p_tournament_id)->>'gross_coverage')::numeric");
    expect(sql).toContain(
      'v_target := GREATEST(round(v_collected + v_required, 2), COALESCE(v_seat_guarantee, 0), v_collected);'
    );
    expect(sql).toContain('greatest(gtd-greatest(entries*(bi+fee),pool+pool_credit),0) entry_only_gap');
  });

  it('the diamond capture carries the current readiness door, and its md5 matches', async () => {
    const { createHash } = await import('node:crypto');
    const manifest = JSON.parse(readFileSync('tests/sql/diamond-tournament-current.manifest.json', 'utf8'));
    const door = manifest.doors.find(
      (d: { signature: string }) => d.signature === 'fn_tournament_management_readiness_for_row(jsonb)'
    );
    expect(door.full_md5).toBe('88ac34de6a2a33d22673cb324bd46497');
    expect(createHash('md5').update(door.definition).digest('hex')).toBe(door.full_md5);
    expect(door.definition).toContain(
      'v_required := greatest(greatest(v_guaranteed - v_credit, v_seat_guarantee - v_pool), 0);'
    );
    expect(door.definition).not.toContain('v_required := greatest(v_effective_guarantee - v_credit, 0);');
    expect(door.definition).toContain("v_bank_type := 'diamond_house_earmark';\n    -- A DIAMOND EVENT KEEPS ITS RECORDED PLACE-BASED GUARANTEE");
    expect((door.definition.match(new RegExp(CREDIT.replace(/[()+]/g, '\\$&'), 'g')) || []).length).toBe(2);
  });

  it('the owner example on the gates: 46 x 40 against 2,500 owes 660, never 1,304', () => {
    const places = 46 * 26,
      bounties = 46 * 10,
      rake = 46 * 4;
    expect(Math.max(0, 2500 - (places + bounties + rake))).toBe(660);
    expect(Math.max(0, 2500 - places)).toBe(1304);
  });
});

describe('a guaranteed seat and a Diamond guarantee keep their own credit', () => {
  // 2026-11-07, follow-up to 20261107183629: the whole-payment credit belongs
  // to the buy-in guarantee only. A satellite's seats are bought from places
  // (fn_ca_fund_overlay_on_lock), and a Diamond event keeps its place-based
  // guarantee (20261007000010).
  const sql = readFileSync(
    'supabase/migrations/20261107204028_seats_and_diamond_guarantees_keep_their_own_credit.sql',
    'utf8'
  );
  it('pins both doors pre and post and measures each guarantee on its own credit', () => {
    expect(sql).toContain("'1fa678744a8743a1f7594f2fbe118f8c'");
    expect(sql).toContain("'88ac34de6a2a33d22673cb324bd46497'");
    expect(sql).toContain("'30d13b24ee6332f0191802a629d82abf'");
    expect(sql).toContain("'44d4ebbc497c11ce739d8a7d63c93b0c'");
    expect(sql).toContain('v_required := greatest(greatest(v_guaranteed - v_credit, v_seat_guarantee - v_pool), 0);');
    expect(sql).toContain('v_required := greatest(v_effective_guarantee - v_pool, 0);');
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql).toMatch(/^COMMIT;$/m);
  });
  it('the owner arithmetic: 2 seats of 30 against 6 entries of 8.10 places + 0.90 rake needs 11.40', () => {
    const places = 6 * 8.1, rake = 6 * 0.9;
    const seats = 60;
    const required = Math.max(0, 0 - (places + rake), seats - places);
    expect(Math.round(required * 100) / 100).toBe(11.4);
  });
});
