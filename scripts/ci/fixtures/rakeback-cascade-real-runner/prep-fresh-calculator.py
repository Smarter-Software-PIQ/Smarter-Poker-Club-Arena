# Isolate an already prepared week. A cash source from Sunday arrives after
# the club's first completed Monday receipt. The source owner is real.
_cfg_local=json.loads(one("SELECT to_json(COALESCE(setconfig,'{}'::text[]))::text FROM pg_db_role_setting WHERE setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database()) AND setrole=0"))
q("CREATE DATABASE calcproof TEMPLATE postgres;\n"+''.join("ALTER DATABASE calcproof SET "+c.split('=',1)[0]+" TO "+(c.split('=',1)[1] if c.startswith('search_path=') else "$v$"+c.split('=',1)[1]+"$v$")+";\n" for c in _cfg_local))
DB='calcproof'
clock('2026-11-16 09:31:00Z')
migration=next((R/'supabase/migrations').glob('20261117001201_*.sql'))
q(migration.read_text())
assert one("SELECT "+re.search(r'^-- @live-proof: (.*)$',migration.read_text(),re.M).group(1))=='t'
calc_args="rr.u('T'),'2026-11-09','2026-11-15'"
finalize="SELECT smarter_private.weekly_finalize_club_calculation("+calc_args+")"
current="SELECT smarter_private.weekly_club_calculation_current("+calc_args+")"
parts="SELECT count(*) FROM accounting_recompute_split_parts WHERE club_id=rr.u('T') AND period_start='2026-11-09'"
assert one(finalize)=='t' and one(current)=='t' and one(parts)=='0'
initial_attempt=one("SELECT attempts FROM accounting_period_recompute_requests WHERE club_id=rr.u('T') AND period_start='2026-11-09'")
assert one(finalize)=='t'
assert one("SELECT attempts FROM accounting_period_recompute_requests WHERE club_id=rr.u('T') AND period_start='2026-11-09'")==initial_attempt
clock('2026-11-16 09:35:00Z')
q("SELECT rr.hand('T','TN',20,'2026-11-16 07:55Z')")
# In production a later fee recording can leave a structurally complete
# request. Preserve this fixture's old recorded completion to exercise it.
q("UPDATE accounting_period_recompute_requests SET status='complete',attempted_at='2026-11-16 09:31Z',last_requested_at='2026-11-16 09:31Z' WHERE club_id=rr.u('T') AND period_start='2026-11-09'")
assert one(current)=='f'
money=one("SELECT rr.money()||':'||(SELECT count(*) FROM chip_ledger)")
assert one(finalize)=='f' and one(parts)=='0'
clock('2026-11-16 09:40:00Z')
unit="SELECT smarter_private.weekly_prep_unit('union',rr.u('U'),rr.ws(),rr.we(),'players',rr.u('T'),0)"
assert one(unit)=='players' and one(parts)=='1'
assert one(finalize)=='f' and one(parts)=='1', 'the finalizer must never calculate missing expensive parts'
for minute_pre in [41,43,45]:
    for job in SHARDS:
        outcome=tick(job,minute(9,minute_pre))
        assert outcome['rc']==0,outcome
clock('2026-11-16 09:46:00Z')
assert one(finalize)=='t' and one(current)=='t' and one(parts)=='0'
assert one("SELECT sum(rakeback_amount) FROM (SELECT DISTINCT ON (period_id) period_id,rakeback_amount FROM accounting_rakeback_period_calculations WHERE club_id=rr.u('T') AND player_id=rr.u('TN') ORDER BY period_id,id DESC) p")=='11.00'
assert one("SELECT rr.money()||':'||(SELECT count(*) FROM chip_ledger)")==money
assert one("SELECT NOT has_function_privilege('authenticated','smarter_private.weekly_finalize_club_calculation(uuid,date,date)','EXECUTE')")=='t'
DB='postgres'
q("DROP DATABASE calcproof")
case('pre-4 calculator finalizes already proven parts once, refreshes a complete receipt on a late closed-week source, never computes missing pages in the finalizer, and moves no money')
