# Two earned weeks of the same union become payable during one Monday cycle.
# Use a disposable copy of the released real-money fixture and its settings.
settings = q("SELECT unnest(setconfig) FROM pg_db_role_setting WHERE setrole=0 AND setdatabase=(SELECT oid FROM pg_database WHERE datname='postgres')").stdout.splitlines()
q("CREATE DATABASE backlog TEMPLATE postgres;\n" + ''.join(
    f"ALTER DATABASE backlog SET {key}=$cfg${value}$cfg$;\n"
    for key, value in (setting.split('=', 1) for setting in settings)))
DB = 'backlog'
clock('2026-11-29T19:00Z')
q("INSERT INTO public.union_settlement_floor(union_id,earliest_period_start,reason) VALUES(rr.u('U'),rr.we(),'opening week of backlog fixture')")
q("""SELECT rr.hand('T','TQ',20,'2026-11-22T18:00Z');
     SELECT rr.hand('T','TQ',60,'2026-11-29T18:00Z');""")
clock('2026-11-30T09:45Z')
plan = "SELECT jsonb_array_length(smarter_private.weekly_payout_scope_plan(public.fn_union_week_start(now()),now()))"
assert one(plan) == '2', one(plan)
for shard in SHARDS:
    rc, _, error = cron(shard)
    assert rc == 0, error
clock('2026-11-30T10:05Z')
routine = "SELECT smarter_private.weekly_payout_next_round()"
# Both items must qualify. The original incorrectly books one run containing both.
for _ in range(30):
    probe = q("BEGIN; SET LOCAL statement_timeout='1500s'; " + routine + "; ROLLBACK;").stdout.strip()
    if json.loads(probe)['stage'] == 'rounds_booked':
        assert len(json.loads(probe)['scopes']) == 2, probe
        break
    rc, _, error = cron(RUNNER)
    assert rc == 0, error
else:
    raise AssertionError(('two-week preparation did not finish',probe))

q(next((R/'supabase/migrations').glob('20261117002140_*.sql')).read_text())
baseline = one("SELECT count(*) FROM public.rakeback_period_payouts")
sequence = []
for _ in range(15):
    rc, output, error = cron(RUNNER)
    assert rc == 0, error
    if not output:
        break
    event = json.loads(output)
    sequence.append(event['stage'])
    if event['stage'] == 'rounds_booked':
        assert len(event['scopes']) == 1
        assert one(f"""SELECT period_end=(scope_plan->0->>'period_end')::timestamptz
            AND period_start=(scope_plan->0->>'period_start')::timestamptz
            FROM public.weekly_accounting_payout_pauses WHERE run_id='{event["run_id"]}'""") == 't'
        if len(sequence) == 1:
            # The old period remains booked at the next cycle. Its original
            # 20-hour capability cannot be renewed or displaced by a retry.
            q("""BEGIN; SET LOCAL statement_timeout='1500s';
              SELECT set_config('rf.clock_offset',(extract(epoch FROM ('2026-12-01T07:00Z'::timestamptz-pg_catalog.rf_real_clock())))::text||' seconds',true);
              SELECT rr.ok(smarter_private.weekly_payout_next_round()->>'stage'='rounds_booked','unrelated later eligible week can be booked');
              SELECT rr.ok((SELECT count(*)=1 AND bool_and(money_deadline_at<now() AND phase='ready')
                FROM public.weekly_accounting_payout_pauses WHERE period_end='2026-11-23T08:00Z'),'old expired capability not renewed');
              SELECT rr.ok(NOT EXISTS(SELECT FROM smarter_private.weekly_payout_financial_receipts WHERE period_end>rr.we()),'no expired money finalized');
              ROLLBACK;""")
assert sequence == ['rounds_booked','round_paid','round_paid','round_paid','weekly_payout_finalized'] * 2, sequence
assert one(plan) == '0'
case('backlogged union weeks each book, post all three original funding rounds, and release original dated receipts once',
     ok("""(SELECT count(*)=2 AND bool_and(jsonb_array_length(original_round_receipts)=3)
       FROM smarter_private.weekly_payout_financial_receipts WHERE scope_id=rr.u('U') AND period_end>rr.we())""", 'two dated originals')
     + ok("""(SELECT array_agg(p.payout_amount ORDER BY rp.period_start)=ARRAY[2.00,6.00]::numeric[]
       FROM public.rakeback_period_payouts p JOIN public.rakeback_periods rp ON rp.id=p.rakeback_period_id
       WHERE rp.period_start>=DATE '2026-11-16' AND rp.user_id=rr.u('TQ'))""", 'distinct weekly credits')
     + ok("""(SELECT count(*)=2 AND bool_and(p.phase='released' AND p.scope_plan @>
           jsonb_build_array(jsonb_build_object('kind',r.scope_kind,'id',r.scope_id)))
       FROM smarter_private.weekly_payout_financial_receipts r JOIN public.weekly_accounting_payout_pauses p
         ON p.run_id=r.run_id AND p.period_start=r.period_start AND p.period_end=r.period_end
       WHERE r.scope_id=rr.u('U') AND r.period_end>rr.we())""", 'document delivery joins match both actual earned weeks')
     + ok(f"(SELECT count(*)={int(baseline)+2} FROM public.rakeback_period_payouts)", 'no duplicate credit'))
DB = 'postgres'
q("DROP DATABASE backlog")
