#!/usr/bin/env python3
"""Native PG17 proof for 20261123072039 (incidents 5a481316, ff3327bf, 904018b7).

Proves against a real PostgreSQL 17 cluster using the exact live production
preimage of fn_ca_promo_profit_capture_obligation_earning (md5 cd43cb83...) and
the real fn_ca_promo_profit_capture_residual_head from 20261116200638:
1. Preimage REPRODUCES the exact 5f8a23ea failure: a settled Mystery Bounty
   champion whose winning generation holds $1.00 in head components ($0.50 rebuy
   + $0.50 add-on) fails with original_residual_head_components_missing when
   fn_finalize_bounty_pool settles the $0.50 whole-chip rounding residual.
2. Applying 20261123072039 fixes that case (insert and top-up, human and horse),
   recording ca_promo_profit_obligation_earnings on the champion's winning entry
   generation with both charge ledger IDs and leaving head components unretired.
3. Every negative boundary still routes to fn_ca_promo_profit_capture_residual_head
   and preserves exact head-component verification and refusal on mismatch:
   - PKO tournament (is_mystery_bounty=false): exact match succeeds & retires head;
     mismatch still raises original_residual_head_components_missing
   - Regular bounty tournament (is_mystery_bounty=false): mismatch still refuses
   - Unactivated Mystery Bounty (mystery_bounty_stage='pending'): still routes to
     residual_head and refuses mismatch
   - Activated Mystery Bounty without mystery_settled_at receipt: still refuses
   - Activated Mystery Bounty with receipt for a different winner_user_id: still refuses
   - own_bounty kind on settled Mystery Bounty: still routes to residual_head
   - Non-winner recipient on settled Mystery Bounty: still routes to residual_head
   - Two recorded winners (position=1): still routes to residual_head
   - Placed bounty_residual (place=1): still routes to residual_head
   - Knockout context set (app.bounty_obligation_id <> ''): still routes to residual_head
4. Re-applying 20261123072039 is byte-exact idempotent and @live-proof holds.
No production endpoint or credentials are accepted.
"""
import argparse, hashlib, json, os, re, shutil, subprocess, sys, tempfile, uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PREIMAGE = ROOT / 'tests/fixtures/promo-obligation-earning-matrix/capture-obligation-earning-preimage.sql'
PRIOR_MIGRATION = ROOT / 'supabase/migrations/20261117184500_mystery_champion_residual_earns_from_the_champions_own_entry.sql'
MIGRATION = ROOT / 'supabase/migrations/20261123072039_a_settled_mystery_bounty_pool_residual_earns_from_the_champi.sql'
LIVE_PREIMAGE_MD5 = 'cd43cb83f322becb7b844e4de742b3be'


def uid(label):
    return str(uuid.UUID(hashlib.md5(label.encode()).hexdigest()))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--pg-bin', type=Path, required=True)
    a = ap.parse_args()
    if os.environ.get('DATABASE_URL'):
        raise SystemExit('remote database forbidden')
    pg = a.pg_bin.resolve()
    scratch = Path(tempfile.mkdtemp(prefix='pmbpr-'))
    port = '54443'
    started = False
    results = []

    def q(sql):
        return subprocess.run(
            [str(pg / 'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
             '-h', str(scratch), '-p', port, '-U', 'postgres', '-d', 'postgres'],
            input=sql, text=True, capture_output=True, timeout=60,
        )

    def ok(sql):
        p = q(sql)
        if p.returncode:
            raise RuntimeError(p.stderr + '\n' + sql[:500])
        return p.stdout.strip()

    def check(label, good):
        results.append({'check': label, 'ok': bool(good)})
        print(('PASS ' if good else 'FAIL ') + label, flush=True)
        return good

    def setup_event(tag, *, is_mystery=True, stage='complete', settled_receipt=True,
                    receipt_winner_same=True, two_winners=False, recipient='winner',
                    head_amounts=(0.50, 0.50), is_horse=False):
        t = uid(tag + ':t')
        w = uid(tag + ':w')
        w2 = uid(tag + ':w2')
        o = uid(tag + ':o')
        club = uid('club')
        reg_w = uid(tag + ':rw')
        reg_w2 = uid(tag + ':rw2')
        reg_o = uid(tag + ':ro')
        gen_w = uid(tag + ':gw')
        gen_o = uid(tag + ':go')
        ch1, ch2 = uid(tag + ':ch1'), uid(tag + ':ch2')
        target_user = w if recipient == 'winner' else o
        target_gen = gen_w if recipient == 'winner' else gen_o
        ok(f"""
INSERT INTO tournaments(id, is_mystery_bounty, mystery_bounty_stage)
VALUES ('{t}', {str(is_mystery).lower()}, '{stage}');
INSERT INTO tournament_players(id, tournament_id, user_id, club_id, status, position, is_horse, current_bounty, registered_at)
VALUES ('{reg_w}', '{t}', '{w}', '{club}', 'winner', 1, {str(is_horse).lower()}, {sum(head_amounts)}, clock_timestamp() - interval '10 minutes'),
       ('{reg_o}', '{t}', '{o}', '{club}', 'eliminated', 2, {str(is_horse).lower()}, {sum(head_amounts)}, clock_timestamp() - interval '10 minutes');
INSERT INTO ca_promo_profit_generation_heads(registration_id, generation_id)
VALUES ('{reg_w}', '{gen_w}'), ('{reg_o}', '{gen_o}');
INSERT INTO ca_promo_profit_charge_generations(charge_ledger_id, registration_id, generation_id)
VALUES ('{ch1}', '{reg_w}', '{gen_w}'), ('{ch2}', '{reg_w}', '{gen_w}'), ('{ch1}', '{reg_o}', '{gen_o}');
""")
        if two_winners:
            ok(f"""
INSERT INTO tournament_players(id, tournament_id, user_id, club_id, status, position, is_horse, current_bounty, registered_at)
VALUES ('{reg_w2}', '{t}', '{w2}', '{club}', 'winner', 1, false, 0.50, clock_timestamp() - interval '10 minutes');
""")
        if settled_receipt:
            rw = w if receipt_winner_same else o
            ok(f"""
INSERT INTO tournament_bounty_completion_receipts(tournament_id, winner_user_id, mystery_settled_at)
VALUES ('{t}', '{rw}', clock_timestamp());
""")
        for idx, amt in enumerate(head_amounts):
            cid = uid(f'{tag}:hc:{idx}')
            ch = ch1 if idx == 0 else ch2
            ok(f"""
INSERT INTO ca_promo_profit_head_components(id, operation_ref, tournament_id, user_id, head_generation_id, generation_id, earning_club_id, charge_ledger_ids, amount, source_kind, earned_at)
VALUES ('{cid}', 'bought_head:{tag}:{idx}', '{t}', '{target_user}', '{target_gen}', '{target_gen}', '{club}', ARRAY['{ch}'::uuid], {amt}, 'bought_head', clock_timestamp() - interval '5 minutes');
""")
        return t, target_user, target_gen, [ch1, ch2]

    try:
        env = dict(os.environ, LC_ALL=os.environ.get('LC_ALL', 'C'))
        subprocess.run([pg / 'initdb', '-D', scratch / 'data', '-U', 'postgres', '-A', 'trust'],
                       check=True, capture_output=True, env=env)
        subprocess.run([pg / 'pg_ctl', '-D', scratch / 'data', '-w',
                        '-o', f"-p {port} -k {scratch} -c listen_addresses=''",
                        '-l', scratch / 'server.log', 'start'],
                       check=True, capture_output=True, env=env)
        started = True

        ok("""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE ca_promo_play_through_settings(id boolean PRIMARY KEY, enforced_from timestamptz);
INSERT INTO ca_promo_play_through_settings VALUES(true, clock_timestamp() - interval '1 hour');
CREATE TABLE tournaments(id uuid PRIMARY KEY, is_mystery_bounty boolean NOT NULL DEFAULT false, mystery_bounty_stage text);
CREATE TABLE tournament_bounty_completion_receipts(tournament_id uuid PRIMARY KEY, winner_user_id uuid, mystery_settled_at timestamptz);
CREATE TABLE tournament_players(id uuid PRIMARY KEY, tournament_id uuid, user_id uuid, club_id uuid, status text, position integer, is_horse boolean, current_bounty numeric, registered_at timestamptz);
CREATE TABLE tournament_obligations(id uuid PRIMARY KEY, tournament_id uuid, user_id uuid, kind text, place integer, amount_paid numeric, amount_owed numeric, source text, created_at timestamptz DEFAULT clock_timestamp());
CREATE TABLE tournament_bounty_obligations(id uuid PRIMARY KEY, tournament_id uuid, knocker_user_id uuid, claimants jsonb, hand_id uuid, table_id uuid, created_at timestamptz DEFAULT clock_timestamp());
CREATE TABLE hand_atomic_commits(hand_id uuid PRIMARY KEY, table_id uuid, committed_at timestamptz);
CREATE TABLE ca_promo_profit_tournament_hand_clocks(hand_id uuid PRIMARY KEY, table_id uuid, tournament_id uuid, hand_number bigint, earned_at timestamptz, participant_ids uuid[], participant_scope jsonb);
CREATE TABLE ca_promo_profit_tournament_hand_sources(hand_id uuid, user_id uuid, club_id uuid, generation_id uuid, charge_ledger_ids uuid[]);
CREATE TABLE ca_promo_profit_generation_heads(registration_id uuid PRIMARY KEY, generation_id uuid NOT NULL);
CREATE TABLE ca_promo_profit_charge_generations(charge_ledger_id uuid, registration_id uuid, generation_id uuid);
CREATE TABLE ca_promo_profit_head_components(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), operation_ref text UNIQUE, tournament_id uuid, user_id uuid, head_generation_id uuid, generation_id uuid, earning_club_id uuid, charge_ledger_ids uuid[], amount numeric, source_kind text, source_bounty_obligation_id uuid, earned_at timestamptz);
CREATE TABLE ca_promo_profit_head_retirements(component_id uuid PRIMARY KEY REFERENCES ca_promo_profit_head_components(id), reason text, operation_ref text, recorded_at timestamptz DEFAULT clock_timestamp());
CREATE TABLE ca_promo_profit_obligation_earnings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), obligation_id uuid, tournament_id uuid, user_id uuid, earning_club_id uuid, generation_id uuid, charge_ledger_ids uuid[], amount_from numeric, amount_to numeric, source_kind text, source_bounty_obligation_id uuid, earned_at timestamptz);
CREATE FUNCTION public.fn_ca_promo_profit_apply_generation(p_registration uuid, p_context jsonb DEFAULT NULL) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
  SELECT generation_id FROM public.ca_promo_profit_generation_heads WHERE registration_id = p_registration;
$$;
CREATE FUNCTION public.fn_ca_promo_profit_capture_legacy_head(p_registration uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='public','pg_temp' AS $$ SELECT NULL::void $$;
CREATE FUNCTION public.fn_ca_promo_profit_capture_residual_head(p_obligation uuid, p_tournament uuid, p_user uuid, p_from numeric, p_to numeric) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE r public.tournament_players%ROWTYPE; container uuid; total numeric; h record; cursor_amount numeric := p_from;
BEGIN
 SELECT * INTO STRICT r FROM public.tournament_players WHERE tournament_id=p_tournament AND user_id=p_user;
 PERFORM public.fn_ca_promo_profit_capture_legacy_head(r.id);
 container := public.fn_ca_promo_profit_apply_generation(r.id);
 SELECT COALESCE(sum(x.amount),0) INTO total FROM public.ca_promo_profit_head_components x WHERE x.head_generation_id=container AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_head_retirements z WHERE z.component_id=x.id);
 IF total IS DISTINCT FROM p_to-p_from THEN RAISE EXCEPTION 'original_residual_head_components_missing'; END IF;
 FOR h IN SELECT x.* FROM public.ca_promo_profit_head_components x WHERE x.head_generation_id=container AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_head_retirements z WHERE z.component_id=x.id) ORDER BY x.earned_at, x.id LOOP
  INSERT INTO public.ca_promo_profit_obligation_earnings(obligation_id,tournament_id,user_id,earning_club_id,generation_id,charge_ledger_ids,amount_from,amount_to,source_kind,source_bounty_obligation_id,earned_at)
  VALUES(p_obligation,p_tournament,p_user,h.earning_club_id,h.generation_id,h.charge_ledger_ids,cursor_amount,cursor_amount+h.amount,'bounty_residual',h.source_bounty_obligation_id,h.earned_at);
  INSERT INTO public.ca_promo_profit_head_retirements VALUES(h.id,'residual','residual:'||p_obligation,clock_timestamp());
  cursor_amount := cursor_amount + h.amount;
 END LOOP;
END $$;
""")
        ok(PREIMAGE.read_text())
        ok(PRIOR_MIGRATION.read_text())
        ok("CREATE TRIGGER zzzz_promo_original_obligation_earning AFTER INSERT OR UPDATE OF amount_owed ON tournament_obligations FOR EACH ROW EXECUTE FUNCTION fn_ca_promo_profit_capture_obligation_earning();")

        good = check(
            'preimage matches live production definition md5 cd43cb83...',
            ok("SELECT md5(pg_get_functiondef('public.fn_ca_promo_profit_capture_obligation_earning()'::regprocedure))") == LIVE_PREIMAGE_MD5,
        )

        # 1. Reproduce exact 5f8a23ea failure on preimage.
        t0, w0, _, _ = setup_event('preimage-5f8a23ea', is_mystery=True, stage='complete', settled_receipt=True, head_amounts=(0.50, 0.50))
        ob0 = uid('preimage-5f8a23ea:ob')
        p = q(f"SET app.bounty_obligation_id=''; INSERT INTO tournament_obligations(id,tournament_id,user_id,kind,place,amount_paid,amount_owed,source) VALUES('{ob0}','{t0}','{w0}','bounty_residual',NULL,0,0.50,'fn_finalize_bounty_pool');")
        good &= check('preimage reproduces 5f8a23ea original_residual_head_components_missing', p.returncode != 0 and 'original_residual_head_components_missing' in p.stderr)

        # 2. Apply migration and prove 5f8a23ea shape succeeds (human, horse, insert, top-up).
        ok(MIGRATION.read_text())

        for tag, horse in [('fixed-human', False), ('fixed-horse', True)]:
            t, w, gen, chs = setup_event(tag, is_mystery=True, stage='complete', settled_receipt=True, head_amounts=(0.50, 0.50), is_horse=horse)
            ob = uid(tag + ':ob')
            p = q(f"SET app.bounty_obligation_id=''; INSERT INTO tournament_obligations(id,tournament_id,user_id,kind,place,amount_paid,amount_owed,source) VALUES('{ob}','{t}','{w}','bounty_residual',NULL,0,0.50,'fn_finalize_bounty_pool');")
            if p.returncode != 0:
                print('  ERR:', p.stderr.strip(), flush=True)
            good &= check(f'{tag}: settled mystery bounty_residual 0.50 with 1.00 rebuy+addon head succeeds', p.returncode == 0)
            sorted_chs = sorted(chs)
            got_row = ok(f"SELECT (generation_id = '{gen}'::uuid AND amount_from = 0 AND amount_to = 0.50 AND source_kind = 'bounty_residual' AND charge_ledger_ids = ARRAY['{sorted_chs[0]}'::uuid,'{sorted_chs[1]}'::uuid]) FROM ca_promo_profit_obligation_earnings WHERE obligation_id='{ob}'")
            good &= check(f'{tag}: earning recorded on champion winning generation with both charges', got_row == 't')
            retired = ok(f"SELECT count(*) FROM ca_promo_profit_head_retirements r JOIN ca_promo_profit_head_components c ON c.id=r.component_id WHERE c.tournament_id='{t}'")
            good &= check(f'{tag}: head components not falsely retired', retired == '0')
            # Top-up on the same obligation also succeeds.
            p2 = q(f"SET app.bounty_obligation_id=''; UPDATE tournament_obligations SET amount_owed=0.75 WHERE id='{ob}';")
            good &= check(f'{tag}: top-up on settled mystery bounty_residual succeeds', p2.returncode == 0)
            covered = ok(f"SELECT sum(amount_to - amount_from) FROM ca_promo_profit_obligation_earnings WHERE obligation_id='{ob}'")
            good &= check(f'{tag}: top-up covers full 0.75 range', covered == '0.75')

        # 3. Negative boundaries: EVERY non-settled-mystery case still calls residual_head.
        # 3a. PKO exact match succeeds and retires head components.
        t_pko_ok, w_pko_ok, _, _ = setup_event('pko-match', is_mystery=False, stage='pending', settled_receipt=False, head_amounts=(10.00, 5.00))
        ob_pko_ok = uid('pko-match:ob')
        p = q(f"SET app.bounty_obligation_id=''; INSERT INTO tournament_obligations(id,tournament_id,user_id,kind,place,amount_paid,amount_owed,source) VALUES('{ob_pko_ok}','{t_pko_ok}','{w_pko_ok}','bounty_residual',NULL,0,15.00,'fn_finalize_bounty_pool');")
        good &= check('PKO bounty_residual exact match succeeds through residual_head', p.returncode == 0)
        good &= check('PKO bounty_residual retires both head components', ok(f"SELECT count(*) FROM ca_promo_profit_head_retirements r JOIN ca_promo_profit_head_components c ON c.id=r.component_id WHERE c.tournament_id='{t_pko_ok}' AND r.reason='residual'") == '2')

        # 3b. Mismatch cases that MUST still refuse with original_residual_head_components_missing.
        refuse_cases = [
            ('PKO mismatch still refuses', dict(is_mystery=False, stage='pending', settled_receipt=False), 'bounty_residual', 'NULL', ''),
            ('unactivated pending mystery mismatch still refuses', dict(is_mystery=True, stage='pending', settled_receipt=False), 'bounty_residual', 'NULL', ''),
            ('mystery without settled receipt still refuses', dict(is_mystery=True, stage='complete', settled_receipt=False), 'bounty_residual', 'NULL', ''),
            ('mystery with mismatched receipt winner still refuses', dict(is_mystery=True, stage='complete', settled_receipt=True, receipt_winner_same=False), 'bounty_residual', 'NULL', ''),
            ('own_bounty on settled mystery still refuses mismatch', dict(is_mystery=True, stage='complete', settled_receipt=True), 'own_bounty', 'NULL', ''),
            ('non-winner on settled mystery still refuses mismatch', dict(is_mystery=True, stage='complete', settled_receipt=True, recipient='other'), 'bounty_residual', 'NULL', ''),
            ('two winners on settled mystery still refuses mismatch', dict(is_mystery=True, stage='complete', settled_receipt=True, two_winners=True), 'bounty_residual', 'NULL', ''),
            ('placed bounty_residual on settled mystery still refuses mismatch', dict(is_mystery=True, stage='complete', settled_receipt=True), 'bounty_residual', '1', ''),
            ('knockout-context bounty_residual on settled mystery still refuses mismatch', dict(is_mystery=True, stage='complete', settled_receipt=True), 'bounty_residual', 'NULL', uid('some-bo')),
        ]
        for idx, (label, kwargs, kind, place, bo_ctx) in enumerate(refuse_cases):
            t_r, u_r, _, _ = setup_event(f'refuse-{idx}', head_amounts=(0.50, 0.50), **kwargs)
            ob_r = uid(f'refuse-{idx}:ob')
            p = q(f"SET app.bounty_obligation_id='{bo_ctx}'; INSERT INTO tournament_obligations(id,tournament_id,user_id,kind,place,amount_paid,amount_owed,source) VALUES('{ob_r}','{t_r}','{u_r}','{kind}',{place},0,0.50,'fn_finalize_bounty_pool');")
            good &= check(label, p.returncode != 0 and 'original_residual_head_components_missing' in p.stderr)

        # 4. Idempotency and @live-proof.
        before = ok("SELECT md5(pg_get_functiondef('public.fn_ca_promo_profit_capture_obligation_earning()'::regprocedure))")
        ok(MIGRATION.read_text())
        after = ok("SELECT md5(pg_get_functiondef('public.fn_ca_promo_profit_capture_obligation_earning()'::regprocedure))")
        good &= check('migration is byte-exact idempotent', before == after)

        proof = re.search(r'^-- @live-proof: (.+)$', MIGRATION.read_text(), re.M).group(1)
        good &= check('@live-proof holds', ok(f'SELECT {proof}') == 't')

        print(json.dumps({'status': 'passed' if good else 'failed', 'checks': len(results), 'failed': [r['check'] for r in results if not r['ok']]}))
        if not good:
            sys.exit(1)
    finally:
        if started:
            subprocess.run([pg / 'pg_ctl', '-D', scratch / 'data', '-m', 'immediate', 'stop'], capture_output=True)
        shutil.rmtree(scratch, ignore_errors=True)


if __name__ == '__main__':
    main()
