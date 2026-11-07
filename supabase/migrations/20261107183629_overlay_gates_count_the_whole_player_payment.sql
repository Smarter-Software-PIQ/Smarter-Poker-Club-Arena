-- 20261107183629_overlay_gates_count_the_whole_player_payment.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- THE OVERLAY GATES COUNT THE WHOLE PLAYER PAYMENT (2026-11-07)
--
-- Owner rulings: a buy-in guarantee counts the whole player payment
-- (2026-11-05), the total prize pool is the buy-ins net of rake and the
-- bounty pool comes straight out of it (2026-11-06). The close-out already
-- obeys them: fn_ca_guarantee_funding reads the ledger and the house funds
-- max(0, guarantee - (places + bounties + rake)) once when the pool
-- finalizes (#9591), and every player screen prints the same number (#9786).
-- Six doors that size an overlay BEFORE close were still on the old rule,
-- guarantee - prize_pool, which charges the bank the bounty pool and the rake
-- as if they were still owed:
--
--   fn_tournament_management_readiness_for_row  the Game Management
--     "Overlay Required" / "Short By" figures, and the funding_blocked state
--     that fn_guard_tournament_publish_readiness and
--     fn_guard_tournament_start_readiness refuse a publish or a start on.
--     Measured 2026-11-07 on the registering 40 Chip Bounty Freezeout 2.5K
--     GTD (2 entries, 52 places / 20 bounties / 8 rake): 2,448 owed against
--     the ledger's 2,420; at 46 entries it would read 1,304 against a true
--     660. A bank that covers the true overlay could be told it does not.
--   trg_tournaments_guarantee_affordable  the same arithmetic on the
--     event being announced AND on every other open guaranteed event, so a
--     club could be refused a guarantee its bank covers.
--   fn_notify_guarantee_bank_short  the owners' bank-short notice, same
--     exposure sum.
--   fn_ca_fund_overlay_on_lock  the start-time funding of a satellite's
--     guaranteed seats compared max(guarantee - bounties, seats) against the
--     places alone; the guarantee half now uses the ledger place floor
--     (fn_ca_guarantee_place_floor), the seats keep their full value.
--   fn_ca_return_excess_start_overlay_locked  the matching return of a
--     start-time overlay the field outgrew, now targeting places collected +
--     max(0, guarantee - gross coverage) read from fn_ca_guarantee_funding.
--   fn_audit_overlays  the digest's entry-only estimate counted entries x
--     buy-in against the place pool; it now counts entries x (buy-in + fee)
--     against places + bounties + rake, the same credit.
--
-- Every other overlay path (fn_ca_apply_prize_guarantee_core and its guards,
-- fn_ca_tournament_prize_funding, fn_overlay_at_risk,
-- fn_tournament_guarantee_check, the Free Buy cutoff funding) already reads
-- the whole payment and is untouched. The Diamond arms keep their recorded
-- place-based guarantee (20261007000010) and are untouched.
--
-- PROVEN IN AN EXPLICITLY ROLLED-BACK PRODUCTION TRANSACTION, 2026-11-07.
-- The six postimages below were derived from the live preimages by these
-- exact anchors, installed privately in pg_temp, and compared to the live
-- doors over every open, unfinalized tournament (290 rows): no key other than
-- the overlay figures moved, no overlay rose, no event became
-- funding_blocked, and on every chip event with a guarantee the new
-- overlay_required equalled fn_ca_guarantee_funding(id).house_required
-- exactly (0 mismatches). The registering bounty event read 2,448 -> 2,420
-- with guarantee_credit 80. Then RAISE EXCEPTION, so nothing was installed.
--
-- GUARDS: refuses inside the break window; every live body must be the
-- proven preimage (or already the postimage, in which case that door is
-- skipped); every anchor must be found exactly as often as expected; each
-- derived postimage must be the proven md5 before it is executed; owner,
-- SECURITY DEFINER, search_path and ACL are read before and asserted
-- unchanged after; the readback must be byte-identical. No GRANT, no table.
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_tournament_management_readiness_for_row(jsonb)'::regprocedure))) = '1fa678744a8743a1f7594f2fbe118f8c'
--
-- Wrap ALL DDL for one change in ONE transaction: every DDL statement fires
-- Supabase's schema-cache reload, which takes ~28s on this database, and ten
-- loose statements mean ten reloads (club-arena CLAUDE.md, production DDL policy).

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_reason text;
BEGIN
  v_reason := public.fn_ca_break_window_refuses_migrations(now());
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION 'OVERLAY_GATES_REFUSED: %', v_reason USING ERRCODE = '55000';
  END IF;
END
$pre$;

DO $component$
DECLARE
  v_sig text; v_src text; v_out text; v_prev text; v_n int;
  v_pre  text[] := ARRAY['972c60949b7d9001a4fe32f45ff8fb0a','fbad4a15088efa8979b615a78f830a97','a21ec12e2e8f0a374e114eb16f69bd63','7d5257cc66ae2e73a66bd673267fb3a5','f11d9cfc1eda88c392f234d1dd877699','0db49f236eb1abad7bb2d8af6da70b77'];
  v_sigs text[] := ARRAY['public.fn_tournament_management_readiness_for_row(jsonb)','public.trg_tournaments_guarantee_affordable()','public.fn_notify_guarantee_bank_short(uuid)','public.fn_ca_fund_overlay_on_lock()','public.fn_ca_return_excess_start_overlay_locked(uuid)','public.fn_audit_overlays(date)'];
  v_expect text[] := ARRAY['1fa678744a8743a1f7594f2fbe118f8c','efde5cebc699be085dfcfbc327b7f322','30d13b24ee6332f0191802a629d82abf','8d9f9f1d6f6806bac9aec0202de08997','40f3174b1844bd011456aac2cbef8671','5f8f22881e5dac4b1e8836518e8a813a'];
  v_post text[] := ARRAY[]::text[];
  v_bodies text[] := ARRAY[]::text[];
  i int;
BEGIN
  FOR i IN 1..6 LOOP
    v_sig := v_sigs[i];
    v_src := pg_get_functiondef(v_sig::regprocedure);
    IF md5(v_src) = v_expect[i] THEN
      -- already the proven postimage: nothing to derive, nothing to reload
      v_post := v_post || md5(v_src);
      v_bodies := v_bodies || v_src;
      CONTINUE;
    END IF;
    IF md5(v_src) <> v_pre[i] THEN RAISE EXCEPTION 'OVERLAY_GATES: % live body % is not the proven preimage', v_sig, md5(v_src); END IF;
    v_out := v_src;

    IF i = 1 THEN
      v_prev := v_out;
      v_out := replace(v_out,
$a$  v_pool numeric := COALESCE(NULLIF(p_row ->> 'prize_pool', '')::numeric, 0);$a$,
$b$  v_pool numeric := COALESCE(NULLIF(p_row ->> 'prize_pool', '')::numeric, 0);
  -- A BUY-IN GUARANTEE COUNTS THE WHOLE PLAYER PAYMENT (Dan, 2026-11-05):
  -- places + bounties + rake is what the field has credited toward the
  -- guarantee, so the overlay this event needs, and the exposure every
  -- other open event carries, is the guarantee less that credit. Never the
  -- guarantee less the place pool alone, which charged the bank the bounty
  -- pool and the rake twice over (1,304 against a true 660 on the 2.5K GTD
  -- 40 Chip Bounty Freezeout at 46 entries) and could refuse a start the
  -- bank covered. The same credit fn_ca_guarantee_funding reads from the
  -- ledger at close; here it is read from the row the guards are given.
  v_bounty numeric := COALESCE(NULLIF(p_row ->> 'bounty_pool', '')::numeric, 0);
  v_rake numeric := COALESCE(NULLIF(p_row ->> 'total_rake', '')::numeric, 0);
  v_credit numeric := v_pool + v_bounty + v_rake;$b$);
      IF v_out = v_prev THEN RAISE EXCEPTION 'OVERLAY_GATES: readiness anchor 1 (declarations) not found'; END IF;

      v_n := (length(v_out) - length(replace(v_out, $a$             ) - COALESCE(t.prize_pool, 0),$a$, ''))) / length($a$             ) - COALESCE(t.prize_pool, 0),$a$);
      IF v_n <> 2 THEN RAISE EXCEPTION 'OVERLAY_GATES: readiness anchor 2 (exposure) found % times, expected 2', v_n; END IF;
      v_out := replace(v_out,
$a$             ) - COALESCE(t.prize_pool, 0),$a$,
$b$             ) - (COALESCE(t.prize_pool, 0) + COALESCE(t.bounty_pool, 0) + COALESCE(t.total_rake, 0)),$b$);

      v_prev := v_out;
      v_out := replace(v_out,
$a$  v_required := greatest(v_effective_guarantee - v_pool, 0);$a$,
$b$  v_required := greatest(v_effective_guarantee - v_credit, 0);$b$);
      IF v_out = v_prev THEN RAISE EXCEPTION 'OVERLAY_GATES: readiness anchor 3 (overlay) not found'; END IF;

      v_prev := v_out;
      v_out := replace(v_out,
$a$    'current_prize_pool', v_pool,
    'overlay_required', v_required,$a$,
$b$    'current_prize_pool', v_pool + v_bounty,
    'current_place_pool', v_pool,
    'current_bounty_pool', v_bounty,
    'guarantee_credit', v_credit,
    'overlay_required', v_required,$b$);
      IF v_out = v_prev THEN RAISE EXCEPTION 'OVERLAY_GATES: readiness anchor 4 (report) not found'; END IF;

    ELSIF i = 2 THEN
      v_n := (length(v_out) - length(replace(v_out, $a$greatest(coalesce(t.guaranteed_prize,0) - coalesce(t.prize_pool,0), 0)$a$, ''))) / length($a$greatest(coalesce(t.guaranteed_prize,0) - coalesce(t.prize_pool,0), 0)$a$);
      IF v_n <> 2 THEN RAISE EXCEPTION 'OVERLAY_GATES: affordable anchor 1 (exposure) found % times, expected 2', v_n; END IF;
      v_out := replace(v_out,
$a$greatest(coalesce(t.guaranteed_prize,0) - coalesce(t.prize_pool,0), 0)$a$,
$b$greatest(coalesce(t.guaranteed_prize,0) - (coalesce(t.prize_pool,0) + coalesce(t.bounty_pool,0) + coalesce(t.total_rake,0)), 0)$b$);

      v_prev := v_out;
      v_out := replace(v_out,
$a$  v_this     := greatest(coalesce(new.guaranteed_prize,0) - coalesce(new.prize_pool,0), 0);$a$,
$b$  -- A BUY-IN GUARANTEE COUNTS THE WHOLE PLAYER PAYMENT (Dan, 2026-11-05):
  -- the bank owes the guarantee less places + bounties + rake, on this event
  -- and on every other open one, so a club is never refused a guarantee its
  -- bank covers because the bounty pool and the rake were counted as owed.
  v_this     := greatest(coalesce(new.guaranteed_prize,0) - (coalesce(new.prize_pool,0) + coalesce(new.bounty_pool,0) + coalesce(new.total_rake,0)), 0);$b$);
      IF v_out = v_prev THEN RAISE EXCEPTION 'OVERLAY_GATES: affordable anchor 2 (this event) not found'; END IF;

    ELSIF i = 3 THEN
      v_n := (length(v_out) - length(replace(v_out, $a$             ) - coalesce(t.prize_pool, 0),$a$, ''))) / length($a$             ) - coalesce(t.prize_pool, 0),$a$);
      IF v_n <> 2 THEN RAISE EXCEPTION 'OVERLAY_GATES: notify anchor 1 (exposure) found % times, expected 2', v_n; END IF;
      v_out := replace(v_out,
$a$             ) - coalesce(t.prize_pool, 0),$a$,
$b$             ) - (coalesce(t.prize_pool, 0) + coalesce(t.bounty_pool, 0) + coalesce(t.total_rake, 0)),$b$);

      v_prev := v_out;
      v_out := replace(v_out,
$a$    -- counts against this bank, read the same way: guaranteed prizes AND
    -- guaranteed satellite seats, net of the pool already collected.$a$,
$b$    -- counts against this bank, read the same way: guaranteed prizes AND
    -- guaranteed satellite seats, net of the whole player payment already
    -- collected (places + bounties + rake, Dan 2026-11-05).$b$);
      IF v_out = v_prev THEN RAISE EXCEPTION 'OVERLAY_GATES: notify anchor 2 (comment) not found'; END IF;

    ELSIF i = 4 THEN
      v_prev := v_out;
      v_out := replace(v_out,
$a$  v_short := GREATEST(0, v_guarantee - v_pool_before);
  /* 2026-10-06 (20261007000010): A DIAMOND OVERLAY IS PAID FROM THE HOUSE AT$a$,
$b$  v_short := GREATEST(0, v_guarantee - v_pool_before);
  /* A BUY-IN GUARANTEE COUNTS THE WHOLE PLAYER PAYMENT (Dan, 2026-11-05).
     On a chip event the place floor is what the close-out will pay: the
     places collected plus the house share the ledger says is still due,
     where the field's whole payment (places + bounties + rake) is credited
     toward the guarantee. The guaranteed seats of a satellite, which the
     close-out does not cover, keep their full value against the places.
     The Diamond arm below keeps its place-based guarantee. */
  IF NOT EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = NEW.club_id AND c.asset = 'diamonds') THEN
    v_short := GREATEST(0,
      GREATEST(public.fn_ca_guarantee_place_floor(NEW.id, NEW.prize_pool, NEW.guaranteed_prize, NEW.bounty_pool),
               COALESCE(v_seat_guarantee, 0))
      - v_pool_before);
  END IF;
  /* 2026-10-06 (20261007000010): A DIAMOND OVERLAY IS PAID FROM THE HOUSE AT$b$);
      IF v_out = v_prev THEN RAISE EXCEPTION 'OVERLAY_GATES: lock anchor 1 (shortfall) not found'; END IF;

    ELSIF i = 5 THEN
      v_prev := v_out;
      v_out := replace(v_out,
$a$  v_excess numeric;
  v_before numeric;$a$,
$b$  v_excess numeric;
  v_required numeric;
  v_before numeric;$b$);
      IF v_out = v_prev THEN RAISE EXCEPTION 'OVERLAY_GATES: return anchor 1 (declarations) not found'; END IF;

      v_prev := v_out;
      v_out := replace(v_out,
$a$  v_collected := round(v_pool - v_funded, 2);
  v_target := GREATEST(v_guarantee, v_collected);$a$,
$b$  v_collected := round(v_pool - v_funded, 2);
  /* A BUY-IN GUARANTEE COUNTS THE WHOLE PLAYER PAYMENT (Dan, 2026-11-05):
     what the guarantee still requires of the house is the guarantee less
     the field's whole payment as the ledger holds it (places + bounties +
     rake), so the places the pool must keep are the places collected plus
     that requirement. A satellite's guaranteed seats keep their full value
     against the places, as the lock funded them. */
  v_required := GREATEST(0, round(COALESCE(v_t.guaranteed_prize, 0), 2)
                  - COALESCE((public.fn_ca_guarantee_funding(p_tournament_id)->>'gross_coverage')::numeric, 0));
  v_target := GREATEST(round(v_collected + v_required, 2), COALESCE(v_seat_guarantee, 0), v_collected);$b$);
      IF v_out = v_prev THEN RAISE EXCEPTION 'OVERLAY_GATES: return anchor 2 (target) not found'; END IF;

    ELSIF i = 6 THEN
      v_prev := v_out;
      v_out := replace(v_out,
$a$      SELECT t.id,t.name,t.guaranteed_prize gtd,t.buy_in_amount bi,
             coalesce(t.prize_pool,0) pool,$a$,
$b$      SELECT t.id,t.name,t.guaranteed_prize gtd,t.buy_in_amount bi,
             coalesce(t.prize_pool,0) pool,
             -- The whole payment is credited toward the guarantee (Dan,
             -- 2026-11-05): fee per entry, and bounties + rake in the pools.
             coalesce(t.buy_in_fee,0) fee,
             coalesce(t.bounty_pool,0)+coalesce(t.total_rake,0) pool_credit,$b$);
      IF v_out = v_prev THEN RAISE EXCEPTION 'OVERLAY_GATES: audit anchor 1 (eligible) not found'; END IF;

      v_prev := v_out;
      v_out := replace(v_out,
$a$             greatest(gtd-greatest(entries*bi,pool),0) entry_only_gap FROM funded f$a$,
$b$             greatest(gtd-greatest(entries*(bi+fee),pool+pool_credit),0) entry_only_gap FROM funded f$b$);
      IF v_out = v_prev THEN RAISE EXCEPTION 'OVERLAY_GATES: audit anchor 2 (estimate) not found'; END IF;

      v_prev := v_out;
      v_out := replace(v_out,
$a$        ELSE 'This is an estimate from the larger of entries x buy-in and the prize pool, not money proved paid.$a$,
$b$        ELSE 'This is an estimate from the larger of entries x (buy-in + fee) and the whole payment credited (places + bounties + rake), not money proved paid.$b$);
      IF v_out = v_prev THEN RAISE EXCEPTION 'OVERLAY_GATES: audit anchor 3 (recommendation) not found'; END IF;
    END IF;

    v_post := v_post || md5(v_out);
    v_bodies := v_bodies || v_out;
  END LOOP;

  -- ── install, each door against its proven postimage ───────────────────
  DECLARE
    v_before jsonb; v_after jsonb; v_oid oid;
  BEGIN
    FOR i IN 1..6 LOOP
      IF v_post[i] <> v_expect[i] THEN
        RAISE EXCEPTION 'OVERLAY_GATES: derived postimage % for % is not the proven postimage %', v_post[i], v_sigs[i], v_expect[i];
      END IF;
      v_oid := v_sigs[i]::regprocedure;
      SELECT jsonb_build_object('owner', pg_get_userbyid(p.proowner), 'secdef', p.prosecdef, 'config', p.proconfig, 'acl', p.proacl::text)
        INTO v_before FROM pg_proc p WHERE p.oid = v_oid;
      IF v_before->>'owner' <> 'postgres' OR current_user <> 'postgres' THEN
        RAISE EXCEPTION 'OVERLAY_GATES: % owner/actor mismatch', v_sigs[i];
      END IF;
      IF pg_get_functiondef(v_oid) IS DISTINCT FROM v_bodies[i] THEN
        EXECUTE v_bodies[i];
      END IF;
      IF pg_get_functiondef(v_oid) IS DISTINCT FROM v_bodies[i]
         OR md5(pg_get_functiondef(v_oid)) <> v_expect[i] THEN
        RAISE EXCEPTION 'OVERLAY_GATES: % exact postimage readback failed', v_sigs[i];
      END IF;
      SELECT jsonb_build_object('owner', pg_get_userbyid(p.proowner), 'secdef', p.prosecdef, 'config', p.proconfig, 'acl', p.proacl::text)
        INTO v_after FROM pg_proc p WHERE p.oid = v_oid;
      IF v_after IS DISTINCT FROM v_before THEN
        RAISE EXCEPTION 'OVERLAY_GATES: % authority drift after: % -> %', v_sigs[i], v_before, v_after;
      END IF;
    END LOOP;
  END;
END
$component$;

COMMIT;
