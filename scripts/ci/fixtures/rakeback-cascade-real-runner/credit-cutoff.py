# Fork the partly paid board. Move the next week's line after the Sunday cutoff.
settings=q("SELECT unnest(setconfig) FROM pg_db_role_setting WHERE setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database()) AND setrole=0").stdout.splitlines()
q("CREATE DATABASE credit_cutoff TEMPLATE postgres")
try:
    for setting in settings:
        name,value=setting.split('=',1)
        q("ALTER DATABASE credit_cutoff SET "+name+" TO "+(value if name=='search_path' else "$v$"+value+"$v$"))
    DB='credit_cutoff'
    q(next((R/'supabase/migrations').glob('20261116152718_*.sql')).read_text())
    clock('2026-11-22 23:00:00+00')
    q("UPDATE public.agents SET is_prepaid=false,credit_limit=100 WHERE user_id=rr.u('SA');")
    clock('2026-11-23 09:00:00+00')
    # A genuine club transfer changes the wallet after Sunday midnight.
    q('BEGIN;'+LOAD_DEBIT+AS_TOWNER+"SELECT public.fn_club_bank_send_core_20261004(rr.u('T'),rr.u('SA'),1,'agent_wallet','cutoff fixture',rr.u('op-cutoff-credit')); COMMIT;")
    assert one("SELECT rr.wallet('T','SA')=55")=='t'
    q("UPDATE public.agents SET credit_limit=150 WHERE user_id=rr.u('SA'); UPDATE public.agents SET credit_limit=175 WHERE user_id=rr.u('SA'); UPDATE public.agents SET is_prepaid=false,credit_limit=100 WHERE user_id=rr.u('AG');")
    assert one("SELECT credit_line=100 FROM smarter_private.agent_credit_cutoff k JOIN public.agents a ON a.id=k.agent_id WHERE a.user_id=rr.u('SA') AND k.period_end='2026-11-23 08:00Z'")=='t'
    q("SELECT public.fn_capture_agent_credit_week(ARRAY[rr.u('T')],rr.we(),'2026-11-23 08:00Z','union',rr.u('U'));")
    assert one("SELECT count(*)=1 AND bool_and(b.credit_line=100 AND b.agent_wallet_before_rakeback=54 AND b.amount_owed=46 AND a.user_id=rr.u('SA')) FROM public.agent_credit_weekly_basis b JOIN public.agents a ON a.id=b.agent_id WHERE b.period_end='2026-11-23 08:00Z'")=='t'
    case('Pacific cutoff: use Sunday closing terms and wallet through two subsequent line changes; a line first assigned after midnight receives no bill for the closed week')
finally:
    DB='postgres'
    q("DROP DATABASE credit_cutoff")
