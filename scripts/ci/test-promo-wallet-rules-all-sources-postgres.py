#!/usr/bin/env python3
"""Isolated PG17 proof: chips sent to a promo wallet from any wallet follow all promo rules."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'supabase/migrations/20261124004000_promo_wallet_sends_follow_promo_chip_rules.sql'
CONTRACT = ROOT / 'scripts/verification-harness/cashier-release-contract.sql'
pg = Path(
    os.environ.get(
        'PG_BIN',
        '/opt/homebrew/opt/postgresql@17/bin'
        if os.uname().sysname == 'Darwin'
        else '/usr/lib/postgresql/17/bin',
    )
)
scratch = Path(os.environ.get('TMPDIR', tempfile.gettempdir())).resolve()
if os.uname().sysname == 'Darwin' and scratch.stat().st_dev == Path('/').stat().st_dev:
    raise RuntimeError('Set TMPDIR to the verified task-owned external SSD directory')
cluster = Path(tempfile.mkdtemp(prefix='pr-', dir=scratch))
socket = cluster / 's'
socket.mkdir()
psql = [
    str(pg / 'psql'),
    '-X',
    '-qAt',
    '-v',
    'ON_ERROR_STOP=1',
    '-h',
    str(socket),
    '-U',
    'postgres',
    '-d',
    'postgres',
]


def run(command, sql=None, check=True):
    res = subprocess.run([str(x) for x in command], input=sql, text=True, capture_output=True, timeout=30)
    if check and res.returncode:
        raise RuntimeError(res.stderr + '\n' + res.stdout)
    return res


def q(sql):
    return run(psql, sql).stdout.strip()


def q_raw(sql):
    return run(psql, sql, check=False)


def uid(n):
    return f'00000000-0000-0000-0000-{n:012d}'


def extract_fn(rel_path, name):
    txt = (ROOT / rel_path).read_text()
    m = re.search(
        r'CREATE OR REPLACE FUNCTION public\.' + name + r'\(.*?\$function\$.*?\$function\$',
        txt,
        re.S,
    )
    assert m, f'Missing {name} in {rel_path}'
    return m.group(0) + ';'


club, owner, agent, down_agent, player, sub_agent = [uid(n) for n in range(1, 7)]
extra_downlines = [uid(n) for n in range(10, 16)]
passed = []


def check(name, cond):
    assert cond, name
    passed.append(name)


def rpc_json(actor, call_sql, prefix='', suffix=''):
    out = q(f"{prefix}SET request.jwt.claim.sub='{actor}'; SELECT {call_sql};{suffix}")
    return json.loads(next(line for line in out.splitlines() if line.startswith('{')))


try:
    assert ' 17.' in run([pg / 'postgres', '--version']).stdout
    shared = Path(run([pg / 'pg_config', '--sharedir']).stdout.strip())
    if not (shared / 'postgres.bki').exists():
        shared = pg.parent / 'share/postgresql'
    run([pg / 'initdb', '-L', shared, '-D', cluster / 'data', '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8'])
    run([pg / 'pg_ctl', '-D', cluster / 'data', '-l', cluster / 'server.log', '-o', f"-h '' -k {socket}", '-w', 'start'])

    # Load minimal isolated schema + real preimages.
    fixture = ROOT / 'scripts/ci/fixtures/chip-wallet-choice'
    q((fixture / 'setup.sql').read_text())
    q((fixture / 'selected-setup.sql').read_text())
    q(f"""
    ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS name text DEFAULT 'Test Club';
    ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS chip_treasury numeric DEFAULT 10000;
    ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
    ALTER TABLE public.club_members ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
    ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
    ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS is_prepaid boolean DEFAULT true;
    ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS credit_limit numeric DEFAULT 0;
    ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS credit_used numeric DEFAULT 0;
    ALTER TABLE public.chip_transactions ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
    ALTER TABLE public.chip_transactions ADD COLUMN IF NOT EXISTS reversible_until timestamptz;
    ALTER TABLE public.chip_transactions ADD COLUMN IF NOT EXISTS related_cashout_id uuid;
    CREATE TABLE IF NOT EXISTS public.unions (id uuid PRIMARY KEY, name text);
    CREATE TABLE IF NOT EXISTS public.profiles (
      id uuid PRIMARY KEY, alias text, username text, display_name text,
      first_name text, last_name text, full_name text
    );
    CREATE TABLE IF NOT EXISTS public.cashout_requests (
      id uuid PRIMARY KEY, status text, created_at timestamptz
    );
    CREATE TABLE IF NOT EXISTS public.settlement_invoices (
      id uuid PRIMARY KEY, club_id uuid, invoice_number text
    );
    CREATE TABLE IF NOT EXISTS public.accounting_cashier_events (
      id uuid PRIMARY KEY, invoice_id uuid, source_transaction_id uuid
    );
    CREATE TABLE IF NOT EXISTS public.chip_ledger (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      club_id uuid,
      from_type text,
      from_entity_id uuid,
      from_label text,
      to_type text,
      to_entity_id uuid,
      to_label text,
      amount numeric,
      category text,
      status text DEFAULT 'posted',
      idempotency_key text,
      created_at timestamptz DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS public.ca_promo_play_through_grants (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      club_id uuid NOT NULL,
      user_id uuid NOT NULL,
      remaining numeric NOT NULL,
      closed_at timestamptz,
      close_reason text,
      close_note text
    );
    CREATE TABLE IF NOT EXISTS public.ca_promo_principal_custody (
      grant_id uuid NOT NULL REFERENCES public.ca_promo_play_through_grants(id),
      kind text NOT NULL,
      entity_id uuid NOT NULL,
      amount numeric NOT NULL,
      PRIMARY KEY (grant_id, kind, entity_id)
    );
    CREATE TABLE IF NOT EXISTS public.sp_digest_settings (
      key text PRIMARY KEY, value numeric, note text
    );
    INSERT INTO public.sp_digest_settings VALUES ('agent_promo_daily_chips', 250, 'fixture')
    ON CONFLICT (key) DO NOTHING;

    CREATE OR REPLACE FUNCTION public.fn_cashier_exact_intent_begin(text, uuid, uuid, jsonb)
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
    BEGIN
      IF auth.uid() IS NULL THEN
        RETURN jsonb_build_object('state', 'return', 'response', jsonb_build_object('success', false, 'error', 'Not Authenticated'));
      END IF;
      RETURN '{{"state":"proceed"}}'::jsonb;
    END $$;
    CREATE OR REPLACE FUNCTION public.player_journal() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.chip_balance <> OLD.chip_balance
         AND coalesce(current_setting('app.ledger_autoskip_club_members', true), '') <> 'on' THEN
        INSERT INTO journal VALUES(
          current_setting('app.ledger_category'),
          current_setting('app.ledger_counterparty'),
          current_setting('app.ledger_counterparty_entity')::uuid,
          'player_wallet',
          NEW.user_id,
          NEW.chip_balance - OLD.chip_balance,
          NEW.club_id,
          current_setting('app.ledger_idempotency_key')
        );
      END IF;
      RETURN NEW;
    END $$;
    CREATE OR REPLACE FUNCTION public.bank_agent_journal() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.agent_wallet_balance <> OLD.agent_wallet_balance
         AND coalesce(current_setting('app.ledger_autoskip_agents', true), '') <> 'on'
         AND current_setting('app.ledger_category', true) IS NOT NULL THEN
        INSERT INTO journal VALUES(
          current_setting('app.ledger_category'),
          current_setting('app.ledger_counterparty'),
          current_setting('app.ledger_counterparty_entity')::uuid,
          'agent_wallet',
          NEW.user_id,
          NEW.agent_wallet_balance - OLD.agent_wallet_balance,
          NEW.club_id,
          current_setting('app.ledger_idempotency_key')
        );
      END IF;
      RETURN NEW;
    END $$;
    CREATE OR REPLACE FUNCTION public.fn_ca_declare_ledger(text, text, uuid, uuid, text, text[])
    RETURNS void LANGUAGE plpgsql AS $$
    DECLARE t text;
    BEGIN
      PERFORM set_config('app.ledger_category', $1, true);
      PERFORM set_config('app.ledger_counterparty', $2, true);
      PERFORM set_config('app.ledger_counterparty_entity', coalesce($3::text, ''), true);
      PERFORM set_config('app.ledger_idempotency_key', coalesce($5, ''), true);
      IF $6 IS NOT NULL THEN
        FOREACH t IN ARRAY $6 LOOP
          PERFORM set_config('app.ledger_autoskip_' || t, 'on', true);
        END LOOP;
      END IF;
    END $$;
    CREATE OR REPLACE FUNCTION public.fn_sp_setting(text, numeric)
    RETURNS numeric LANGUAGE sql STABLE AS $$
      SELECT coalesce((SELECT value FROM public.sp_digest_settings WHERE key=$1), $2)
    $$;
    CREATE OR REPLACE FUNCTION public.fn_arena_name(text, text, text, text, text, text)
    RETURNS text LANGUAGE sql IMMUTABLE AS $$
      SELECT coalesce($1, $2, $3, $4, $5, $6, 'Member')
    $$;
    CREATE OR REPLACE FUNCTION public.fn_ca_promo_move_owned_wallet(uuid, numeric)
    RETURNS void LANGUAGE plpgsql AS $$ BEGIN END $$;
    CREATE OR REPLACE FUNCTION public.fn_ca_promo_play_through_settle(uuid, uuid)
    RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
    CREATE OR REPLACE FUNCTION public.fn_ca_promo_locked_at(uuid, uuid, text, uuid)
    RETURNS numeric LANGUAGE sql STABLE AS $$
      SELECT coalesce(sum(c.amount), 0)
        FROM public.ca_promo_principal_custody c
        JOIN public.ca_promo_play_through_grants g ON g.id = c.grant_id
       WHERE g.club_id = $1 AND g.user_id = $2 AND g.closed_at IS NULL
         AND c.kind = $3 AND c.entity_id = $4 AND c.amount > 0
    $$;
    CREATE OR REPLACE FUNCTION public.fn_ca_promo_play_through_summary(uuid, uuid)
    RETURNS jsonb LANGUAGE sql STABLE AS $$
      SELECT jsonb_build_object('fee_remaining', 200)
    $$;
    CREATE OR REPLACE FUNCTION public.fn_ca_promo_move_custody(uuid, uuid, text, uuid, text, uuid, numeric, text)
    RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
    DECLARE g record; left_amt numeric := $7; take numeric;
    BEGIN
      FOR g IN
        SELECT c.grant_id, c.amount
          FROM public.ca_promo_principal_custody c
          JOIN public.ca_promo_play_through_grants gr ON gr.id = c.grant_id
         WHERE gr.club_id = $1 AND gr.user_id = $2 AND gr.closed_at IS NULL
           AND c.kind = $3 AND c.entity_id = $4 AND c.amount > 0
      LOOP
        EXIT WHEN left_amt <= 0;
        take := least(g.amount, left_amt);
        UPDATE public.ca_promo_principal_custody SET amount = amount - take
         WHERE grant_id = g.grant_id AND kind = $3 AND entity_id = $4;
        UPDATE public.ca_promo_play_through_grants
           SET remaining = remaining - take,
               closed_at = CASE WHEN remaining - take <= 0 THEN clock_timestamp() ELSE closed_at END,
               close_reason = CASE WHEN remaining - take <= 0 THEN $8 ELSE close_reason END
         WHERE id = g.grant_id;
        left_amt := left_amt - take;
      END LOOP;
      RETURN $7 - left_amt;
    END $$;

    -- Record declared counterparty label on agent balance debit (mirrors production trigger).
    CREATE TABLE IF NOT EXISTS public.reversal_ledger_log (
      id serial PRIMARY KEY,
      from_type text,
      to_type text,
      to_entity uuid,
      to_label text,
      amount numeric,
      category text,
      idem text
    );
    CREATE OR REPLACE FUNCTION public.fn_test_log_agent_promo_debit() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.promo_wallet_balance < OLD.promo_wallet_balance
         AND coalesce(current_setting('app.ledger_autoskip_agents', true), '') <> 'on' THEN
        INSERT INTO public.reversal_ledger_log(from_type, to_type, to_entity, to_label, amount, category, idem)
        VALUES (
          'promo_wallet',
          current_setting('app.ledger_counterparty', true),
          NULLIF(current_setting('app.ledger_counterparty_entity', true), '')::uuid,
          current_setting('app.ledger_counterparty_label', true),
          OLD.promo_wallet_balance - NEW.promo_wallet_balance,
          current_setting('app.ledger_category', true),
          current_setting('app.ledger_idempotency_key', true)
        );
      END IF;
      RETURN NEW;
    END $$;
    DROP TRIGGER IF EXISTS trg_test_log_agent_promo_debit ON public.agents;
    CREATE TRIGGER trg_test_log_agent_promo_debit
      AFTER UPDATE ON public.agents FOR EACH ROW
      EXECUTE FUNCTION public.fn_test_log_agent_promo_debit();

    CREATE OR REPLACE FUNCTION public.fn_cashier_history_book(uuid, uuid, text, uuid)
    RETURNS TABLE(book text, people uuid[], subject uuid) LANGUAGE sql STABLE AS $$
      SELECT 'people'::text, ARRAY[$4]::uuid[], $4
    $$;
    """)

    # Seed club, members, agents, balances, and hierarchy.
    q(f"""
    BEGIN;
    SET LOCAL app.ledger_autoskip_clubs = 'on';
    SET LOCAL app.ledger_autoskip_club_members = 'on';
    SET LOCAL app.ledger_autoskip_agents = 'on';
    UPDATE public.clubs SET chip_treasury = 10000, promo_balance = 500 WHERE id = '{club}';
    UPDATE public.club_members SET chip_balance = 5000 WHERE club_id = '{club}';
    UPDATE public.agents SET agent_wallet_balance = 5000, promo_wallet_balance = 5000 WHERE club_id = '{club}';
    INSERT INTO public.club_members(club_id, user_id, role, status, chip_balance, agent_id)
    VALUES ('{club}', '{sub_agent}', 'sub_agent', 'active', 5000, '{agent}')
    ON CONFLICT DO NOTHING;
    INSERT INTO public.agents(club_id, user_id, agent_wallet_balance, promo_wallet_balance)
    VALUES ('{club}', '{sub_agent}', 5000, 5000)
    ON CONFLICT DO NOTHING;
    COMMIT;
    """)
    for d_id in extra_downlines:
        q(f"""
        INSERT INTO public.club_members(club_id, user_id, role, status, chip_balance, agent_id)
        VALUES ('{club}', '{d_id}', 'sub_agent', 'active', 100, '{agent}')
        ON CONFLICT DO NOTHING;
        INSERT INTO public.agents(club_id, user_id, agent_wallet_balance, promo_wallet_balance)
        VALUES ('{club}', '{d_id}', 100, 0)
        ON CONFLICT DO NOTHING;
        """)
    # Allow both agent and sub_agent to transact with down_agent and extra_downlines.
    all_targets = "','".join([down_agent, player, sub_agent, *extra_downlines])
    q(f"""
    CREATE OR REPLACE FUNCTION public.fn_club_cashier_can_transact(uuid, uuid, uuid)
    RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT $1 = '{club}'::uuid
         AND $2 IN ('{owner}'::uuid, '{agent}'::uuid, '{sub_agent}'::uuid)
         AND $3 IN ('{all_targets}'::uuid)
    $$;
    """)

    # Install exact live preimages for all 7 patched functions.
    wh = json.loads((ROOT / 'scripts/ci/fixtures/world-hub-cashier-migrations-20261114.json').read_text())
    wh_daily = next(x for x in wh if x['version'] == '20261114174204')
    wh_names = next(x for x in wh if x['version'] == '20261114174518')

    # fn_ca_transaction_party_name (for history feed)
    m_party = re.search(
        r'CREATE OR REPLACE FUNCTION public\.fn_ca_transaction_party_name\(.*?\$function\$.*?\$function\$',
        wh_names['sql'],
        re.S,
    )
    assert m_party
    q(m_party.group(0) + ';')

    # fn_ca_agent_promo_daily_allowance preimage
    m_daily = re.search(
        r'CREATE OR REPLACE FUNCTION public\.fn_ca_agent_promo_daily_allowance\(.*?\$function\$.*?\$function\$',
        wh_daily['sql'],
        re.S,
    )
    assert m_daily
    q(m_daily.group(0) + ';')

    # 1. fn_club_bank_reverse_core_20261004
    q(extract_fn('supabase/migrations/20261020210238_restrict_agent_banks_and_authorize_downline_reassignment.sql', 'fn_club_bank_reverse_core_20261004'))
    q("REVOKE ALL ON FUNCTION public.fn_club_bank_reverse_core_20261004(uuid,text,uuid) FROM PUBLIC, anon, authenticated, service_role;")

    # 2. fn_cashier_player_wallet_send
    q(extract_fn('supabase/migrations/20261016024912_cashier_sends_use_the_selected_source_and_destination_wallet.sql', 'fn_cashier_player_wallet_send'))
    q("REVOKE ALL ON FUNCTION public.fn_cashier_player_wallet_send(uuid,uuid,numeric,text,text,uuid) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.fn_cashier_player_wallet_send(uuid,uuid,numeric,text,text,uuid) TO authenticated, service_role;")

    # 3. fn_agent_wallet_send_core_20260830 + 20261116154841
    q(extract_fn('supabase/migrations/20261030051934_credit_line_tracks_funded_agent_chips_and_weekly_wallet_topu.sql', 'fn_agent_wallet_send_core_20260830'))
    q(r"""
    DO $$ DECLARE def text; needle text; addition text; BEGIN
      SELECT pg_get_functiondef('public.fn_agent_wallet_send_core_20260830(uuid,uuid,numeric,text,text,uuid)'::regprocedure) INTO def;
      needle := E'  v_until := now() + interval ''10 minutes'';';
      addition := E'  IF p_to_user_id=v_actor AND v_dest=''player_wallet'' THEN\n    DECLARE promo_leg uuid; BEGIN\n      SELECT id INTO STRICT promo_leg FROM public.chip_ledger\n       WHERE club_id=p_club_id AND idempotency_key=''agent_send:''||v_op_id::text\n        AND from_type=''agent_wallet'' AND from_entity_id=v_actor\n        AND to_type=''player_wallet'' AND to_entity_id=v_actor AND amount=p_amount;\n      PERFORM public.fn_ca_promo_move_owned_wallet(promo_leg,v_float_before);\n    END;\n  END IF;\n';
      EXECUTE replace(def, needle, addition || needle);
    END $$;
    """)
    q("REVOKE ALL ON FUNCTION public.fn_agent_wallet_send_core_20260830(uuid,uuid,numeric,text,text,uuid) FROM PUBLIC, anon, authenticated, service_role;")

    # 4. fn_promo_wallet_send_core_20261004 + 20261112050118 + WH 20261114174204
    q(extract_fn('supabase/migrations/20261016024912_cashier_sends_use_the_selected_source_and_destination_wallet.sql', 'fn_promo_wallet_send_core_20261004'))
    q((ROOT / 'supabase/migrations/20261112050118_agent_promo_sends_are_capped_at_fifty_chips_per_downline_in_.sql').read_text())
    anchor = re.search(r'anchor := \$a\$(.*?)\$a\$;', wh_daily['sql'], re.S).group(1)
    added = re.search(r'updated := replace\(original, anchor, \$n\$(.*?)\$n\$\);', wh_daily['sql'], re.S).group(1)
    cur = q("SELECT pg_get_functiondef('public.fn_promo_wallet_send_core_20261004(uuid,uuid,numeric,text,text,uuid)'::regprocedure);")
    q(cur.replace(anchor, added))
    q("REVOKE ALL ON FUNCTION public.fn_promo_wallet_send_core_20261004(uuid,uuid,numeric,text,text,uuid) FROM PUBLIC, anon, authenticated, service_role;")

    # 5. fn_cashier_promo_allowance + WH 20261114174204
    q(extract_fn('supabase/migrations/20261112204754_promo_tickets_batch_allowance_receipts_and_redeem_names_its_.sql', 'fn_cashier_promo_allowance'))
    cur = q("SELECT pg_get_functiondef('public.fn_cashier_promo_allowance(uuid,uuid[])'::regprocedure);")
    cur = cur.replace(
        "'remaining_chips', greatest(0::numeric, 50::numeric - s.sent))), '[]'::jsonb)",
        "'remaining_chips', least(greatest(0::numeric, 50::numeric - s.sent),\n             (public.fn_ca_agent_promo_daily_allowance(p_club_id, v_me, v_now) ->> 'remaining_chips')::numeric))), '[]'::jsonb)",
    ).replace(
        "'limit_chips', 50, 'window_hours', 168, 'allowances', v_rows);",
        "'limit_chips', 50, 'window_hours', 168, 'allowances', v_rows,\n    'agent_daily', public.fn_ca_agent_promo_daily_allowance(p_club_id, v_me, v_now));",
    )
    q(cur)
    q("REVOKE ALL ON FUNCTION public.fn_cashier_promo_allowance(uuid,uuid[]) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.fn_cashier_promo_allowance(uuid,uuid[]) TO authenticated, service_role;")

    # 6. fn_cashier_history_feed + all live patches through 20261115062830
    q(extract_fn('supabase/migrations/20261027160320_cashier_claim_destination_and_movement_history.sql', 'fn_cashier_history_feed'))
    from_old = re.search(r'from_old text := \$o\$(.*?)\$o\$;', wh_names['sql'], re.S).group(1)
    from_new = re.search(r'from_new text := \$n\$(.*?)\$n\$;', wh_names['sql'], re.S).group(1)
    to_old = re.search(r'to_old text := \$o\$(.*?)\$o\$;', wh_names['sql'], re.S).group(1)
    to_new = re.search(r'to_new text := \$n\$(.*?)\$n\$;', wh_names['sql'], re.S).group(1)
    cur = q("SELECT pg_get_functiondef('public.fn_cashier_history_feed(uuid,text,text,timestamptz,timestamptz,uuid,text,timestamptz,uuid,integer)'::regprocedure);")
    q(cur.replace(from_old, from_new).replace(to_old, to_new))
    for mig in [
        'supabase/migrations/20261114171135_cashier_history_club_book_reads_by_index_per_type_group.sql',
        'supabase/migrations/20261115001816_member_history_promo_allowance_as_of_send.sql',
        'supabase/migrations/20261115011401_member_history_player_and_funding_filters.sql',
        'supabase/migrations/20261115020001_member_history_classifies_cashier_tickets_and_union_promo_fu.sql',
        'supabase/migrations/20261115062830_filter_club_transaction_history_by_funding_wallet.sql',
    ]:
        q((ROOT / mig).read_text())
    q("REVOKE ALL ON FUNCTION public.fn_cashier_history_feed(uuid,text,text,timestamptz,timestamptz,uuid,text,timestamptz,uuid,integer) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.fn_cashier_history_feed(uuid,text,text,timestamptz,timestamptz,uuid,text,timestamptz,uuid,integer) TO authenticated, service_role;")

    # 7. fn_ca_promo_play_through_on_exit + exit triggers
    txt_exit = (ROOT / 'supabase/migrations/20261116153059_promo_principal_follows_its_original_grant_through_wallet_an.sql').read_text()
    m_exit = re.search(r'CREATE OR REPLACE FUNCTION public\.fn_ca_promo_play_through_on_exit\(\).*?END \$\$;', txt_exit, re.S)
    assert m_exit
    q(m_exit.group(0))
    q("""
    CREATE CONSTRAINT TRIGGER zz_ca_player_promo_exit AFTER INSERT ON public.chip_ledger
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
      WHEN (NEW.from_type = 'player_wallet' AND NEW.amount > 0 AND NEW.club_id IS NOT NULL
        AND coalesce(NEW.status, 'posted') = 'posted'
        AND NEW.to_type IN ('player_wallet','agent_wallet','club_treasury','promo_wallet','union_wallet','escrow','credit_facility'))
      EXECUTE FUNCTION public.fn_ca_promo_play_through_on_exit();
    CREATE CONSTRAINT TRIGGER zz_ca_agent_promo_exit AFTER INSERT ON public.chip_ledger
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
      WHEN (NEW.from_type = 'agent_wallet' AND NEW.amount > 0 AND NEW.club_id IS NOT NULL
        AND coalesce(NEW.status, 'posted') = 'posted'
        AND NEW.to_type IN ('player_wallet','agent_wallet','club_treasury','promo_wallet','union_wallet','escrow','credit_facility'))
      EXECUTE FUNCTION public.fn_ca_promo_play_through_on_exit();
    """)

    # Apply the new migration verbatim (including all @probe-for blocks).
    mig_sql = MIGRATION.read_text()
    q(mig_sql)
    check('migration installs cleanly on exact live preimages with all probes', True)

    # Verify @live-proof passes.
    for expr in re.findall(r'^-- @live-proof: (.+)$', mig_sql, re.M):
        check('live-proof passes', q(f'SELECT {expr};') == 't')

    # Verify release contract pins match exact post-image hashes and file md5.
    contract_sql = CONTRACT.read_text()
    h_rev = q("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_club_bank_reverse_core_20261004(uuid,text,uuid)'::regprocedure;")
    h_promo = q("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.fn_promo_wallet_send_core_20261004(uuid,uuid,numeric,text,text,uuid)'::regprocedure;")
    h_feed = q("SELECT md5(pg_get_functiondef('public.fn_cashier_history_feed(uuid,text,text,timestamptz,timestamptz,uuid,text,timestamptz,uuid,integer)'::regprocedure));")
    file_md5 = hashlib.md5(MIGRATION.read_bytes()).hexdigest()
    check('contract pins migration md5 and all 3 successor hashes',
          f"md5(statements[1]) = '{file_md5}'" in contract_sql
          and f"'promo_successor_hash', '{h_rev}'" in contract_sql
          and f"'promo_successor_hash', '{h_promo}'" in contract_sql
          and f"'promo_successor_hash', '{h_feed}'" in contract_sql)

    # ── TEST 1: Club Bank -> Promo Wallet reversal returns to clubs.promo_balance ──
    tx_promo = str(uuid.uuid4())
    tx_agent = str(uuid.uuid4())
    q(f"""
    INSERT INTO public.chip_transactions(id, club_id, from_user_id, to_user_id, amount, transaction_type, metadata, reversible_until)
    VALUES
      ('{tx_promo}', '{club}', '{owner}', '{agent}', 100, 'club_bank_send', '{{"destination":"promo_wallet"}}'::jsonb, now() + interval '7 days'),
      ('{tx_agent}', '{club}', '{owner}', '{agent}', 75,  'club_bank_send', '{{"destination":"agent_wallet"}}'::jsonb, now() + interval '7 days');
    """)
    treasury_before, promo_before = map(float, q(f"SELECT chip_treasury, promo_balance FROM public.clubs WHERE id='{club}';").split('|'))
    rev_op = str(uuid.uuid4())
    rev_res = rpc_json(owner, f"public.fn_club_bank_reverse_core_20261004('{tx_promo}', 'Mistake', '{rev_op}')")
    treasury_after, promo_after = map(float, q(f"SELECT chip_treasury, promo_balance FROM public.clubs WHERE id='{club}';").split('|'))
    check('reversing club_bank_send to promo_wallet credits clubs.promo_balance only',
          rev_res['success'] is True
          and rev_res['return_destination'] == 'club_promo_wallet'
          and treasury_after == treasury_before
          and promo_after == promo_before + 100)
    rev_leg = q(f"SELECT to_type||'|'||to_label||'|'||category||'|'||amount FROM public.reversal_ledger_log WHERE idem='club_bank_reversal:{rev_op}';")
    check('promo reversal ledger leg declares promo_wallet / clubs.promo_balance',
          rev_leg == 'promo_wallet|clubs.promo_balance|reversal|100')
    rev_replay = rpc_json(owner, f"public.fn_club_bank_reverse_core_20261004('{tx_promo}', 'Mistake', '{rev_op}')")
    check('promo reversal replay keeps return_destination=club_promo_wallet without double credit',
          rev_replay['success'] is True
          and rev_replay['replayed'] is True
          and rev_replay['return_destination'] == 'club_promo_wallet'
          and float(q(f"SELECT promo_balance FROM public.clubs WHERE id='{club}';")) == promo_after)
    rev_ag = rpc_json(owner, f"public.fn_club_bank_reverse_core_20261004('{tx_agent}', 'Mistake', '{uuid.uuid4()}')")
    check('reversing club_bank_send to agent_wallet still returns to club_bank',
          rev_ag['success'] is True
          and rev_ag['return_destination'] == 'club_bank'
          and float(q(f"SELECT chip_treasury FROM public.clubs WHERE id='{club}';")) == treasury_before + 75)

    # ── TEST 2: Unified 50/7d downline cap across agent_wallet, player_wallet, promo_wallet ──
    r1 = rpc_json(agent, f"public.fn_agent_wallet_send_core_20260830('{club}','{down_agent}',30,'promo_wallet','Boost','{uuid.uuid4()}')")
    check('agent_wallet -> downline promo_wallet 30 succeeds', r1['success'] is True)
    r2 = rpc_json(agent, f"public.fn_promo_wallet_send_core_20261004('{club}','{down_agent}',20.01,'player_wallet',NULL,'{uuid.uuid4()}')")
    check('promo_wallet_send sees prior agent_wallet -> promo_wallet 30',
          r2['success'] is False and r2['error_code'] == 'promo_downline_seven_day_limit' and r2['remaining_chips'] == 20)
    r3 = rpc_json(sub_agent, f"public.fn_agent_wallet_send_core_20260830('{club}','{down_agent}',20.01,'promo_wallet',NULL,'{uuid.uuid4()}')")
    check('second upline agent_wallet -> promo_wallet shares 50/7d cap',
          r3['success'] is False and r3['error_code'] == 'promo_downline_seven_day_limit' and r3['remaining_chips'] == 20)
    r4 = rpc_json(agent, f"public.fn_cashier_player_wallet_send('{club}','{down_agent}',20,'promo_wallet','Top up','{uuid.uuid4()}')")
    check('player_wallet -> downline promo_wallet exact remaining 20 succeeds', r4['success'] is True)
    r5 = rpc_json(agent, f"public.fn_cashier_player_wallet_send('{club}','{down_agent}',0.01,'promo_wallet','Over','{uuid.uuid4()}')")
    check('player_wallet -> downline promo_wallet refuses 0.01 over 50',
          r5['success'] is False and r5['error_code'] == 'promo_downline_seven_day_limit' and r5['remaining_chips'] == 0)
    allow = rpc_json(agent, f"public.fn_cashier_promo_allowance('{club}', ARRAY['{down_agent}']::uuid[])")
    check('fn_cashier_promo_allowance reports 50 sent / 0 remaining across all sources',
          allow['success'] is True
          and allow['allowances'][0]['sent_last_7_days'] == 50
          and allow['allowances'][0]['remaining_chips'] == 0
          and allow['agent_daily']['sent_last_24_hours'] == 50)
    # Non-promo send from agent_wallet / player_wallet remains unaffected.
    r_nonpromo_ag = rpc_json(agent, f"public.fn_agent_wallet_send_core_20260830('{club}','{down_agent}',100,'agent_wallet',NULL,'{uuid.uuid4()}')")
    r_nonpromo_pw = rpc_json(agent, f"public.fn_cashier_player_wallet_send('{club}','{down_agent}',100,'player_wallet',NULL,'{uuid.uuid4()}')")
    check('non-promo sends remain uncapped by promo limit', r_nonpromo_ag['success'] is True and r_nonpromo_pw['success'] is True)
    # Self move player_wallet -> self promo_wallet does not consume downline cap.
    r_self = rpc_json(agent, f"public.fn_cashier_player_wallet_send('{club}','{agent}',75,'promo_wallet','Self fund','{uuid.uuid4()}')")
    check('self player_wallet -> promo_wallet succeeds and does not hit 50/7d', r_self['success'] is True)
    # Stale transaction snapshots refused for promo_wallet destinations.
    for iso in ('REPEATABLE READ', 'SERIALIZABLE'):
        snap_ag = rpc_json(agent, f"public.fn_agent_wallet_send_core_20260830('{club}','{extra_downlines[0]}',1,'promo_wallet',NULL,'{uuid.uuid4()}')", prefix=f'BEGIN ISOLATION LEVEL {iso};', suffix='ROLLBACK;')
        snap_pw = rpc_json(agent, f"public.fn_cashier_player_wallet_send('{club}','{extra_downlines[0]}',1,'promo_wallet',NULL,'{uuid.uuid4()}')", prefix=f'BEGIN ISOLATION LEVEL {iso};', suffix='ROLLBACK;')
        check(f'stale snapshot {iso} refused on agent_wallet and player_wallet -> promo_wallet',
              snap_ag['error_code'] == 'promo_limit_snapshot' and snap_pw['error_code'] == 'promo_limit_snapshot')

    # Verify fn_cashier_history_feed computes promo_used_after_send for agent_wallet_send & peer_transfer to promo_wallet.
    feed_rows = q(f"""
    SET request.jwt.claim.sub='{agent}';
    SELECT transaction_type||':'||coalesce(metadata->>'promo_used_after_send','none')
      FROM public.fn_cashier_history_feed('{club}','downline','all',NULL,NULL,'{down_agent}',NULL,NULL,NULL,20)
     WHERE metadata->>'destination'='promo_wallet'
     ORDER BY created_at ASC, id ASC;
    """).splitlines()
    check('fn_cashier_history_feed tracks promo_used_after_send across agent_wallet_send and peer_transfer',
          feed_rows == ['agent_wallet_send:30', 'peer_transfer:50'])

    # ── TEST 3: Unified 250-chip / 24-hour per-agent daily cap across all 3 doors ──
    # Agent already sent 50 to down_agent; send 50 each to 4 more downlines across mixed sources -> 250 total.
    check('daily mix #2 agent_wallet -> promo_wallet 50', rpc_json(agent, f"public.fn_agent_wallet_send_core_20260830('{club}','{extra_downlines[0]}',50,'promo_wallet',NULL,'{uuid.uuid4()}')")['success'] is True)
    check('daily mix #3 player_wallet -> promo_wallet 50', rpc_json(agent, f"public.fn_cashier_player_wallet_send('{club}','{extra_downlines[1]}',50,'promo_wallet',NULL,'{uuid.uuid4()}')")['success'] is True)
    check('daily mix #4 promo_wallet -> player_wallet 50', rpc_json(agent, f"public.fn_promo_wallet_send_core_20261004('{club}','{extra_downlines[2]}',50,'player_wallet',NULL,'{uuid.uuid4()}')")['success'] is True)
    check('daily mix #5 agent_wallet -> promo_wallet 50', rpc_json(agent, f"public.fn_agent_wallet_send_core_20260830('{club}','{extra_downlines[3]}',50,'promo_wallet',NULL,'{uuid.uuid4()}')")['success'] is True)
    # 6th downline: ALL 3 doors must refuse with promo_agent_daily_limit!
    d_ag = rpc_json(agent, f"public.fn_agent_wallet_send_core_20260830('{club}','{extra_downlines[4]}',1,'promo_wallet',NULL,'{uuid.uuid4()}')")
    d_pw = rpc_json(agent, f"public.fn_cashier_player_wallet_send('{club}','{extra_downlines[4]}',1,'promo_wallet',NULL,'{uuid.uuid4()}')")
    d_pr = rpc_json(agent, f"public.fn_promo_wallet_send_core_20261004('{club}','{extra_downlines[4]}',1,'player_wallet',NULL,'{uuid.uuid4()}')")
    check('250/24h daily cap blocks all three doors once combined total hits 250',
          d_ag['error_code'] == 'promo_agent_daily_limit' and d_ag['remaining_chips'] == 0
          and d_pw['error_code'] == 'promo_agent_daily_limit' and d_pw['remaining_chips'] == 0
          and d_pr['error_code'] == 'promo_agent_daily_limit' and d_pr['remaining_chips'] == 0)
    # Club owner sending to promo_wallet remains uncapped and doesn't pollute agent limits.
    o_ag = rpc_json(owner, f"public.fn_agent_wallet_send_core_20260830('{club}','{extra_downlines[5]}',120,'promo_wallet',NULL,'{uuid.uuid4()}')")
    check('owner agent_wallet -> promo_wallet remains uncapped', o_ag['success'] is True)
    check('owner send does not count against agent 50/7d allowance',
          rpc_json(sub_agent, f"public.fn_agent_wallet_send_core_20260830('{club}','{extra_downlines[5]}',50,'promo_wallet',NULL,'{uuid.uuid4()}')")['success'] is True)

    # ── TEST 4: Promo play-through lock integrity at exits to promo_wallet ──
    g_player = str(uuid.uuid4())
    g_agent = str(uuid.uuid4())
    q(f"""
    BEGIN;
    SET LOCAL app.ledger_autoskip_club_members = 'on';
    SET LOCAL app.ledger_autoskip_agents = 'on';
    UPDATE public.club_members SET chip_balance = 50 WHERE club_id = '{club}' AND user_id = '{player}';
    UPDATE public.agents SET agent_wallet_balance = 50 WHERE club_id = '{club}' AND user_id = '{down_agent}';
    INSERT INTO public.ca_promo_play_through_grants(id, club_id, user_id, remaining)
    VALUES ('{g_player}', '{club}', '{player}', 50), ('{g_agent}', '{club}', '{down_agent}', 50);
    INSERT INTO public.ca_promo_principal_custody(grant_id, kind, entity_id, amount)
    VALUES ('{g_player}', 'player_wallet', '{player}', 50), ('{g_agent}', 'agent_wallet', '{down_agent}', 50);
    COMMIT;
    """)

    # Attempt 1: player_wallet -> promo_wallet via transfer (must fail!)
    res_t1 = q_raw(f"""
    BEGIN;
    SET LOCAL app.ledger_autoskip_club_members = 'on';
    UPDATE public.club_members SET chip_balance = 0 WHERE club_id = '{club}' AND user_id = '{player}';
    INSERT INTO public.chip_ledger(club_id, from_type, from_entity_id, to_type, to_entity_id, amount, category)
    VALUES ('{club}', 'player_wallet', '{player}', 'promo_wallet', '{agent}', 50, 'transfer');
    COMMIT;
    """)
    check('locked player_wallet cannot transfer to promo_wallet', res_t1.returncode != 0 and 'Promo Play Through' in res_t1.stderr)

    # Attempt 2: player_wallet -> agent promo_wallet via agent_claim (must fail!)
    res_t2 = q_raw(f"""
    BEGIN;
    SET LOCAL app.ledger_autoskip_club_members = 'on';
    UPDATE public.club_members SET chip_balance = 0 WHERE club_id = '{club}' AND user_id = '{player}';
    INSERT INTO public.chip_ledger(club_id, from_type, from_entity_id, to_type, to_entity_id, amount, category)
    VALUES ('{club}', 'player_wallet', '{player}', 'promo_wallet', '{agent}', 50, 'agent_claim');
    COMMIT;
    """)
    check('locked player_wallet cannot exit via agent_claim to promo_wallet', res_t2.returncode != 0 and 'Promo Play Through' in res_t2.stderr)

    # Attempt 3: player_wallet -> agent promo_wallet via club_bank_claim with to_entity_id <> club_id (agent self/downline claim via fn_club_wallet_claim_back) (must fail!)
    res_t3 = q_raw(f"""
    BEGIN;
    SET LOCAL app.ledger_autoskip_club_members = 'on';
    UPDATE public.club_members SET chip_balance = 0 WHERE club_id = '{club}' AND user_id = '{player}';
    INSERT INTO public.chip_ledger(club_id, from_type, from_entity_id, to_type, to_entity_id, amount, category)
    VALUES ('{club}', 'player_wallet', '{player}', 'promo_wallet', '{agent}', 50, 'club_bank_claim');
    COMMIT;
    """)
    check('locked player_wallet cannot exit via club_bank_claim to non-club promo_wallet', res_t3.returncode != 0 and 'Promo Play Through' in res_t3.stderr)

    # Attempt 4: agent_wallet -> promo_wallet via agent_send (must fail!)
    res_t4 = q_raw(f"""
    BEGIN;
    SET LOCAL app.ledger_autoskip_agents = 'on';
    UPDATE public.agents SET agent_wallet_balance = 0 WHERE club_id = '{club}' AND user_id = '{down_agent}';
    INSERT INTO public.chip_ledger(club_id, from_type, from_entity_id, to_type, to_entity_id, amount, category)
    VALUES ('{club}', 'agent_wallet', '{down_agent}', 'promo_wallet', '{agent}', 50, 'agent_send');
    COMMIT;
    """)
    check('locked agent_wallet cannot agent_send to promo_wallet', res_t4.returncode != 0 and 'Promo Play Through' in res_t4.stderr)

    # Attempt 5: legitimate club_bank_claim into Club Promo Wallet (to_entity_id = club_id) SUCCEEDS!
    q(f"""
    BEGIN;
    SET LOCAL app.ledger_autoskip_club_members = 'on';
    UPDATE public.club_members SET chip_balance = 0 WHERE club_id = '{club}' AND user_id = '{player}';
    INSERT INTO public.chip_ledger(club_id, from_type, from_entity_id, to_type, to_entity_id, amount, category)
    VALUES ('{club}', 'player_wallet', '{player}', 'promo_wallet', '{club}', 50, 'club_bank_claim');
    COMMIT;
    """)
    check('club staff club_bank_claim to club promo wallet closes grant as returned',
          q(f"SELECT close_reason||':'||remaining FROM public.ca_promo_play_through_grants WHERE id='{g_player}';") == 'returned:0')

    # Attempt 6: legitimate reversal return to original agent promo_wallet SUCCEEDS!
    q(f"""
    BEGIN;
    SET LOCAL app.ledger_autoskip_agents = 'on';
    UPDATE public.agents SET agent_wallet_balance = 0 WHERE club_id = '{club}' AND user_id = '{down_agent}';
    INSERT INTO public.chip_ledger(club_id, from_type, from_entity_id, to_type, to_entity_id, amount, category)
    VALUES ('{club}', 'agent_wallet', '{down_agent}', 'promo_wallet', '{agent}', 50, 'reversal');
    COMMIT;
    """)
    check('reversal to original promo_wallet closes grant as returned',
          q(f"SELECT close_reason||':'||remaining FROM public.ca_promo_play_through_grants WHERE id='{g_agent}';") == 'returned:0')

    print(json.dumps({'passed': True, 'cases': passed}, indent=2))
finally:
    if (cluster / 'data/postmaster.pid').exists():
        run([pg / 'pg_ctl', '-D', cluster / 'data', '-m', 'fast', '-w', 'stop'], check=False)
    shutil.rmtree(cluster, ignore_errors=True)
