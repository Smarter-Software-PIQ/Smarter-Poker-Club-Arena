-- @live-proof: md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_diamond_game_pay_chips(text,uuid,text,uuid,uuid,numeric,text,text,jsonb)'::regprocedure)) = '9294809778c5ea1dbd41e87a8667a2c8'
-- @live-proof: md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_diamond_game_cover_lock(uuid,text)'::regprocedure)) = 'e8c34d2ffbf055e13f22a2ab6573daf2'
-- 20261127004231_a_diamond_spins_payout_locks_the_club_bank_without_blocking_.sql
--
-- WHAT THIS CHANGES, AND WHY (deadlock 40P01, 2026-11-26 02:33:27.913 UTC,
-- 8:33 PM Chicago on 2026-11-25):
--
-- A horse's Midway Free Buy registration and a horse's Diamond Spins payout
-- deadlocked on a member club's clubs row and the Midway union_wallets row.
-- Both edges, read from the live definitions:
--
--   Registration (fn_register_horse_for_tournament_to_target ->
--   fn_register_horse_for_tournament_before_maintenance_gate): its
--   INSERT INTO public.tournament_players names the entrant's club (club_id,
--   stamped by fn_stamp_entry_club), so tournament_players_club_id_fkey takes
--   FOR KEY SHARE on that clubs row (fn_guard_retired_club_mutation also takes
--   FOR KEY SHARE on the event's club). It holds that to COMMIT and later, at
--   fn_ca_midway_free_buy_promo_head line 88, UPDATEs the Midway
--   union_wallets row: there it waited for the spin.
--
--   Diamond Spins (fn_horse_diamond_spins -> fn_wheel_spin_v5 ->
--   fn_diamond_game_pay_chips): fn_diamond_game_cover_lock locks the
--   union_wallets row FOR UPDATE, then, for every union-hosted prize,
--   `SELECT chip_treasury ... FROM public.clubs WHERE id = p_club FOR UPDATE`.
--   FOR UPDATE is the only row lock that conflicts with FOR KEY SHARE, so the
--   spin waited for the registration's foreign-key lock on the club it pays
--   into.
--
-- The wheel prize committed (wheel_midway_chip_funding, Deep Stack Society,
-- transaction start 02:33:26.724 UTC) and the registration was the victim.
--
-- The repo's rule for bank rows (tests/a-tournament-start-does-not-block-
-- foreign-keys.law.test.ts, migration 20260929071925): a lock on public.clubs
-- or public.union_wallets taken to serialise a treasury write is FOR NO KEY
-- UPDATE, never FOR UPDATE. NO KEY UPDATE keeps every exclusion these
-- functions exist for (two payouts from one bank, every treasury write, the
-- check-then-act in fn_diamond_game_fund_promo) and drops only the conflict
-- with foreign-key checks, which nothing here needs: neither function changes
-- or deletes a key. The bank order itself (union_wallets, then clubs, per
-- tests/the-chip-estate-takes-its-locks-in-one-order.law.test.ts) is
-- unchanged. These are the only Diamond games functions that took FOR UPDATE
-- on a bank row (live scan 2026-11-27).
--
-- Anchored edit of the live text: the pre-image is pinned by md5 of prosrc,
-- every anchor must appear exactly once, the rewrite is re-read and its
-- post-image md5, owner, security, settings and grants are asserted before
-- COMMIT, and a second run is a no-op. CREATE OR REPLACE keeps the owner and
-- the grants; no hot table is locked (catalog only).

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '20s';

DO $migration$
DECLARE
  f record;
  v_src text;
  v_def text;
  v_n int;
BEGIN
  FOR f IN SELECT * FROM (VALUES
    ('public.fn_diamond_game_pay_chips(text,uuid,text,uuid,uuid,numeric,text,text,jsonb)',
     '5f28dcec52d99dc520ab3c96588b38bc', '9294809778c5ea1dbd41e87a8667a2c8',
     ARRAY['FROM public.clubs WHERE id = p_club FOR UPDATE;']),
    ('public.fn_diamond_game_cover_lock(uuid,text)',
     '27cc81bfcac08913d31cc4a7c381fd06', 'e8c34d2ffbf055e13f22a2ab6573daf2',
     ARRAY['FROM public.union_wallets w WHERE w.union_id = p_host FOR UPDATE;',
           'FROM public.clubs c WHERE c.id = p_host FOR UPDATE;'])
  ) AS t(fn, pre_md5, post_md5, anchors)
  LOOP
    SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = f.fn::regprocedure;
    IF md5(v_src) = f.post_md5 THEN
      RAISE NOTICE '% already locks its bank FOR NO KEY UPDATE', f.fn;
      CONTINUE;
    END IF;
    IF md5(v_src) <> f.pre_md5 THEN
      RAISE EXCEPTION '% is not the reviewed pre-image (md5 %)', f.fn, md5(v_src);
    END IF;
    v_def := pg_get_functiondef(f.fn::regprocedure);
    FOR i IN 1 .. array_length(f.anchors, 1) LOOP
      v_n := (length(v_def) - length(replace(v_def, f.anchors[i], ''))) / length(f.anchors[i]);
      IF v_n <> 1 THEN
        RAISE EXCEPTION 'anchor % found % times in %, expected 1', f.anchors[i], v_n, f.fn;
      END IF;
      v_def := replace(v_def, f.anchors[i],
                       replace(f.anchors[i], ' FOR UPDATE;', ' FOR NO KEY UPDATE;'));
    END LOOP;
    EXECUTE v_def;
  END LOOP;
END
$migration$;

-- @probe-for: public.fn_diamond_game_pay_chips
DO $probe$
BEGIN
  -- A zero prize from a host that does not exist: reads the absent club bank
  -- and the absent member balance, writes nothing, then unwinds.
  PERFORM public.fn_diamond_game_pay_chips('wheel_prize', gen_random_uuid(), 'club',
    gen_random_uuid(), gen_random_uuid(), 0, NULL, 'migration probe', '{}'::jsonb);
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_diamond_game_cover_lock
DO $probe$
BEGIN
  PERFORM public.fn_diamond_game_cover_lock(gen_random_uuid(), 'club');
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

DO $post$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS fn, md5(p.prosrc) AS m, p.prosrc,
           p.proacl::text AS acl, pg_get_userbyid(p.proowner) AS owner,
           p.prosecdef, p.proconfig,
           CASE p.proname
             WHEN 'fn_diamond_game_pay_chips' THEN '9294809778c5ea1dbd41e87a8667a2c8'
             ELSE 'e8c34d2ffbf055e13f22a2ab6573daf2' END AS want
      FROM pg_proc p
     WHERE p.oid IN ('public.fn_diamond_game_pay_chips(text,uuid,text,uuid,uuid,numeric,text,text,jsonb)'::regprocedure,
                     'public.fn_diamond_game_cover_lock(uuid,text)'::regprocedure)
  LOOP
    IF r.m <> r.want THEN
      RAISE EXCEPTION '% post-image md5 % <> %', r.fn, r.m, r.want;
    END IF;
    IF position('FOR UPDATE' in r.prosrc) > 0 THEN
      RAISE EXCEPTION '% still takes FOR UPDATE', r.fn;
    END IF;
    IF r.acl IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
       OR r.owner <> 'postgres' OR r.prosecdef
       OR r.proconfig IS DISTINCT FROM ARRAY['search_path=public'] THEN
      RAISE EXCEPTION '% changed owner, security, settings or grants (acl %)', r.fn, r.acl;
    END IF;
  END LOOP;
END
$post$;

COMMIT;
