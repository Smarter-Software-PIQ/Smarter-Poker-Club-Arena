#!/usr/bin/env python3
"""The owner routing wallet is a wallet and nothing else.

Native PostgreSQL 17 proof for migration 20261109231325 (owner-approved weekly
rakeback cascade, 2026-11-09). It builds public.agents exactly as production
declares it, loads 43 installed function definitions byte-exact
(scripts/ci/fixtures/owner-routing-wallet/live-definitions.json, each checked
against the md5 read from production), wires the installed triggers, shows the
defect the migration avoids on the preimage, installs the migration file
whole, and proves:

  (a) every earning reader answers for the owner's players exactly as it did
      when the owner had no agents row, at any time;
  (b) the wallet is funded by the installed Club Bank send and debited by the
      installed round 3 payment statements under the installed journal and
      deferred balance guards;
  (c) the row grants no agent permission and is not an earning agent;
  (d) suspension, deletion's suspend, and an ownership transfer neither strand
      the balance nor are blocked: the installed claim-back returns it;
  plus creation rules, idempotency, privileges, and that a wallet_only row
  never gains a rate, a parent, a credit line or an agreement by a bare flip.

Every case runs in a transaction that is rolled back, and the whole board is
hashed before and after. No production access. Stand-ins are marked STUB in
fixtures/owner-routing-wallet/schema.sql.
"""
import argparse, json, os, re, shutil, socket, subprocess, tempfile
from pathlib import Path

P = argparse.ArgumentParser()
P.add_argument('--repo', type=Path, default=Path(__file__).resolve().parents[2])
P.add_argument('--pg-bin', type=Path, default=Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/17/bin')))
P.add_argument('--scratch', '--scratch-root', dest='scratch', type=Path, default=Path(os.environ.get('RUNNER_TEMP', tempfile.gettempdir())))
P.add_argument('--output', type=Path, default=None)
A = P.parse_args()
R = A.repo
F = R / 'scripts/ci/fixtures/owner-routing-wallet'
MIG = next((R / 'supabase/migrations').glob('20261109231325_*.sql'))
BOUNDS_PRE = '3e4f5df422b121391cc40f711ae5b5ee'
E = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
E.update(LC_ALL='C', LANG='C', PGTZ='UTC')
A.scratch.mkdir(parents=True, exist_ok=True)
W = Path(tempfile.mkdtemp(prefix='orw-', dir=A.scratch))
D = W / 'data'
started = False
results = []
with socket.socket() as sk:
    sk.bind(('127.0.0.1', 0))
    port = str(sk.getsockname()[1])


def cmd(a):
    return subprocess.run(list(map(str, a)), env=E, text=True, capture_output=True, check=True, timeout=120)


def q(sql, check=True):
    r = subprocess.run([str(A.pg_bin / 'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-h', '127.0.0.1', '-p', port, '-d', 'postgres'],
                       env=E, text=True, input=sql, capture_output=True, timeout=300)
    if check and r.returncode:
        raise RuntimeError(r.stderr[-6000:])
    return r


def case(name, sql, refusal=None):
    """One rolled-back transaction. refusal: a substring (or tuple of accepted substrings) the failure must carry."""
    before = q('SELECT orw_money();').stdout.strip()
    body = 'BEGIN;\n' + sql + ('' if refusal else '\nSET CONSTRAINTS ALL IMMEDIATE;') + '\nROLLBACK;\n'
    r = q(body, check=False)
    if refusal:
        accepted = (refusal,) if isinstance(refusal, str) else refusal
        assert r.returncode and any(x in r.stderr for x in accepted), (name, r.stdout[-1500:], r.stderr[-3000:])
        assert 'orw_assert_failed' not in r.stderr, (name, r.stderr[-3000:])
    else:
        assert r.returncode == 0, (name, r.stdout[-1500:], r.stderr[-6000:])
    assert q('SELECT orw_money();').stdout.strip() == before, (name, 'a rolled-back case changed the board')
    results.append({'case': name, 'passed': True, 'expected_refusal': refusal})
    print('PASS', name, flush=True)


def a(cond, msg):
    return "SELECT orw_assert((" + cond + "),$m$" + msg + "$m$);\n"


U = lambda n: f"orw_u('{n}')"
WAL = lambda c, u: f"(orw_wallet('{c}','{u}'))"
BANK = lambda c: f"(SELECT chip_treasury FROM public.clubs WHERE id=orw_u('{c}'))"
ENSURE = lambda c: f"smarter_private.ensure_owner_routing_wallet(orw_u('{c}'))"
SEND = lambda c, u, amt, op: f"public.fn_club_bank_send(orw_u('{c}'),orw_u('{u}'),{amt},'agent_wallet','Weekly rakeback funding',orw_u('{op}'))"
CLAIM = lambda c, u, amt, op: f"public.fn_club_wallet_claim_back(orw_u('{c}'),orw_u('{u}'),{amt},'agent_wallet','club_bank','Return To Club Bank',orw_u('{op}'),NULL)"
NEW_WALLET = lambda c, u, extra_cols='', extra_vals='': (
    f"INSERT INTO public.agents(user_id,club_id,role,status,commission_rate,player_rakeback_rate{extra_cols}) "
    f"VALUES(orw_u('{u}'),orw_u('{c}'),'super_agent','wallet_only',0,0{extra_vals});")
D_PLAYERS = "ARRAY['P1','P2','P3','P4','OD','ST','A1']"

try:
    assert '17.' in cmd([A.pg_bin / 'postgres', '--version']).stdout, 'PostgreSQL 17 required'
    cmd([A.pg_bin / 'initdb', '-D', D, '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8'])
    cmd([A.pg_bin / 'pg_ctl', '-D', D, '-l', W / 'server.log', '-w', 'start', '-o',
         f"-k '' -p {port} -h 127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off"])
    started = True
    q((F / 'schema.sql').read_text())
    live = json.loads((F / 'live-definitions.json').read_text())
    for row in live:
        q('SET check_function_bodies=off;' + row['definition'] + ';')
        got = q(f"SELECT md5(pg_get_functiondef('{row['signature']}'::regprocedure));").stdout.strip()
        assert got == row['md5'], ('installed definition did not load byte-exact', row['signature'], got)
    assert len(live) == 43
    q((F / 'wiring.sql').read_text())
    q((F / 'seed.sql').read_text())
    q('GRANT USAGE ON SCHEMA smarter_private TO anon,authenticated,service_role;')

    # ── The preimage: what exists before the migration ────────────────────────
    # Two installed rules refuse it: the union band (BEFORE trigger) and, in a
    # standalone club where the band is silent, the status CHECK.
    case('preimage-union-band-refuses-a-zero-rate-wallet-only-row', NEW_WALLET('E', 'OE'), 'outside the union policy band')
    case('preimage-status-check-refuses-a-wallet-only-row', NEW_WALLET('X', 'OX'), 'agents_status_check')
    # The only installed way to give an owner a wallet changes what their
    # players are paid: the defect this migration exists to avoid.
    case('preimage-ensure-agent-row-mints-an-earning-agreement',
         "CREATE TEMP TABLE b AS SELECT public.fn_player_rakeback_rate(orw_u('PE1'),orw_u('E'),0) r;"
         "SELECT public.fn_ensure_agent_row(orw_u('E'),orw_u('OE'),'owner');"
         + a(f"{WAL('E','OE')}.status='active' AND {WAL('E','OE')}.commission_rate=0.20", 'minted active at the union minimum')
         + a("(SELECT r FROM b)=0.05 AND public.fn_player_rakeback_rate(orw_u('PE1'),orw_u('E'),0)=0.10", 'the player rate moved from 0.05 to 0.10')
         + a("public.is_club_agent(orw_u('E'),orw_u('OE'))", 'and the owner became an agent'))

    # What every earning reader says while owner OD has no agents row at all.
    q("CREATE TABLE public.orw_baseline AS SELECT clock_timestamp() AS t0, public.orw_entitlements('D'," + D_PLAYERS + ",now()) AS doc,"
      "public.orw_entitlements('X',ARRAY['PX1','OX'],now()) AS doc_x,(SELECT count(*) FROM public.agents WHERE status='active') AS active_agents,"
      "(SELECT count(*) FROM public.fn_union_weekly_agent_statements(orw_u('U'),NULL)) AS statements;")
    q(a("(SELECT public.orw_terms_error('D','OD',now()))='accounting_terms_not_observed'", 'no row: terms not observed'))
    # What the agent lists answer before the migration, while no wallet_only row can exist.
    q("CREATE TABLE public.orw_lists_before AS SELECT c AS club,public.orw_agent_lists(c) AS doc FROM unnest(ARRAY['D','E','K','S','X']) c;")

    # ── Install the migration file whole, as production receives it ───────────
    text = MIG.read_text()
    q('SET check_function_bodies=off;\n' + text)
    proofs = [l.split(': ', 1)[1] for l in text.splitlines() if l.startswith('-- @live-proof: ')]
    assert len(proofs) == 6 and all(q('SELECT ' + p + ';').stdout.strip() == 't' for p in proofs), 'live proof false after install'
    replay = q('SET check_function_bodies=off;\n' + text, check=False)
    assert replay.returncode and 'owner_routing_wallet_preimage_changed' in replay.stderr, 'a replay must refuse on the changed preimage'
    q('ROLLBACK;')
    # The replaced band function is the installed body plus one block, nothing else.
    block = re.search(r"\n  -- THE OWNER ROUTING WALLET \(owner, 2026-11-09\)\..*?\n  END IF;\n", text, re.S).group(0)
    assert q("SELECT md5(replace(pg_get_functiondef('public.fn_enforce_agent_commission_bounds()'::regprocedure),$blk$" + block + "$blk$,''));").stdout.strip() == BOUNDS_PRE, \
        'the band function differs from the installed body by more than the one exemption'
    # Each replaced agent reader is the installed body plus one exclusion, nothing else.
    for sig, pre, added in (
            ('public.fn_ca_agent_payables(uuid)', '5b86542b4686a504209767ac9a70e1e8',
             "\n       -- An owner routing wallet is a wallet, not an agent (20261109231325).\n       AND coalesce(a.status, 'active') <> 'wallet_only'"),
            ('public.get_club_agents(uuid)', '7c4fc71f953f809d1d4e40780c747ac0',
             "\n      -- An owner routing wallet is a wallet, not an agent (20261109231325).\n      AND COALESCE(a.status, 'active') <> 'wallet_only'"),
            ('public.fn_club_opening_checklist_complete(uuid)', '0e51fff026d1e37b1c143bbfb1fe021f',
             " AND lower(COALESCE(a.status,'active'))<>'wallet_only'")):
        assert text.count(added) == 1, ('the exclusion is not in the migration exactly once', sig)
        assert q("SELECT md5(replace(pg_get_functiondef('" + sig + "'::regprocedure),$blk$" + added + "$blk$,''));").stdout.strip() == pre, \
            (sig, 'differs from the installed body by more than the one exclusion')
    assert q("SELECT count(*) FROM public.agents WHERE status='wallet_only';").stdout.strip() == '0', 'the migration wrote a row'
    results.append({'case': 'install-live-proofs-replay-refused-and-band-differs-by-one-block', 'passed': True, 'expected_refusal': None})
    print('PASS install-live-proofs-replay-refused-and-band-differs-by-one-block', flush=True)

    # OD's routing wallet now exists, committed, so the earning readers (which
    # never see the current transaction's own agreement events at now()) see it.
    q(f"SELECT {ENSURE('D')};SELECT {ENSURE('X')};SELECT pg_sleep(0.05);")

    # ── Creation ─────────────────────────────────────────────────────────────
    case('ensure-creates-an-empty-zero-rate-wallet-in-a-union-club',
         f"CREATE TEMP TABLE r AS SELECT {ENSURE('E')} id;"
         + a(f"(SELECT id FROM r)={WAL('E','OE')}.id", 'returns the agents id')
         + a(f"(SELECT (w.status,w.commission_rate,w.player_rakeback_rate,w.agent_wallet_balance,w.promo_wallet_balance,w.role,w.parent_agent_id,w.credit_limit,w.credit_used,w.is_prepaid) "
             f"IS NOT DISTINCT FROM ('wallet_only'::text,0::numeric,0::numeric,0::numeric,0::numeric,'super_agent'::text,NULL::uuid,0::numeric,0::numeric,true) FROM orw_wallet('E','OE') w)", 'wallet only, zero rates, empty, prepaid, no line')
         + a(f"(SELECT count(*)=1 FROM public.agents WHERE club_id={U('E')})", 'exactly one row')
         + a(f"(SELECT count(*)=1 AND bool_and(after_terms->>'status'='wallet_only' AND (after_terms->>'commission_rate')::numeric=0) FROM public.accounting_agreement_history WHERE entity_type='agents' AND club_id={U('E')})", 'observed once, as wallet_only at zero'))
    case('ensure-is-idempotent',
         f"CREATE TEMP TABLE r AS SELECT {ENSURE('E')} id;CREATE TEMP TABLE w AS SELECT to_jsonb({WAL('E','OE')}) j;"
         + a(f"{ENSURE('E')}=(SELECT id FROM r) AND {ENSURE('E')}=(SELECT id FROM r)", 'same id every time')
         + a(f"(SELECT count(*)=1 FROM public.agents WHERE club_id={U('E')}) AND to_jsonb({WAL('E','OE')})=(SELECT j FROM w)", 'one unchanged row')
         + a(f"(SELECT count(*)=1 FROM public.accounting_agreement_history WHERE entity_type='agents' AND club_id={U('E')})", 'no further agreement event'))
    for club, owner, label in (('K', 'OK', 'active'), ('S', 'OS', 'suspended')):
        case(f'ensure-returns-an-existing-{label}-owner-row-untouched',
             f"CREATE TEMP TABLE w AS SELECT to_jsonb({WAL(club, owner)}) j;CREATE TEMP TABLE h AS SELECT count(*) n FROM public.accounting_agreement_history;"
             + a(f"{ENSURE(club)}={WAL(club, owner)}.id", 'returns the existing id')
             + a(f"to_jsonb({WAL(club, owner)})=(SELECT j FROM w) AND {WAL(club, owner)}.status='{label}'", 'status, rate and every other column unchanged')
             + a("(SELECT count(*) FROM public.accounting_agreement_history)=(SELECT n FROM h)", 'no agreement event'))
    case('ensure-refuses-a-club-with-no-owner', f"SELECT {ENSURE('N')};", 'owner_routing_wallet_club_has_no_owner')
    case('ensure-refuses-an-unknown-club', f"SELECT {ENSURE('nowhere')};", 'owner_routing_wallet_club_not_found')
    case('ensure-refuses-a-null-club', "SELECT smarter_private.ensure_owner_routing_wallet(NULL);", 'owner_routing_wallet_club_required')
    case('execute-is-held-by-the-owner-role-only',
         a("NOT has_function_privilege('anon','smarter_private.ensure_owner_routing_wallet(uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','smarter_private.ensure_owner_routing_wallet(uuid)','EXECUTE') "
           "AND NOT has_function_privilege('service_role','smarter_private.ensure_owner_routing_wallet(uuid)','EXECUTE')", 'no browser or service role')
         + a("(SELECT proacl::text='{postgres=X/postgres}' AND prosecdef FROM pg_proc WHERE oid='smarter_private.ensure_owner_routing_wallet(uuid)'::regprocedure)", 'the ACL of weekly_payout_fund_agent_shortfalls')
         + a("NOT has_function_privilege('authenticated','public.fn_guard_owner_routing_wallet()','EXECUTE')", 'the trigger function is not callable'))
    for role in ('service_role', 'authenticated', 'anon'):
        case(f'{role}-cannot-call-ensure', f"SET LOCAL ROLE {role};SELECT {ENSURE('E')};", 'permission denied for function ensure_owner_routing_wallet')
    case('a-non-owner-cannot-hold-a-wallet-only-row', NEW_WALLET('E', 'PE1'), 'owner_routing_wallet_owner_only')
    case('a-co-owner-cannot-hold-a-wallet-only-row', NEW_WALLET('D', 'ST'), 'owner_routing_wallet_owner_only')
    case('a-wallet-only-row-opens-empty', NEW_WALLET('E', 'OE', ',agent_wallet_balance', ',5'), 'owner_routing_wallet_opens_empty')
    case('a-wallet-only-row-cannot-be-created-with-a-rate',
         "INSERT INTO public.agents(user_id,club_id,role,status,commission_rate,player_rakeback_rate) VALUES(orw_u('OE'),orw_u('E'),'super_agent','wallet_only',0.20,0);",
         'agents_wallet_only_earns_nothing')

    # ── It can never earn ────────────────────────────────────────────────────
    UPD = lambda setter: f"UPDATE public.agents SET {setter} WHERE club_id={U('D')} AND user_id={U('OD')};"
    case('commission-rate-cannot-be-raised-while-wallet-only', UPD('commission_rate=0.20'), 'agents_wallet_only_earns_nothing')
    case('player-rakeback-rate-cannot-be-raised-while-wallet-only', UPD('player_rakeback_rate=0.10'),
         ('agents_wallet_only_earns_nothing', 'cannot exceed its own commission_rate'))
    case('both-rates-cannot-be-raised-while-wallet-only', UPD('commission_rate=0.30,player_rakeback_rate=0.10'), 'agents_wallet_only_earns_nothing')
    case('a-wallet-only-row-takes-no-parent', UPD(f"parent_agent_id={WAL('D','A1')}.id"), ('agents_wallet_only_earns_nothing', 'cannot exceed or worsen its parent cap'))
    case('a-wallet-only-row-takes-no-credit-line', UPD('is_prepaid=false,credit_limit=100'), 'agents_wallet_only_earns_nothing')
    case('no-agent-can-be-placed-under-a-wallet-only-row',
         f"INSERT INTO public.agents(user_id,club_id,role,status,parent_agent_id,commission_rate,player_rakeback_rate) VALUES({U('A2')},{U('D')},'sub_agent','active',{WAL('D','OD')}.id,0.20,0);",
         'new parent must be an active agent or super agent')
    case('an-existing-active-agreement-is-never-converted',
         f"UPDATE public.agents SET status='wallet_only',commission_rate=0,player_rakeback_rate=0 WHERE club_id={U('K')} AND user_id={U('OK')};",
         'owner_routing_wallet_never_replaces_an_agreement')
    case('an-existing-suspended-agreement-is-never-converted',
         f"UPDATE public.agents SET status='wallet_only',commission_rate=0,player_rakeback_rate=0 WHERE club_id={U('S')} AND user_id={U('OS')};",
         'owner_routing_wallet_never_replaces_an_agreement')
    case('a-bare-status-flip-cannot-activate-it', UPD("status='active'"), 'agent_activation_requires_an_agreement')
    # The statement shape fn_admin_update_agent runs when only p_status is given.
    case('the-admin-status-only-update-cannot-activate-it',
         UPD("status=COALESCE('active',status),role=COALESCE(NULL,role),commission_rate=COALESCE(NULL,commission_rate),player_rakeback_rate=COALESCE(NULL,player_rakeback_rate),updated_at=now()"),
         'agent_activation_requires_an_agreement')
    case('activation-below-the-union-band-is-refused', UPD("status='active',commission_rate=0.10"), 'outside the union policy band')
    # The supported promotion statement (fn_club_set_member_role) with a real rate.
    case('activation-with-a-real-in-band-agreement-is-accepted',
         UPD("role='super_agent',status='active',parent_agent_id=COALESCE(NULL,parent_agent_id),commission_rate=0.20,player_rakeback_rate=0.10,is_prepaid=true,credit_limit=0,updated_at=now()")
         + a(f"{WAL('D','OD')}.status='active' AND {WAL('D','OD')}.commission_rate=0.20", 'an agreed rate activates it'))
    case('suspension-is-never-blocked-and-opens-no-door',
         f"SELECT orw_as('OD');SELECT {SEND('D','OD','250.00','op-s')};"
         # fn_ca_deleted_account_leaves_every_club, lines 173-177.
         f"UPDATE public.agents a SET status='suspended',updated_at=clock_timestamp() FROM public.clubs c WHERE c.id=a.club_id AND c.lifecycle_status='active' AND a.user_id={U('OD')} AND a.status<>'suspended';"
         + a(f"{WAL('D','OD')}.status='suspended' AND {WAL('D','OD')}.agent_wallet_balance=250", 'suspended with its balance intact')
         + "SAVEPOINT s;" + UPD("status='active'"),
         'agent_activation_requires_an_agreement')
    case('freezing-is-allowed', UPD("status='frozen'") + a(f"{WAL('D','OD')}.status='frozen'", 'frozen'))
    case('a-standalone-club-has-no-band-so-nothing-is-judged',
         a(f"{WAL('X','OX')}.status='wallet_only'", 'standalone owner wallet exists')
         + f"UPDATE public.agents SET status='active' WHERE club_id={U('X')} AND user_id={U('OX')};"
         + a(f"{WAL('X','OX')}.status='active' AND {WAL('X','OX')}.commission_rate=0", 'as fn_ensure_agent_row already mints 0 there'))

    # ── (a) Earnings are exactly what they were with no row ──────────────────
    case('terms-at-ignores-the-wallet-only-row-at-any-time',
         a("public.orw_terms_error('D','OD',(SELECT t0 FROM public.orw_baseline))='accounting_terms_not_observed'", 'before the wallet existed')
         + a("public.orw_terms_error('D','OD',now())='accounting_terms_not_active'", 'after: observed, never honoured')
         + a("public.orw_terms_error('D','OD',now()-interval '1 millisecond')='accounting_terms_not_active'", 'and a moment earlier')
         + a("public.orw_terms_error('K','OK',now())='honoured' AND public.orw_terms_error('D','A1',now())='honoured'", 'control: active rows are honoured')
         + a("public.orw_terms_error('X','OX',now())='accounting_terms_not_active'", 'standalone the same'))
    case('earning-contracts-and-player-rates-equal-the-no-row-baseline',
         a(f"public.orw_entitlements('D',{D_PLAYERS},now())=(SELECT doc FROM public.orw_baseline)", 'every contract and rate for seven members of D is unchanged')
         + a("public.orw_entitlements('X',ARRAY['PX1','OX'],now())=(SELECT doc_x FROM public.orw_baseline)", 'standalone unchanged')
         + a("(SELECT doc->'P1'->'contract'->'tiers'='[]'::jsonb AND (doc->'P1'->'contract'->>'club_residual')::numeric=100 AND (doc->'P1'->>'rate_0')::numeric=0.05 AND (doc->'P1'->>'rate_20000')::numeric=0.30 FROM public.orw_baseline)", 'owner player: no tier, club keeps the rake, volume ladder')
         + a("(SELECT (doc->'P2'->>'rate_0')::numeric=0.70 AND doc->'P2'->'contract'->'tiers'='[]'::jsonb FROM public.orw_baseline)", 'the explicit 0.70 owner deal is unchanged')
         + a("(SELECT jsonb_array_length(doc->'P4'->'contract'->'tiers')=1 AND (doc->'P4'->'contract'->'tiers'->0->>'amount')::numeric=30 FROM public.orw_baseline)", 'control: a real agent tier is present')
         + a("jsonb_array_length(public.fn_accounting_earning_contract(orw_u('K'),orw_u('PK1'),100.00,orw_u('U'),now())->'tiers')=1 AND public.fn_player_rakeback_rate(orw_u('PK1'),orw_u('K'),0)=0.20",
             'control: an ACTIVE owner row does change both, so the comparison can fail'))

    # ── (b) It is funded and debited under the installed guards ──────────────
    FUND = f"SELECT orw_as('OD');CREATE TEMP TABLE s AS SELECT {SEND('D','OD','250.00','op-1')} j;" + a("(SELECT j->>'success' FROM s)='true'", 'the installed Club Bank send succeeded')
    # The funding transaction's deferred guard is judged, then the next money
    # statement starts deferred again, as inside the real round 3 transaction.
    SETTLED = "SET CONSTRAINTS ALL IMMEDIATE;SET CONSTRAINTS ALL DEFERRED;"
    case('the-installed-club-bank-send-funds-the-wallet-only-row',
         f"CREATE TEMP TABLE w AS SELECT to_jsonb({WAL('D','OD')})-'agent_wallet_balance'-'business_balance'-'updated_at' j;" + FUND
         + a(f"{WAL('D','OD')}.agent_wallet_balance=250 AND {BANK('D')}=9750", 'bank 10000 -> 9750, wallet 0 -> 250')
         + a(f"to_jsonb({WAL('D','OD')})-'agent_wallet_balance'-'business_balance'-'updated_at'=(SELECT j FROM w)", 'status, rates and every other column unchanged')
         + a(f"(SELECT count(*)=1 FROM public.agents WHERE club_id={U('D')} AND user_id={U('OD')})", 'no second row')
         + a(f"(SELECT count(*)=1 AND sum(amount)=250 AND bool_and(from_type='club_treasury' AND to_type='agent_wallet' AND to_entity_id={U('OD')}) FROM public.chip_ledger WHERE club_id={U('D')})", 'one journal leg, bank to agent wallet')
         + "SET CONSTRAINTS ALL IMMEDIATE;"
         + a(f"({SEND('D','OD','250.00','op-1')})->>'replayed'='true' AND {WAL('D','OD')}.agent_wallet_balance=250", 'the same retry key pays once'))
    case('the-installed-round-three-statements-debit-the-wallet-only-row',
         FUND + SETTLED + ""
         + a("public.orw_round3_leg('D','OD','P1',40.00)=210", 'payer after 210')
         + a(f"{WAL('D','OD')}.agent_wallet_balance=210 AND (SELECT chip_balance FROM public.club_members WHERE club_id={U('D')} AND user_id={U('P1')})=40", 'wallet 250 -> 210, player +40')
         + a(f"{WAL('D','OD')}.status='wallet_only'", 'still wallet only'))
    case('a-debit-with-no-journal-leg-is-refused-by-the-installed-guard',
         FUND + SETTLED + "SELECT public.orw_round3_leg('D','OD','P1',40.00,false);SET CONSTRAINTS ALL IMMEDIATE;",
         'balance_moved_without_its_ledger_row')
    case('the-wallet-cannot-be-overdrawn',
         FUND + a("public.orw_round3_leg('D','OD','P1',250.01) IS NULL", 'the round 3 statement finds no payable row')
         + f"UPDATE public.agents SET agent_wallet_balance=agent_wallet_balance-250.01 WHERE club_id={U('D')} AND user_id={U('OD')};",
         'agents_agent_wallet_balance_nonneg')
    # Why the funding step must call ensure first: without it the installed send mints an earning row.
    case('a-send-with-no-ensure-first-would-mint-an-earning-row',
         f"SELECT orw_as('OE');SELECT {SEND('E','OE','10.00','op-e')};" + a(f"{WAL('E','OE')}.status='active' AND {WAL('E','OE')}.commission_rate=0.20", 'fn_ensure_agent_row minted active 0.20')
         + a("public.fn_player_rakeback_rate(orw_u('PE1'),orw_u('E'),0)=0.10 AND public.is_club_agent(orw_u('E'),orw_u('OE'))", 'and the entitlement and the permission changed'))
    case('ensure-then-send-keeps-the-entitlement',
         f"SELECT {ENSURE('E')};SELECT orw_as('OE');SELECT {SEND('E','OE','10.00','op-e')};"
         + a(f"{WAL('E','OE')}.status='wallet_only' AND {WAL('E','OE')}.commission_rate=0 AND {WAL('E','OE')}.agent_wallet_balance=10", 'funded, still wallet only')
         + a("public.fn_player_rakeback_rate(orw_u('PE1'),orw_u('E'),0)=0.05 AND NOT public.is_club_agent(orw_u('E'),orw_u('OE'))", 'player rate and permissions untouched'))

    # ── (c) No permission, not an earning agent ──────────────────────────────
    case('the-row-grants-no-agent-permission-and-is-not-reported-as-an-agent',
         a("NOT public.is_club_agent(orw_u('D'),orw_u('OD')) AND public.is_club_agent(orw_u('K'),orw_u('OK'))", 'is_club_agent: false, control true')
         + "SELECT orw_as('OD');" + a("(SELECT count(*)=0 FROM public.fn_my_agent_roles())", 'fn_my_agent_roles lists nothing for the owner')
         + "SELECT orw_as('OK');" + a("(SELECT count(*)=1 FROM public.fn_my_agent_roles())", 'control: an active owner agent is listed')
         + a("(SELECT count(*) FROM public.agents WHERE status='active')=(SELECT active_agents FROM public.orw_baseline)", 'the active agent count every report filters on is unchanged')
         + a("(SELECT count(*) FROM public.fn_union_weekly_agent_statements(orw_u('U'),NULL))=(SELECT statements FROM public.orw_baseline)", 'no weekly agent statement for the wallet')
         + a("public.fn_club_bank_role(orw_u('D'),orw_u('OD'))='owner'", 'the owner is the owner, by clubs.owner_id, as before'))

    # ── A wallet is not an agent in any list or count ─────────────────────────
    # D now holds a committed wallet_only row for OD beside agent A1; X holds
    # one and nothing else. K and S hold none.
    case('the-payouts-tab-and-the-agent-list-leave-the-wallet-out-row-and-count',
         a(f"{WAL('D','OD')}.status='wallet_only' AND (SELECT count(*)=2 FROM public.agents WHERE club_id={U('D')})", 'the club holds the wallet and one real agent')
         + a(f"(SELECT (p->>'agents')::int=1 AND jsonb_array_length(p->'rows')=1 AND p->'rows'->0->>'user_id'={U('A1')}::text AND p->'rows'->0->>'status'='active' FROM public.fn_ca_agent_payables({U('D')}) p)", 'payables: one row, count one, the real agent')
         + a(f"(SELECT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p->'rows') r WHERE r->>'user_id'={U('OD')}::text OR r->>'status'='wallet_only') FROM public.fn_ca_agent_payables({U('D')}) p)", 'payables: the wallet is not a row')
         + a(f"(SELECT count(*)=1 AND bool_and(g.user_id={U('A1')} AND g.status='active') FROM public.get_club_agents({U('D')}) g)", 'agent list: the real agent only')
         + a(f"(SELECT (p->>'agents')::int=0 AND p->'rows'='[]'::jsonb AND (p->>'total_owed')::numeric=0 FROM public.fn_ca_agent_payables({U('X')}) p) AND NOT EXISTS(SELECT 1 FROM public.get_club_agents({U('X')}))", 'a club holding only the wallet lists no agent and counts none')
         + a("(SELECT doc FROM public.orw_lists_before WHERE club='D')=public.orw_agent_lists('D') AND (SELECT doc FROM public.orw_lists_before WHERE club='X')=public.orw_agent_lists('X')", 'with the wallet present both answers equal what they were before it existed'))
    case('a-funded-wallet-is-still-not-listed-and-adds-nothing-to-the-totals',
         FUND + SETTLED
         + a(f"{WAL('D','OD')}.agent_wallet_balance=250", 'the wallet holds chips')
         + a("(SELECT doc FROM public.orw_lists_before WHERE club='D')=public.orw_agent_lists('D')", 'the lists are unchanged by the balance'))
    case('clubs-with-no-wallet-only-row-answer-exactly-as-before',
         a("(SELECT bool_and(b.doc=public.orw_agent_lists(b.club)) AND count(*)=3 FROM public.orw_lists_before b WHERE b.club IN('E','K','S'))", 'payables and agent list identical for E, K and S')
         + a(f"(SELECT (p->>'agents')::int=1 AND p->'rows'->0->>'status'='suspended' FROM public.fn_ca_agent_payables({U('S')}) p) AND (SELECT count(*)=1 FROM public.get_club_agents({U('K')}))", 'a suspended agent and an active owner agent are still listed'))
    case('a-suspended-former-wallet-is-listed-like-any-suspended-row',
         f"UPDATE public.agents SET status='suspended' WHERE club_id={U('D')} AND user_id={U('OD')};"
         + a(f"(SELECT (p->>'agents')::int=2 AND jsonb_array_length(p->'rows')=2 FROM public.fn_ca_agent_payables({U('D')}) p)", 'only the wallet_only status is excluded, not the person'))
    case('a-wallet-does-not-finish-the-first-agent-opening-step',
         f"SELECT {ENSURE('E')};SELECT public.orw_checklist_open('E');SELECT orw_as('OE');"
         f"SELECT public.fn_club_opening_checklist_complete({U('E')});", 'Finish Or Skip Every Opening Checklist Step: first-agent')
    case('a-real-agent-still-finishes-the-first-agent-opening-step',
         "SELECT public.orw_checklist_open('K');SELECT orw_as('OK');"
         + a(f"(SELECT public.fn_club_opening_checklist_complete({U('K')})->>'completedAt') IS NOT NULL", 'completed with a real agent row')
         + f"SELECT public.orw_checklist_open('D');SELECT orw_as('OD');"
         + a(f"(SELECT public.fn_club_opening_checklist_complete({U('D')})->>'completedAt') IS NOT NULL", 'a club with a wallet and a real agent completes on the agent'))

    # ── (d) Nothing strands, nothing is blocked ──────────────────────────────
    case('the-owner-returns-the-balance-to-the-club-bank',
         FUND + SETTLED + f"CREATE TEMP TABLE c AS SELECT {CLAIM('D','OD','250.00','op-2')} j;"
         + a("(SELECT j->>'success' FROM c)='true'", 'the installed claim-back succeeded')
         + a(f"{WAL('D','OD')}.agent_wallet_balance=0 AND {BANK('D')}=10000", 'wallet empty, bank whole'))
    case('a-suspended-wallet-is-still-returnable',
         FUND + SETTLED + f"UPDATE public.agents SET status='suspended' WHERE club_id={U('D')} AND user_id={U('OD')};"
         + a(f"({CLAIM('D','OD','250.00','op-3')})->>'success'='true'", 'claim-back from the suspended row')
         + a(f"{WAL('D','OD')}.agent_wallet_balance=0 AND {BANK('D')}=10000", 'wallet empty, bank whole'))
    case('after-an-ownership-transfer-the-new-owner-returns-it-and-gets-their-own',
         FUND
         # transfer_club_ownership, lines 33-37: the old owner becomes an admin.
         + f"UPDATE public.clubs SET owner_id={U('ST')},updated_at=now() WHERE id={U('D')};"
         f"UPDATE public.club_members SET role='admin',updated_at=now() WHERE club_id={U('D')} AND user_id={U('OD')};"
         f"UPDATE public.club_members SET role='owner',updated_at=now() WHERE club_id={U('D')} AND user_id={U('ST')};"
         + SETTLED + "SELECT orw_as('ST');"
         + a(f"({CLAIM('D','OD','250.00','op-4')})->>'success'='true'", 'the new owner claims the former owner wallet back')
         + a(f"{WAL('D','OD')}.agent_wallet_balance=0 AND {BANK('D')}=10000 AND {WAL('D','OD')}.status='wallet_only'", 'returned; the old row stays inert')
         + a(f"{ENSURE('D')}={WAL('D','ST')}.id AND {WAL('D','ST')}.status='wallet_only'", 'the new owner gets their own routing wallet')
         + a("NOT public.is_club_agent(orw_u('D'),orw_u('OD')) AND NOT public.is_club_agent(orw_u('D'),orw_u('ST'))", 'neither is an agent'))

    # ── The three files after this one, whole, on the production definitions they pin ──────────────
    # 20261109231855 (funding cascade), 20261110053814 (preparation shard) and 20261111132447 (one transfer per
    # edge, players' share reserved). Their targets are loaded byte-exact from the real-runner fixture (production,
    # read 2026-11-09; the round 2, finalize and validator definitions re-read unchanged 2026-11-11); only the
    # wallet guard below is exercised here, through the installed Club Bank send and claim-back.
    RUNNER = json.loads((R / 'scripts/ci/fixtures/rakeback-cascade-real-runner/production-functions.json').read_text())
    PRE = {'smarter_private.weekly_payout_fund_agent_shortfalls(': '018a0fcbad1fabcf1b5427b9fa454028', 'public.fn_settle_accounting_rakeback_stage(': '21409a0d24523597e10b5da44c252840',
           'smarter_private.rakeback_wallet_payout_complete(': '0f5fbe00efb06f9a49dcfae37d5830cc', 'smarter_private.split_rakeback_payout_complete(': '516cd5a271fd21f4b2fe6f98e503dc75',
           'smarter_private.weekly_prep_shard(': 'c2188f253dab440846951fe852f44584', 'public.fn_settle_accounting_commission_stage(': 'ce1a9dd4344c7987918dcf8a82427ef5',
           'smarter_private.weekly_payout_finalize(': '5b83618b59f043376c87361c986adca8', 'smarter_private.zero_standalone_foreign_commissions_proven(': '69099f3bac93cb29fad83cb82cb1fe4a'}
    for pre, md in PRE.items():
        k, v = next((k, v) for k, v in RUNNER.items() if k.startswith(pre))
        assert v['md5'] == md, (k, v['md5'])
        q('SET check_function_bodies=off;\n' + v['def'].rstrip() + ';')
    for ver in ('20261109231855', '20261110053814', '20261111132447'):
        text = next((R / 'supabase/migrations').glob(ver + '_*.sql')).read_text()
        q('SET check_function_bodies=off;\n' + text)
        assert all(q('SELECT ' + l.split(': ', 1)[1] + ';').stdout.strip() == 't' for l in text.splitlines() if l.startswith('-- @live-proof: ')), ver
    case('the-cascade-files-install-whole-after-the-wallet-file',
         a("(SELECT count(*)=1 FROM pg_trigger WHERE tgrelid='public.agents'::regclass AND tgname='zzzzz_agent_wallet_keeps_weekly_reserve')", 'the reserve guard is on the agents table')
         + a("md5(pg_get_functiondef('smarter_private.rakeback_wallet_payout_complete(uuid,bigint)'::regprocedure))='c2b4cfdbc811adfae751d47fd5b298e6' AND md5(pg_get_functiondef('smarter_private.split_rakeback_payout_complete(uuid,bigint)'::regprocedure))='47519877eefe45ac6ab39f6519bfb0e8'", 'the validators are what production runs today'))
    RESERVE = lambda c, u, amt: (f"INSERT INTO smarter_private.weekly_payout_wallet_reserves(period_id,club_id,user_id,scope_kind,scope_id,period_start,period_end,reserved,remaining,set_by) "
                                 f"VALUES(gen_random_uuid(),{U(c)},{U(u)},'union',{U('U')},'2026-11-09 08:00+00','2026-11-16 08:00+00',{amt},{amt},'round2');")
    REFUSED = 'agent_wallet_weekly_rakeback_reserved: agent '
    # Round 2 funded the owner wallet and reserved what its players are owed (here 200.00 of 250.00) until round 3.
    case('a-claim-back-of-the-reserved-part-of-an-owner-wallet-is-refused',
         FUND + SETTLED + RESERVE('D', 'OD', '200.00') + f"SELECT {CLAIM('D','OD','250.00','op-r1')};", REFUSED)
    case('the-unreserved-part-of-an-owner-wallet-is-still-returned',
         FUND + SETTLED + RESERVE('D', 'OD', '200.00') + f"CREATE TEMP TABLE c AS SELECT {CLAIM('D','OD','50.00','op-r2')} j;"
         + a("(SELECT j->>'success' FROM c)='true'", 'the installed claim-back moved the unreserved 50.00')
         + a(f"{WAL('D','OD')}.agent_wallet_balance=200 AND {BANK('D')}=9800", 'the reserved 200.00 stays for the players'))
    case('suspension-with-a-reserve-is-not-blocked-and-releases-nothing',
         FUND + SETTLED + RESERVE('D', 'OD', '200.00') + f"UPDATE public.agents SET status='suspended' WHERE club_id={U('D')} AND user_id={U('OD')};"
         + f"SELECT {CLAIM('D','OD','50.01','op-r3')};", 'at most 50.00 can leave this wallet')
    case('after-an-ownership-transfer-the-reserve-still-holds',
         FUND + f"UPDATE public.clubs SET owner_id={U('ST')},updated_at=now() WHERE id={U('D')};"
         f"UPDATE public.club_members SET role='admin',updated_at=now() WHERE club_id={U('D')} AND user_id={U('OD')};"
         f"UPDATE public.club_members SET role='owner',updated_at=now() WHERE club_id={U('D')} AND user_id={U('ST')};"
         + SETTLED + RESERVE('D', 'OD', '200.00') + "SELECT orw_as('ST');" + f"SELECT {CLAIM('D','OD','250.00','op-r4')};", REFUSED)
    case('a-released-reserve-returns-the-whole-wallet-as-before',
         FUND + SETTLED + RESERVE('D', 'OD', '200.00') + "UPDATE smarter_private.weekly_payout_wallet_reserves SET remaining=0,released_at=now();"
         + a(f"({CLAIM('D','OD','250.00','op-r5')})->>'success'='true'", 'after round 3 released it, the claim-back returns everything')
         + a(f"{WAL('D','OD')}.agent_wallet_balance=0 AND {BANK('D')}=10000", 'wallet empty, bank whole'))

    if A.output:
        A.output.parent.mkdir(parents=True, exist_ok=True)
        A.output.write_text(json.dumps({'status': 'passed', 'migration': MIG.name, 'later_migrations': ['20261109231855', '20261110053814', '20261111132447'], 'cases': results}, indent=2) + '\n')
    print(json.dumps({'status': 'passed', 'cases': len(results)}))
finally:
    if started:
        subprocess.run([str(A.pg_bin / 'pg_ctl'), '-D', str(D), '-m', 'immediate', 'stop'], env=E, capture_output=True)
    shutil.rmtree(W, ignore_errors=True)
