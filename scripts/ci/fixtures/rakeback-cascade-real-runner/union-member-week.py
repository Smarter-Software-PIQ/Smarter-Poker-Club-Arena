# Use the disposable paid books board. A standalone book from before the
# union join used to put the member on next week's plan alongside its union.
q("""UPDATE public.union_clubs SET joined_at=rr.ws()-interval '1 day' WHERE club_id=rr.u('O');
INSERT INTO public.union_accounting_runs(standalone_club_id,period_start,period_end,scheduled_at,status,attempts,started_at,finished_at,result)
VALUES(rr.u('O'),rr.ws()-interval '7 days',rr.ws(),rr.ws(),'complete',1,rr.ws(),rr.ws(),'{"success":true,"accounting_version":"3"}');""")
member_plan = "SELECT EXISTS(SELECT FROM jsonb_array_elements(smarter_private.weekly_payout_scope_plan(rr.we(),rr.we()+interval '4 hours')) j WHERE j->>'kind'='club' AND j->>'id'=rr.u('O')::text AND (j->>'period_start')::timestamptz=rr.ws())"
assert one(member_plan)=='t'
migration = R/'supabase/migrations/20261116143103_union_members_play_and_settle_through_the_union.sql'
before_money=one(MONEY)
registry=(R/'supabase/migrations/20260904182847_every_trigger_on_a_money_table_is_declared.sql').read_text()
ddl=re.search(r'CREATE TABLE IF NOT EXISTS public.ca_declared_money_triggers\s*\([\s\S]*?\);',registry,re.I)
assert ddl
q(ddl.group())
extra=json.loads((F/'union-close-relations.json').read_text())
cash_contracts=json.loads((F/'union-close.json').read_text())['functions']
for contract, definition in cash_contracts.items():
    if contract.split('(')[0] in {'public.fn_lightning_table_size_allowed','public.fn_lightning_variant_allowed','public.fn_lightning_template_allowed','public.fn_cash_stake_band','public.fn_cash_game_category_key'}:
        q('SET check_function_bodies=off;'+definition['def']+';')
sequences, tables, defaults, checks, indexes, _, _=world.tables_sql({'public.cash_games':extra['public.cash_games']})
q('SET search_path TO pg_catalog,public;\n'+'\n'.join(sequences+tables+defaults+checks+indexes))
q(migration.read_text())
assert one(member_plan)=='f'
assert one("SELECT NOT smarter_private.standalone_week_belongs_to_union(rr.u('O'),rr.ws()-interval '7 days') AND smarter_private.standalone_week_belongs_to_union(rr.u('O'),rr.ws())")=='t'
assert one(MONEY)==before_money
# Run the existing owner stamps before the new guard, exactly as on production.
stamps=(R/'supabase/migrations/20260820060329_union_law_restore_house_club_stamp_fallback.sql').read_text()
for table, singular in [('tables','table'),('tournaments','tournament')]:
    fn='fn_stamp_'+singular+'_union_ownership'
    start=stamps.index('CREATE OR REPLACE FUNCTION public.'+fn)
    end=stamps.index('END $function$;',start)+len('END $function$;')
    q(stamps[start:end]+f' CREATE TRIGGER trg_{table}_union_ownership BEFORE INSERT ON public.{table} FOR EACH ROW EXECUTE FUNCTION public.{fn}();')
q("INSERT INTO public.clubs(id,name,owner_id,chip_treasury) VALUES(rr.u('U'),'Union house',rr.u('U.boss'),0) ON CONFLICT DO NOTHING;")
game="INSERT INTO public.cash_games(id,club_id,name,template_name,variant,sb,bb,handedness,ruleset_snapshot,enabled,state) VALUES(rr.u('private-game'),rr.u('O'),'Private','classic','nlh',1,2,6,'{}',false,'dormant')"
q(game)
refused=q("UPDATE public.cash_games SET enabled=true WHERE id=rr.u('private-game')",check=False)
assert refused.returncode and 'cannot operate a standalone' in refused.stderr,refused.stderr
for table, fields, values in [('tables',',game_type,f06_lifecycle,cluster_id',",'cash',42,rr.u('private-game')"),('tournaments',',buy_in_amount,buy_in_fee,start_time,ban_chat,max_players',',0,0,rr.we(),false,9')]:
    create=f"INSERT INTO public.{table}(name,club_id,is_private{fields}) VALUES('Ownership fixture',rr.u('O'),{{private}}{values}) RETURNING club_id;"
    private=q(create.format(private='true'),check=False)
    assert private.returncode and 'cannot operate a standalone' in private.stderr,private.stderr
    assert q(create.format(private='false')).stdout.strip()==one("SELECT rr.u('U')")
assert one(MONEY)==before_money
case('member club: old standalone book creates no new weekly round; prior weeks remain eligible; private cash and tournaments refused, public games owned by the union; original money unchanged')
