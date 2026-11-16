-- Legacy and pre-union Club Data use Pacific calendar days, from original
-- event timestamps. UTC/Chicago projections, money and commission contracts stay
-- intact. History is proved against UTC controls, never redated by last_at.
-- Explicit finite loader only. Incomplete history refuses a Data read.
-- @live-proof: to_regclass('public.ca_club_data_pacific_fact') IS NOT NULL
-- @live-proof: public.fn_ca_club_data_pacific_day('2026-11-01T07:30:00Z'::timestamptz) = DATE '2026-11-01'
-- @live-proof: position('_pacific_basis' IN pg_get_functiondef('public.ca_club_data_screen(uuid,date,date,text,text,text,integer)'::regprocedure)) > 0
-- @live-proof: to_regprocedure('public.ca_rake_snapshot_pacific_v2(text,uuid,uuid,date,date,uuid,integer,integer,text,text)') IS NOT NULL
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '60s';
-- Mutually referring private reader copies are validated by the retained
-- native PostgreSQL qualification after every copy has been installed.
SET LOCAL check_function_bodies = false;
DO $preimage$ BEGIN
 IF md5(pg_get_functiondef('public.fn_ca_club_data_fact_put(uuid,date,text,uuid,uuid,numeric,numeric,numeric,numeric,timestamptz)'::regprocedure)) <> '319564fc56bc1433848a2b2f88fa2006'
 OR md5(pg_get_functiondef('public.fn_ca_club_data_hand_put(uuid,uuid,timestamptz)'::regprocedure)) <> '0fd6f3eb99fd684b9a7704e0fff54bb7' THEN
  RAISE EXCEPTION 'PACIFIC_DATA_WRITER_PREIMAGE_CHANGED';
 END IF;
END $preimage$;
CREATE FUNCTION public.fn_ca_club_data_pacific_day(p_at timestamptz) RETURNS date
 LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=public AS $$ SELECT (p_at AT TIME ZONE 'America/Los_Angeles')::date $$;
CREATE FUNCTION public.fn_ca_club_data_pacific_day_start(p_day date) RETURNS timestamptz
 LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=public AS $$ SELECT p_day::timestamp AT TIME ZONE 'America/Los_Angeles' $$;
CREATE TABLE public.ca_club_data_pacific_state (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), attached_at timestamptz NOT NULL,
 history_through date NOT NULL, facts_from date NOT NULL, attachment_xid xid NOT NULL
);
INSERT INTO public.ca_club_data_pacific_state VALUES(true,clock_timestamp(),(now() AT TIME ZONE 'UTC')::date,public.fn_ca_club_data_facts_from(),pg_current_xact_id()::text::xid);
CREATE TABLE public.ca_club_data_pacific_fact (
 club_id uuid NOT NULL, utc_day date NOT NULL, stat_date date NOT NULL,
 kind text NOT NULL CHECK(kind IN ('CASH','TOURNAMENT')), game_id uuid NOT NULL, user_id uuid NOT NULL,
 fee numeric NOT NULL DEFAULT 0, buyins numeric NOT NULL DEFAULT 0, cashouts numeric NOT NULL DEFAULT 0,
 winnings numeric NOT NULL DEFAULT 0, last_at timestamptz NOT NULL,
 src smallint NOT NULL CHECK(src IN(0,1)), legacy_recorded boolean NOT NULL DEFAULT true,
 hands bigint NOT NULL DEFAULT 0,
 PRIMARY KEY(club_id,stat_date,game_id,user_id,utc_day,src,legacy_recorded)
);
CREATE INDEX ca_club_data_pacific_fact_utc_idx ON public.ca_club_data_pacific_fact(utc_day,src);
CREATE TABLE public.ca_club_data_pacific_journal (LIKE public.ca_club_data_pacific_fact INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
CREATE INDEX ca_club_data_pacific_journal_read_idx ON public.ca_club_data_pacific_journal(club_id,stat_date,game_id);
CREATE INDEX ca_club_data_pacific_journal_utc_idx ON public.ca_club_data_pacific_journal(utc_day);
CREATE TABLE public.ca_club_data_pacific_hands (
 club_id uuid NOT NULL, utc_day date NOT NULL, stat_date date NOT NULL, table_id uuid NOT NULL,
 hands bigint NOT NULL, src smallint NOT NULL CHECK(src IN(0,1)),
 PRIMARY KEY(club_id,stat_date,table_id,utc_day,src)
);
CREATE TABLE public.ca_club_data_pacific_hands_journal (LIKE public.ca_club_data_pacific_hands INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
CREATE INDEX ca_club_data_pacific_hands_journal_read_idx ON public.ca_club_data_pacific_hands_journal(club_id,stat_date,table_id);
CREATE TABLE public.ca_club_data_pacific_seed_log(utc_day date PRIMARY KEY, seeded_at timestamptz NOT NULL DEFAULT now(), facts bigint NOT NULL,hands bigint NOT NULL);
CREATE TABLE public.ca_club_data_pacific_failures(club_id uuid, utc_day date NOT NULL, source text NOT NULL, detail text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX ca_club_data_pacific_failures_read_idx ON public.ca_club_data_pacific_failures(utc_day,club_id);
ALTER TABLE public.ca_club_data_pacific_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_club_data_pacific_state FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE public.ca_club_data_pacific_fact ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_club_data_pacific_fact FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE public.ca_club_data_pacific_journal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_club_data_pacific_journal FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE public.ca_club_data_pacific_hands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_club_data_pacific_hands FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE public.ca_club_data_pacific_hands_journal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_club_data_pacific_hands_journal FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE public.ca_club_data_pacific_seed_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_club_data_pacific_seed_log FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE public.ca_club_data_pacific_failures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_club_data_pacific_failures FROM PUBLIC,anon,authenticated,service_role;
CREATE VIEW public.ca_club_data_pacific_fact_ct WITH(security_invoker=true) AS
 SELECT club_id,stat_date,min(kind) kind,game_id,user_id,sum(fee) fee,sum(buyins) buyins,sum(cashouts) cashouts,
 sum(winnings) winnings,max(last_at) last_at,src,sum(hands)::bigint hands FROM (
 SELECT * FROM public.ca_club_data_pacific_fact UNION ALL SELECT * FROM public.ca_club_data_pacific_journal) f
 GROUP BY club_id,stat_date,game_id,user_id,src;
CREATE VIEW public.ca_club_data_pacific_game_ct WITH(security_invoker=true) AS
 SELECT club_id,stat_date,min(kind) kind,game_id,sum(fee) fee,sum(buyins) buyins,sum(cashouts) cashouts,sum(winnings) winnings,max(last_at) last_at,src
 FROM public.ca_club_data_pacific_fact_ct GROUP BY club_id,stat_date,game_id,src;
CREATE VIEW public.ca_club_data_pacific_hands_ct WITH(security_invoker=true) AS
 SELECT club_id,stat_date,table_id,sum(hands)::bigint hands,src FROM (
 SELECT * FROM public.ca_club_data_pacific_hands UNION ALL SELECT * FROM public.ca_club_data_pacific_hands_journal) h
 GROUP BY club_id,stat_date,table_id,src;
CREATE FUNCTION public.fn_ca_club_data_pacific_fact_window(p_clubs uuid[],p_from date,p_through date)
 RETURNS SETOF public.ca_club_data_pacific_fact_ct LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT * FROM public.ca_club_data_pacific_fact_ct WHERE club_id=ANY(p_clubs) AND stat_date BETWEEN p_from AND p_through $$;
-- Same bounded aggregate owner/journal pattern as the qualified accounting
-- model. The lock is try-only; a second writer appends instead of waiting.
CREATE FUNCTION public.fn_ca_club_data_pacific_own(p_key text) RETURNS boolean LANGUAGE plpgsql SET search_path=public AS $$
DECLARE n int:=coalesce(nullif(current_setting('ca.pacific_locks',true),''),'0')::int;
BEGIN
 IF n>=32 THEN RETURN false; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('ca-data-pacific:'||p_key,0)) THEN RETURN false; END IF;
 PERFORM set_config('ca.pacific_locks',(n+1)::text,true); RETURN true;
END $$;
-- Keep byte-identical original writers private; only their public entry point
-- gains a report projection. No existing money trigger or financial rule moves.
DO $copy$ DECLARE d text; BEGIN
 d:=pg_get_functiondef('public.fn_ca_club_data_fact_put(uuid,date,text,uuid,uuid,numeric,numeric,numeric,numeric,timestamptz)'::regprocedure);
 EXECUTE replace(d,'FUNCTION public.fn_ca_club_data_fact_put(','FUNCTION public.fn_ca_club_data_fact_put_pre_pacific(');
 d:=pg_get_functiondef('public.fn_ca_club_data_hand_put(uuid,uuid,timestamptz)'::regprocedure);
 EXECUTE replace(d,'FUNCTION public.fn_ca_club_data_hand_put(','FUNCTION public.fn_ca_club_data_hand_put_pre_pacific(');
END $copy$;
REVOKE ALL ON FUNCTION public.fn_ca_club_data_fact_put_pre_pacific(uuid,date,text,uuid,uuid,numeric,numeric,numeric,numeric,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_ca_club_data_hand_put_pre_pacific(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.fn_ca_club_data_fact_put(p_club uuid,p_day date,p_kind text,p_game uuid,p_user uuid,p_fee numeric,p_buyins numeric,p_cashouts numeric,p_winnings numeric,p_at timestamptz)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ok boolean:=true; d date; a timestamptz:=coalesce(p_at,now()); u uuid:=coalesce(p_user,'00000000-0000-0000-0000-000000000000');
BEGIN
 BEGIN
  PERFORM public.fn_ca_club_data_fact_put_pre_pacific(p_club,p_day,p_kind,p_game,p_user,p_fee,p_buyins,p_cashouts,p_winnings,p_at);
 EXCEPTION WHEN OTHERS THEN
  ok:=false;
  RAISE WARNING 'legacy Club Data projection: % %',SQLSTATE,SQLERRM;
 END;
 d:=public.fn_ca_club_data_pacific_day(a);
 BEGIN
 IF public.fn_ca_club_data_pacific_own('f:'||p_club||':'||p_day||':'||d||':'||p_game||':'||u||':'||ok) THEN
  INSERT INTO public.ca_club_data_pacific_fact AS f VALUES(p_club,p_day,d,p_kind,p_game,u,coalesce(p_fee,0),coalesce(p_buyins,0),coalesce(p_cashouts,0),coalesce(p_winnings,0),a,0,ok,CASE WHEN p_kind='CASH' AND p_fee>0 THEN 1 ELSE 0 END)
  ON CONFLICT(club_id,stat_date,game_id,user_id,utc_day,src,legacy_recorded) DO UPDATE SET
   fee=f.fee+EXCLUDED.fee,buyins=f.buyins+EXCLUDED.buyins,cashouts=f.cashouts+EXCLUDED.cashouts,winnings=f.winnings+EXCLUDED.winnings,last_at=greatest(f.last_at,EXCLUDED.last_at),hands=f.hands+EXCLUDED.hands;
 ELSE
  INSERT INTO public.ca_club_data_pacific_journal VALUES(p_club,p_day,d,p_kind,p_game,u,coalesce(p_fee,0),coalesce(p_buyins,0),coalesce(p_cashouts,0),coalesce(p_winnings,0),a,0,ok,CASE WHEN p_kind='CASH' AND p_fee>0 THEN 1 ELSE 0 END);
 END IF;
 EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.ca_club_data_pacific_failures(club_id,utc_day,source,detail) VALUES(p_club,p_day,'live_fact',SQLSTATE||':'||SQLERRM);
  RAISE WARNING 'Pacific Club Data projection: % %',SQLSTATE,SQLERRM;
 END;
END $$;
CREATE OR REPLACE FUNCTION public.fn_ca_club_data_hand_put(p_club uuid,p_table uuid,p_at timestamptz)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d date:=public.fn_ca_club_data_pacific_day(p_at); u date:=(p_at AT TIME ZONE 'UTC')::date;
BEGIN
 BEGIN PERFORM public.fn_ca_club_data_hand_put_pre_pacific(p_club,p_table,p_at);
 EXCEPTION WHEN OTHERS THEN RAISE WARNING 'legacy hand projection: % %',SQLSTATE,SQLERRM; END;
 IF p_club IS NULL OR p_table IS NULL OR p_at IS NULL THEN RETURN; END IF;
 BEGIN
 IF public.fn_ca_club_data_pacific_own('h:'||p_club||':'||u||':'||d||':'||p_table) THEN
  INSERT INTO public.ca_club_data_pacific_hands AS h VALUES(p_club,u,d,p_table,1,0)
  ON CONFLICT(club_id,stat_date,table_id,utc_day,src) DO UPDATE SET hands=h.hands+1;
 ELSE INSERT INTO public.ca_club_data_pacific_hands_journal VALUES(p_club,u,d,p_table,1,0);
 END IF;
 EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.ca_club_data_pacific_failures(club_id,utc_day,source,detail) VALUES(p_club,u,'live_hand',SQLSTATE||':'||SQLERRM);
  RAISE WARNING 'Pacific hand projection: % %',SQLSTATE,SQLERRM;
 END;
END $$;
-- A historical wallet owner must be unique among the original matching
-- ledger legs. Preserve the existing exact-table preference, refuse ties;
-- never pick an arbitrary LIMIT 1 or a current club membership.
CREATE FUNCTION public.fn_ca_club_data_pacific_leg_club(p_user uuid,p_amount numeric,p_type text,p_at timestamptz,p_table uuid) RETURNS uuid
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH candidates AS MATERIALIZED(
  SELECT cl.club_id,(cl.table_id IS NOT DISTINCT FROM p_table)::int priority FROM public.chip_ledger cl
  WHERE cl.created_at=p_at AND cl.amount=p_amount AND cl.club_id IS NOT NULL
   AND ((p_type='debit' AND cl.from_entity_id=p_user AND cl.from_type='player_wallet')
     OR (p_type='credit' AND cl.to_entity_id=p_user AND cl.to_type='player_wallet'))
   AND (p_table IS NULL OR cl.table_id IS NULL OR cl.table_id=p_table)
 ) SELECT CASE WHEN count(DISTINCT club_id)=1 THEN min(club_id::text)::uuid END FROM candidates
 WHERE priority=(SELECT max(priority) FROM candidates)
 $$;
-- One UTC source day, one bounded repeatable snapshot. The timestamped source
-- reconstruction must reconcile EVERY original club/game/player control. A
-- failed club gets no seeded rows and remains visibly unavailable. No clipping,
-- current membership, or aggregate-last-activity date can supply evidence.
CREATE FUNCTION public.fn_ca_club_data_pacific_seed(p_day date,p_rebuild boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE lo timestamptz:=p_day::timestamp AT TIME ZONE 'UTC'; hi timestamptz:=(p_day+1)::timestamp AT TIME ZONE 'UTC';
 v_rows bigint; v_hands bigint; v_failed bigint;
BEGIN
 IF current_user NOT IN('postgres','supabase_admin') THEN RAISE EXCEPTION 'PACIFIC_DATA_SEED_INSTALLER_ONLY'; END IF;
 IF current_setting('transaction_isolation')<>'repeatable read' THEN RAISE EXCEPTION 'PACIFIC_DATA_SEED_REQUIRES_REPEATABLE_READ'; END IF;
 IF p_day IS NULL OR p_day<(SELECT facts_from FROM public.ca_club_data_pacific_state)
 OR p_day>(now() AT TIME ZONE 'UTC')::date THEN RAISE EXCEPTION 'PACIFIC_DATA_SEED_OUTSIDE_RETAINED_HISTORY'; END IF;
 -- A pre-install reader/producer snapshot could still be executing the old
 -- function body. Refuse history admission until those exact transactions
 -- have ended; no timer, source lock or synthetic financial transaction.
 IF EXISTS(SELECT 1 FROM pg_stat_activity a CROSS JOIN public.ca_club_data_pacific_state s
 WHERE a.pid<>pg_backend_pid() AND a.datname=current_database()
 AND ((a.backend_xmin IS NOT NULL AND age(a.backend_xmin)>=age(s.attachment_xid))
 OR (a.backend_xid IS NOT NULL AND age(a.backend_xid)>=age(s.attachment_xid)))) THEN
  RAISE EXCEPTION 'PACIFIC_DATA_SEED_PREATTACHMENT_TRANSACTION_STILL_OPEN';
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('ca-data-pacific:seed',0)) THEN RAISE EXCEPTION 'PACIFIC_DATA_SEED_ALREADY_RUNNING'; END IF;
 IF EXISTS(SELECT 1 FROM public.ca_club_data_pacific_seed_log WHERE utc_day=p_day) AND NOT p_rebuild THEN
  RETURN jsonb_build_object('utc_day',p_day,'already_loaded',true);
 END IF;
 CREATE TEMP TABLE ca_pacific_control ON COMMIT DROP AS
 SELECT club_id,kind,game_id,user_id,sum(fee) fee,sum(buyins) bi,sum(cashouts) co,sum(winnings) win
 FROM (
 SELECT club_id,kind,game_id,user_id,fee,buyins,cashouts,winnings FROM public.ca_club_data_fact WHERE stat_date=p_day
 UNION ALL SELECT club_id,kind,game_id,user_id,fee,buyins,cashouts,winnings FROM public.ca_club_data_pacific_fact WHERE utc_day=p_day AND src=0 AND NOT legacy_recorded
 UNION ALL SELECT club_id,kind,game_id,user_id,fee,buyins,cashouts,winnings FROM public.ca_club_data_pacific_journal WHERE utc_day=p_day AND NOT legacy_recorded
 ) x GROUP BY club_id,kind,game_id,user_id;
 CREATE INDEX ON ca_pacific_control(game_id,user_id);
 CREATE TEMP TABLE ca_pacific_events ON COMMIT DROP AS
 WITH fk AS MATERIALIZED (
  SELECT game_id g,user_id u,CASE WHEN count(DISTINCT club_id)=1 THEN min(club_id::text)::uuid END club
  FROM ca_pacific_control GROUP BY game_id,user_id
 ), rc AS MATERIALIZED (
  SELECT r.id,r.table_id g,r.rake_amount ra,r.created_at at,
   CASE WHEN jsonb_typeof(r.player_contributions)='object' THEN r.player_contributions ELSE '{}'::jsonb END pc
  FROM public.rake_records r JOIN public.tables t ON t.id=r.table_id AND t.tournament_id IS NULL
  WHERE r.created_at>=lo AND r.created_at<hi AND r.rake_amount>0 AND r.tournament_id IS NULL AND NOT coalesce(r.is_tournament,false)
 ), rce AS MATERIALIZED (
  SELECT rc.id,rc.g,rc.ra,rc.at,x.key::uuid u,(CASE WHEN x.value~'^[0-9]+(\.[0-9]+)?$' THEN x.value::numeric ELSE 0 END) c
  FROM rc CROSS JOIN LATERAL jsonb_each_text(rc.pc) x
  WHERE x.key~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND (CASE WHEN x.value~'^[0-9]+(\.[0-9]+)?$' THEN x.value::numeric ELSE 0 END)>0
 ), cash AS (
  SELECT s.id hid,'CASH'::text kind,s.g,s.u,s.at,s.ra*s.c/sum(s.c) OVER(PARTITION BY s.id) fee,0::numeric bi,0::numeric co
  FROM rce s
  UNION ALL
  SELECT rc.id,'CASH',rc.g,'00000000-0000-0000-0000-000000000000'::uuid,rc.at,rc.ra,0,0 FROM rc WHERE NOT EXISTS(SELECT 1 FROM rce s WHERE s.id=rc.id)
 ), named AS (
  SELECT r.id,'TOURNAMENT'::text,r.tournament_id,(r.metadata->>'user_id')::uuid,r.created_at,r.rake_amount,0::numeric,0::numeric
  FROM public.rake_records r WHERE r.created_at>=lo AND r.created_at<hi AND r.is_tournament AND r.tournament_id IS NOT NULL AND r.rake_amount<>0
  AND (r.metadata->>'user_id')~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
 ), unnamed AS (
  -- Original fee receipts directly linked to this recognition record prove
  -- each player/club share. charged_at is not the legacy recognition instant;
  -- all these rows retain the original rake record's created_at.
  SELECT r.id,'TOURNAMENT'::text,r.tournament_id,f.player_id,r.created_at,f.rake_credit,0::numeric,0::numeric,f.club_id
  FROM public.rake_records r JOIN public.accounting_tournament_fee_sources f ON f.rake_record_id=r.id
  WHERE r.created_at>=lo AND r.created_at<hi AND r.is_tournament AND r.tournament_id IS NOT NULL AND r.rake_amount<>0
  AND NOT ((r.metadata->>'user_id')~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') IS TRUE
  UNION ALL
  SELECT r.id,'TOURNAMENT',r.tournament_id,ra.player_id,r.created_at,ra.rake_amount,0::numeric,0::numeric,ra.club_id
  FROM public.rake_records r JOIN public.rake_attributions ra ON ra.rake_record_id=r.id
  WHERE r.created_at>=lo AND r.created_at<hi AND r.is_tournament AND r.tournament_id IS NOT NULL AND r.rake_amount<>0
  AND NOT EXISTS(SELECT 1 FROM public.accounting_tournament_fee_sources f WHERE f.rake_record_id=r.id)
  AND NOT ((r.metadata->>'user_id')~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') IS TRUE
 ), wal AS (
  SELECT NULL::uuid hid,CASE WHEN x.table_id IS NULL THEN 'TOURNAMENT' ELSE 'CASH' END kind,
   coalesce(x.table_id,x.related_entity_id) g,x.user_id u,x.created_at at,0::numeric fee,
   CASE WHEN x.type='debit' THEN x.amount ELSE 0 END bi,CASE WHEN x.type='credit' THEN x.amount ELSE 0 END co
  FROM public.wallet_transactions x
  WHERE x.created_at>=lo AND x.created_at<hi AND (
   (x.table_id IS NOT NULL AND x.category IN('buyin','cashout','addon','rebuy','refund') AND EXISTS(SELECT 1 FROM public.tables t WHERE t.id=x.table_id AND t.tournament_id IS NULL))
   OR (x.table_id IS NULL AND x.related_entity_id IS NOT NULL AND x.category IN('tournament_buyin','prize','bounty','addon','rebuy','refund','prize_reversal') AND EXISTS(SELECT 1 FROM public.tournaments t WHERE t.id=x.related_entity_id)))
 ), ev AS(SELECT cash.*,NULL::uuid original_club FROM cash UNION ALL SELECT named.*,NULL::uuid FROM named UNION ALL SELECT * FROM unnamed UNION ALL SELECT wal.*,NULL::uuid FROM wal)
 SELECT ev.*,coalesce(ev.original_club,fk.club,
  (SELECT CASE WHEN count(DISTINCT ra.club_id)=1 THEN min(ra.club_id::text)::uuid END FROM public.rake_attributions ra WHERE ra.rake_record_id=ev.hid AND ra.player_id=ev.u),
  CASE WHEN ev.hid IS NULL AND (ev.bi<>0 OR ev.co<>0) THEN public.fn_ca_club_data_pacific_leg_club(ev.u,greatest(ev.bi,ev.co),CASE WHEN ev.bi<>0 THEN 'debit' ELSE 'credit' END,ev.at,CASE WHEN ev.kind='CASH' THEN ev.g END) END) club,
 public.fn_ca_club_data_pacific_day(ev.at) stat_date FROM ev LEFT JOIN fk ON fk.g=ev.g AND fk.u=ev.u;
 -- Unknown or incomplete source witnesses fail only clubs potentially
 -- affected by original controls or source game ownership. An unrelated union
 -- event must never turn an otherwise proven standalone window unavailable.
 DELETE FROM public.ca_club_data_pacific_failures WHERE utc_day=p_day AND source='history';
 CREATE TEMP TABLE ca_pacific_unproven ON COMMIT DROP AS
 SELECT e.g,e.u,e.at,e.original_club FROM ca_pacific_events e WHERE e.club IS NULL
 UNION
 SELECT r.tournament_id,NULL::uuid,r.created_at,NULL::uuid FROM public.rake_records r
 LEFT JOIN LATERAL(SELECT sum(f.rake_credit) amount,count(*) n FROM public.accounting_tournament_fee_sources f WHERE f.rake_record_id=r.id) direct ON true
 LEFT JOIN LATERAL(SELECT sum(ra.rake_amount) amount,count(*) n FROM public.rake_attributions ra WHERE ra.rake_record_id=r.id) attr ON direct.n=0
 WHERE r.created_at>=lo AND r.created_at<hi AND r.is_tournament AND r.tournament_id IS NOT NULL AND r.rake_amount<>0
 AND NOT ((r.metadata->>'user_id')~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') IS TRUE
 AND (CASE WHEN direct.n>0 THEN direct.amount ELSE attr.amount END) IS DISTINCT FROM r.rake_amount;
 CREATE TEMP TABLE ca_pacific_potential ON COMMIT DROP AS
 SELECT DISTINCT e.g,e.at,p.club_id FROM ca_pacific_unproven e CROSS JOIN LATERAL(
  SELECT c.club_id FROM ca_pacific_control c WHERE c.game_id=e.g
   AND (e.u IS NULL OR c.user_id=e.u OR NOT EXISTS(SELECT 1 FROM ca_pacific_control u WHERE u.game_id=e.g AND u.user_id=e.u))
  UNION SELECT e.original_club WHERE e.original_club IS NOT NULL
  UNION SELECT t.club_id FROM public.tables t WHERE t.id=e.g AND t.club_id IS NOT NULL
  UNION SELECT t.club_id FROM public.tournaments t WHERE t.id=e.g AND t.club_id IS NOT NULL
  UNION SELECT f.club_id FROM public.accounting_tournament_fee_sources f JOIN public.rake_records r ON r.id=f.rake_record_id
   WHERE r.tournament_id=e.g AND r.created_at>=lo AND r.created_at<hi AND f.club_id IS NOT NULL
 )p;
 INSERT INTO public.ca_club_data_pacific_failures(club_id,utc_day,source,detail)
 WITH cut AS MATERIALIZED(SELECT DISTINCT club_id,public.fn_ca_launch_accounting_cutoff('club',club_id) at FROM ca_pacific_potential)
 SELECT DISTINCT p.club_id,p_day,'history','Original source ownership or per-record fee receipts are incomplete'
 FROM ca_pacific_potential p JOIN cut USING(club_id) WHERE cut.at IS NULL OR p.at>=cut.at;
 CREATE TEMP TABLE ca_pacific_accepted ON COMMIT DROP AS
 WITH cut AS MATERIALIZED(SELECT DISTINCT club,public.fn_ca_launch_accounting_cutoff('club',club) cutoff FROM ca_pacific_events WHERE club IS NOT NULL)
 SELECT e.* FROM ca_pacific_events e JOIN cut USING(club) WHERE cut.cutoff IS NULL OR e.at>=cut.cutoff;
 CREATE TEMP TABLE ca_pacific_bad(club_id uuid PRIMARY KEY) ON COMMIT DROP;
 INSERT INTO ca_pacific_bad SELECT DISTINCT club_id FROM public.ca_club_data_pacific_failures WHERE utc_day=p_day AND source='history';
 INSERT INTO ca_pacific_bad
 WITH e AS(SELECT club,kind,g,u,sum(fee) fee,sum(bi) bi,sum(co) co,sum(co-bi) win FROM ca_pacific_accepted GROUP BY club,kind,g,u)
 SELECT DISTINCT coalesce(e.club,c.club_id) FROM e FULL JOIN ca_pacific_control c ON c.club_id=e.club AND c.kind=e.kind AND c.game_id=e.g AND c.user_id=e.u
 WHERE coalesce(e.fee,0)<>coalesce(c.fee,0) OR coalesce(e.bi,0)<>coalesce(c.bi,0) OR coalesce(e.co,0)<>coalesce(c.co,0) OR coalesce(e.win,0)<>coalesce(c.win,0) ON CONFLICT DO NOTHING;
 INSERT INTO public.ca_club_data_pacific_failures(club_id,utc_day,source,detail) SELECT club_id,p_day,'history','Timestamped source sums do not exactly reconcile original UTC key controls' FROM ca_pacific_bad;
 -- Count original source hands once per recorded club and rake record; compare
 -- to original UTC hand controls before exposing any historical report.
 CREATE TEMP TABLE ca_pacific_hand_source ON COMMIT DROP AS
 SELECT club,stat_date,g,count(DISTINCT hid)::bigint hands FROM ca_pacific_accepted WHERE kind='CASH' AND hid IS NOT NULL GROUP BY club,stat_date,g;
 INSERT INTO ca_pacific_bad
 WITH h AS(SELECT club,g,sum(hands) hands FROM ca_pacific_hand_source GROUP BY club,g)
 SELECT DISTINCT coalesce(h.club,c.club_id) FROM h FULL JOIN (SELECT * FROM public.club_table_daily WHERE stat_date=p_day) c ON c.club_id=h.club AND c.table_id=h.g AND c.stat_date=p_day
 WHERE (c.stat_date=p_day OR c.club_id IS NULL) AND coalesce(h.hands,0)<>coalesce(c.hands,0) ON CONFLICT DO NOTHING;
 INSERT INTO public.ca_club_data_pacific_failures(club_id,utc_day,source,detail) SELECT club_id,p_day,'history','Original UTC fact/hand evidence incomplete' FROM ca_pacific_bad b WHERE NOT EXISTS(SELECT 1 FROM public.ca_club_data_pacific_failures f WHERE f.utc_day=p_day AND f.club_id=b.club_id AND f.source='history');
 DELETE FROM public.ca_club_data_pacific_fact WHERE utc_day=p_day AND src=1;
 DELETE FROM public.ca_club_data_pacific_hands WHERE utc_day=p_day AND src=1;
 IF NOT EXISTS(SELECT 1 FROM public.ca_club_data_pacific_failures WHERE utc_day=p_day AND club_id IS NULL) THEN
  INSERT INTO public.ca_club_data_pacific_fact
  WITH source AS(
   SELECT club,stat_date,min(kind) kind,g,u,sum(fee) fee,sum(bi) bi,sum(co) co,sum(co-bi) win,max(at) at,count(DISTINCT hid)::bigint hands FROM ca_pacific_accepted GROUP BY club,stat_date,g,u),
  live AS(SELECT club_id,stat_date,game_id,user_id,min(kind) kind,sum(fee) fee,sum(buyins) bi,sum(cashouts) co,sum(winnings) win,max(last_at) at,sum(hands)::bigint hands FROM(
   SELECT * FROM public.ca_club_data_pacific_fact WHERE utc_day=p_day AND src=0 UNION ALL SELECT * FROM public.ca_club_data_pacific_journal WHERE utc_day=p_day) l GROUP BY club_id,stat_date,game_id,user_id)
  SELECT coalesce(s.club,l.club_id),p_day,coalesce(s.stat_date,l.stat_date),coalesce(s.kind,l.kind),coalesce(s.g,l.game_id),coalesce(s.u,l.user_id),
   coalesce(s.fee,0)-coalesce(l.fee,0),coalesce(s.bi,0)-coalesce(l.bi,0),coalesce(s.co,0)-coalesce(l.co,0),coalesce(s.win,0)-coalesce(l.win,0),greatest(s.at,l.at),1,true,coalesce(s.hands,0)-coalesce(l.hands,0)
  FROM source s FULL JOIN live l ON l.club_id=s.club AND l.stat_date=s.stat_date AND l.game_id=s.g AND l.user_id=s.u
  WHERE NOT EXISTS(SELECT 1 FROM ca_pacific_bad b WHERE b.club_id=coalesce(s.club,l.club_id));
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  INSERT INTO public.ca_club_data_pacific_hands
  WITH live AS(SELECT club_id,stat_date,table_id,sum(hands)::bigint hands FROM(
   SELECT * FROM public.ca_club_data_pacific_hands WHERE utc_day=p_day AND src=0 UNION ALL SELECT * FROM public.ca_club_data_pacific_hands_journal WHERE utc_day=p_day) l GROUP BY club_id,stat_date,table_id)
  SELECT coalesce(s.club,l.club_id),p_day,coalesce(s.stat_date,l.stat_date),coalesce(s.g,l.table_id),coalesce(s.hands,0)-coalesce(l.hands,0),1
  FROM ca_pacific_hand_source s FULL JOIN live l ON l.club_id=s.club AND l.stat_date=s.stat_date AND l.table_id=s.g
  WHERE NOT EXISTS(SELECT 1 FROM ca_pacific_bad b WHERE b.club_id=coalesce(s.club,l.club_id));
  GET DIAGNOSTICS v_hands=ROW_COUNT;
 END IF;
 -- Only a complete source witness may retire visible live-projection errors.
 -- Concurrent later failures are outside this snapshot and cannot be deleted.
 IF NOT EXISTS(SELECT 1 FROM public.ca_club_data_pacific_failures WHERE utc_day=p_day AND club_id IS NULL) THEN
  DELETE FROM public.ca_club_data_pacific_failures f WHERE f.utc_day=p_day AND f.source IN('live_fact','live_hand')
  AND NOT EXISTS(SELECT 1 FROM ca_pacific_bad b WHERE b.club_id=f.club_id);
 END IF;
 INSERT INTO public.ca_club_data_pacific_seed_log VALUES(p_day,clock_timestamp(),coalesce(v_rows,0),coalesce(v_hands,0)) ON CONFLICT(utc_day) DO UPDATE SET seeded_at=EXCLUDED.seeded_at,facts=EXCLUDED.facts,hands=EXCLUDED.hands;
 SELECT count(*) INTO v_failed FROM public.ca_club_data_pacific_failures WHERE utc_day=p_day;
 RETURN jsonb_build_object('utc_day',p_day,'facts',coalesce(v_rows,0),'hands',coalesce(v_hands,0),'failures',v_failed,'complete',v_failed=0);
END $$;
CREATE FUNCTION public.fn_ca_club_data_pacific_require(p_club uuid,p_from date,p_to date,p_max_days integer DEFAULT 93) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE a date:=coalesce(p_from,public.fn_ca_club_data_pacific_day(now())); b date:=least(coalesce(p_to,public.fn_ca_club_data_pacific_day(now())),public.fn_ca_club_data_pacific_day(now()));
BEGIN
 IF public.fn_ca_club_data_scope(p_club) IS NULL THEN RAISE EXCEPTION 'not authorized for this club' USING ERRCODE='42501'; END IF;
 IF a>b OR p_max_days NOT BETWEEN 1 AND 731 OR b-a>=p_max_days THEN RAISE EXCEPTION 'invalid_range'; END IF;
 IF a<(SELECT facts_from FROM public.ca_club_data_pacific_state)
 OR EXISTS(SELECT 1 FROM generate_series(a,least(b+1,(SELECT history_through FROM public.ca_club_data_pacific_state)),interval '1 day') d WHERE NOT EXISTS(SELECT 1 FROM public.ca_club_data_pacific_seed_log l WHERE l.utc_day=d::date))
 OR EXISTS(SELECT 1 FROM public.ca_club_data_pacific_failures f WHERE f.utc_day BETWEEN a AND b+1 AND (f.club_id IS NULL OR f.club_id=ANY(public.fn_ca_club_data_clubs(p_club)))) THEN
  RAISE EXCEPTION 'CLUB_DATA_PACIFIC_WINDOW_INCOMPLETE: original source history is unavailable or has not reconciled for this Pacific window';
 END IF;
END $$;
-- Report-only Pacific window over the established earned-fee sources.
-- Original UTC daily cores, per-rule UTC-day share rounding, tournament fee
-- receipts, launch eligibility and effective_on-at-UTC-midnight redemption
-- semantics are preserved. Neither payment helpers nor money rows change.
DO $fee_preimage$ BEGIN
 IF md5(pg_get_functiondef('public.ca_club_member_chicago_fee_totals(uuid,date,date,uuid)'::regprocedure)) IS DISTINCT FROM '5a1333750b1b61a32a2ec4a22b884699' THEN
  RAISE EXCEPTION 'PACIFIC_FEE_REPORT_PREIMAGE_CHANGED';
 END IF;
END $fee_preimage$;
CREATE OR REPLACE FUNCTION public.fn_ca_club_pacific_member_fee_totals(p_club_id uuid, p_from date, p_to date, p_user_id uuid)
 RETURNS TABLE(user_id uuid, cash_fees numeric, tournament_fees numeric, total_fees numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT * FROM public.ca_club_member_fee_totals(p_club_id,NULL,NULL,p_user_id) WHERE p_from IS NULL AND p_to IS NULL
 UNION ALL
 SELECT * FROM (
  WITH bounds AS (
    SELECT greatest(coalesce(p_from, public.fn_ca_fee_counting_start()),
                    public.fn_ca_fee_counting_start()) AS from_day,
 greatest(p_from::timestamp AT TIME ZONE 'America/Los_Angeles',public.fn_ca_fee_counting_start()::timestamp AT TIME ZONE 'UTC') AS from_at,
 (p_to+1)::timestamp AT TIME ZONE 'America/Los_Angeles' AS to_at
  ), share AS (
    -- A standing rake share, from the rake_attributions rows the daily rollup
    -- counts (same day key, same filters), rounded per rule and day.
    SELECT r.club_id, r.from_user, r.to_user,
           (ra.created_at AT TIME ZONE 'UTC')::date AS day,
           round(sum(round(ra.rake_amount * 100)) * r.share_bps / 10000.0)::bigint AS cents
      FROM smarter_private.player_rake_share_rules r
      CROSS JOIN bounds b
      JOIN public.rake_attributions ra
        ON ra.club_id = r.club_id AND ra.player_id = r.from_user
       AND ra.created_at >= r.effective_from
       AND (r.effective_until IS NULL OR ra.created_at < r.effective_until)
     WHERE r.club_id = p_club_id
       AND (p_user_id IS NULL OR p_user_id IN(r.from_user,r.to_user))
       AND ra.created_at>=b.from_at AND (b.to_at IS NULL OR ra.created_at<b.to_at)
       AND ra.rake_amount > 0
       AND public.fn_ca_launch_accounting_accepts(ra.club_id,(SELECT rr.created_at FROM public.rake_records rr WHERE rr.id=ra.rake_record_id))
     GROUP BY r.rule_key, r.club_id, r.from_user, r.to_user, r.share_bps, 4
  ), cash AS (
    SELECT d.user_id AS uid, sum(d.rake_cents)::numeric / 100 AS fees
      FROM (
       -- Complete UTC buckets remain the source of truth. Only the excluded
       -- portions of the first and last buckets require timestamped receipts.
       SELECT club_id,user_id,day,rake_cents FROM public.ca_club_rake_daily_user
        WHERE club_id=p_club_id AND (p_user_id IS NULL OR user_id=p_user_id)
          AND day >= greatest(coalesce(p_from,public.fn_ca_fee_counting_start()),public.fn_ca_fee_counting_start())
          AND (p_to IS NULL OR day <= p_to+1)
       UNION ALL
       SELECT ra.club_id,ra.player_id,(ra.created_at AT TIME ZONE 'UTC')::date,
              -round(ra.rake_amount*100)::bigint
       FROM bounds edge_bounds
       CROSS JOIN LATERAL (VALUES
         (greatest(p_from::timestamp AT TIME ZONE 'UTC',public.fn_ca_fee_counting_start()::timestamp AT TIME ZONE 'UTC'),edge_bounds.from_at),
         (edge_bounds.to_at,(p_to+2)::timestamp AT TIME ZONE 'UTC')
       ) edge(start_at,end_at)
       JOIN public.rake_attributions ra ON ra.club_id=p_club_id
         AND (p_user_id IS NULL OR ra.player_id=p_user_id) AND ra.created_at>=edge.start_at AND ra.created_at<edge.end_at
       WHERE ra.rake_amount>0
         AND public.fn_ca_launch_accounting_accepts(ra.club_id,(SELECT rr.created_at FROM public.rake_records rr WHERE rr.id=ra.rake_record_id))
       UNION ALL
       SELECT club_id,user_id,effective_on,-amount_cents
         FROM smarter_private.player_fee_redemptions CROSS JOIN bounds redemption_bounds
 WHERE (effective_on::timestamp AT TIME ZONE 'UTC')>=redemption_bounds.from_at
 AND (redemption_bounds.to_at IS NULL OR (effective_on::timestamp AT TIME ZONE 'UTC')<redemption_bounds.to_at)
       UNION ALL
       SELECT club_id,from_user,day,-cents FROM share
       UNION ALL
       SELECT club_id,to_user,day,cents FROM share) d, bounds b
     WHERE d.club_id = p_club_id
       AND (p_user_id IS NULL OR d.user_id = p_user_id)
       AND d.day >= b.from_day

     GROUP BY d.user_id
  ), tournament_share AS (
    -- All earned rake includes tournament entry/rebuy/add-on fee receipts.
    -- Round per rule and UTC day; identical cents leave and arrive.
    SELECT r.club_id,r.from_user,r.to_user,
           (s.charged_at AT TIME ZONE 'UTC')::date AS day,
           round(sum(s.rake_credit)*100*r.share_bps/10000.0)/100 AS fees
      FROM smarter_private.player_rake_share_rules r
      JOIN public.accounting_tournament_fee_sources s
        ON s.club_id=r.club_id AND s.player_id=r.from_user
       AND s.charged_at >= (r.tournament_effective_from::timestamp AT TIME ZONE 'UTC')
       AND (r.effective_until IS NULL OR s.charged_at<r.effective_until)
      CROSS JOIN bounds b
     WHERE r.club_id=p_club_id AND r.tournament_effective_from IS NOT NULL
       AND (p_user_id IS NULL OR p_user_id IN(r.from_user,r.to_user))
       AND s.charged_at>=b.from_at AND (b.to_at IS NULL OR s.charged_at<b.to_at)
     GROUP BY r.rule_key,r.club_id,r.from_user,r.to_user,r.share_bps,4
  ), mtt AS (
    SELECT t.user_id AS uid,sum(t.fees) AS fees
      FROM (
        SELECT club_id,player_id AS user_id,rake_credit AS fees FROM public.accounting_tournament_fee_sources,bounds b WHERE club_id=p_club_id AND charged_at>=b.from_at AND (b.to_at IS NULL OR charged_at<b.to_at)
        UNION ALL
        SELECT club_id,from_user,-fees FROM tournament_share
        UNION ALL
        SELECT club_id,to_user,fees FROM tournament_share
      ) t
     WHERE t.club_id=p_club_id AND (p_user_id IS NULL OR t.user_id=p_user_id)
     GROUP BY t.user_id
  )
  SELECT coalesce(c.uid, m.uid),
         round(coalesce(c.fees, 0), 2),
         round(coalesce(m.fees, 0), 2),
         round(coalesce(c.fees, 0) + coalesce(m.fees, 0), 2)
    FROM cash c
    FULL JOIN mtt m ON m.uid = c.uid
 ) dated WHERE p_from IS NOT NULL OR p_to IS NOT NULL;
$function$;
REVOKE ALL ON FUNCTION public.fn_ca_club_pacific_member_fee_totals(uuid,date,date,uuid) FROM PUBLIC,anon,authenticated,service_role;
-- Optional comparison windows carry coverage instead of manufacturing deltas.
CREATE FUNCTION public.fn_ca_club_data_pacific_coverage(p_club uuid,p_from date,p_to date,p_max_days integer DEFAULT 93) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM public.fn_ca_club_data_pacific_require(p_club,p_from,p_to,p_max_days);
 RETURN jsonb_build_object('complete',true,'day_basis','America/Los_Angeles 00:00');
EXCEPTION WHEN OTHERS THEN
 RETURN jsonb_build_object('complete',false,'day_basis','America/Los_Angeles 00:00','reason',SQLERRM);
END $$;
-- Qualified text copies preserve each legacy reader's authorization, paging,
-- filters, distinct-game calculation and grants. Existing Chicago APIs and
-- union accounting functions remain intact. No current-membership attribution.
CREATE FUNCTION pg_temp.ca_pacific_copy(p_name text,p_sig text,p_hash text,p_target text,p_guard boolean DEFAULT true) RETURNS void LANGUAGE plpgsql AS $copy$
DECLARE d text; args text; ident text; res text; names text[]; call text; n text; oldname text; body text; bounds text; span int;
BEGIN
 d:=pg_get_functiondef(p_sig::regprocedure);
 IF md5(d)<>p_hash THEN RAISE EXCEPTION 'PACIFIC_READER_PREIMAGE_CHANGED: %',p_sig; END IF;
 SELECT pg_get_function_arguments(p.oid),pg_get_function_identity_arguments(p.oid),pg_get_function_result(p.oid),
 ARRAY(SELECT z.n FROM unnest(p.proargnames,coalesce(p.proargmodes,array_fill('i'::"char",ARRAY[cardinality(p.proargnames)]))) WITH ORDINALITY z(n,m,o) WHERE z.m IN('i','b','v') ORDER BY z.o)
 INTO args,ident,res,names FROM pg_proc p WHERE p.oid=p_sig::regprocedure;
 d:=regexp_replace(d,'^CREATE OR REPLACE FUNCTION public\.'||p_name||'\(','CREATE FUNCTION public.'||p_target||'_core(');
 d:=regexp_replace(d,'\(now\(\) AT TIME ZONE ''(America/Chicago|UTC)''\)::date','public.fn_ca_club_data_pacific_day(now())','g');
 d:=replace(d,'''America/Chicago''','''America/Los_Angeles''');
 d:=replace(d,'public.ca_stats_club_data_fact_ct','public.ca_club_data_pacific_fact_ct');
 d:=replace(d,'public.ca_club_data_game_ct','public.ca_club_data_pacific_game_ct');
 d:=replace(d,'public.ca_club_data_hands_ct','public.ca_club_data_pacific_hands_ct');
 d:=replace(d,'public.fn_ca_club_data_fact_window(','public.fn_ca_club_data_pacific_fact_window(');
 d:=replace(d,'public.ca_club_member_fee_totals(','public.fn_ca_club_pacific_member_fee_totals(');
 IF p_name LIKE '%export_start%' THEN
  d:=regexp_replace(d,'COALESCE\(p_request_id,\s*gen_random_uuid\(\)\)','md5(''ca-data-pacific:''||COALESCE(p_request_id,gen_random_uuid())::text)::uuid','gi');
  d:=replace(d,'ca_club_data_exports(user_id,club_id,request_id,kind)','ca_club_data_exports(user_id,club_id,request_id,kind,metadata,metadata_fingerprint)');
  FOREACH n IN ARRAY ARRAY['games','players'] LOOP
   d:=replace(d,'v_request,'''||n||''')','v_request,'''||n||''',jsonb_build_object(''day_basis'',''America/Los_Angeles 00:00''),md5(jsonb_build_object(''day_basis'',''America/Los_Angeles 00:00'')::text))');
  END LOOP;
 END IF;
 d:=replace(d,'chicago_net_money_flow','pacific_net_money_flow');
 d:=replace(d,'''day_basis'', ''America/Los_Angeles''','''day_basis'', ''America/Los_Angeles 00:00''');
 d:=replace(d,'''day_basis'',''America/Los_Angeles''','''day_basis'',''America/Los_Angeles 00:00''');
 d:=replace(d,'''day_basis'', ''UTC''','''day_basis'', ''America/Los_Angeles 00:00'', ''definition'', ''pacific_earned_fees'', ''source'', ''original_earning_receipts''');
 -- The original player list read UTC membership rollups. All three player
 -- reports now read the same recorded-club Pacific events as the tiles.
 d:=regexp_replace(d,'WITH att_club AS MATERIALIZED \(.*?\), merged AS MATERIALIZED \(', $player$WITH pac AS MATERIALIZED (
 SELECT f.user_id,SUM(f.winnings) FILTER(WHERE f.kind='CASH') cash_net,
 SUM(f.winnings) FILTER(WHERE f.kind='TOURNAMENT') tournament_net,SUM(f.fee) rake,SUM(f.hands)::bigint hands
 FROM public.ca_club_data_pacific_fact_ct f WHERE f.club_id=ANY(public.fn_ca_club_data_clubs(p_club_id))
 AND f.stat_date BETWEEN v_start AND v_end AND f.user_id<>'00000000-0000-0000-0000-000000000000'::uuid GROUP BY f.user_id
 ),fees AS MATERIALIZED(
 SELECT f.user_id,sum(f.total_fees) rake FROM unnest(public.fn_ca_club_data_clubs(p_club_id)) cc(id)
 CROSS JOIN LATERAL public.fn_ca_club_pacific_member_fee_totals(cc.id,v_start,v_end,NULL) f GROUP BY f.user_id
 ),att_club AS(SELECT user_id FROM pac UNION SELECT user_id FROM fees),wallet_pnl AS(SELECT user_id,cash_net,tournament_net FROM pac),
 rake AS(SELECT user_id,rake FROM fees),hands AS(SELECT user_id,hands FROM pac),merged AS MATERIALIZED ($player$,'gs');
 -- Internal calls stay on this one basis. Only the public outer door checks
 -- history, so optional previous windows can carry explicitly incomplete deltas.
 FOREACH n IN ARRAY ARRAY['ca_club_data_screen','ca_club_data_snapshot_v2','ca_club_game_page_core_20261006','fn_ca_club_game_recent_rows','fn_ca_club_games_searched','fn_ca_club_games_unsearched','fn_ca_club_data_hand_count','fn_ca_club_cash_felt','ca_club_data_player_totals','ca_club_game_export_start','ca_club_player_page_core_20261006','ca_club_player_breakdown','ca_club_player_export_start'] LOOP
  d:=replace(d,'public.'||n||'(','public.'||n||'_pacific_basis_core(');
 END LOOP;
 IF regexp_replace(d,'--[^\n]*','','g')~'public\.(ca_stats_member_record_daily_facts|ca_stats_club_player_daily|ca_club_data_fact_ct|ca_club_data_game_ct|ca_club_data_hands_ct)\M' THEN
  RAISE EXCEPTION 'PACIFIC_READER_UNCONVERTED_SOURCE: %',p_name;
 END IF;
 EXECUTE d;
 EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC,anon,authenticated,service_role',p_target||'_core',ident);
 IF p_guard THEN
  span:=coalesce((regexp_match(d,'v_start date\s*:=\s*COALESCE\(p_start,\s*v_end\s*-\s*([0-9]+)','i'))[1]::int,0);
  bounds:='greatest(least(coalesce(p_start,least(coalesce(p_end,public.fn_ca_club_data_pacific_day(now())),public.fn_ca_club_data_pacific_day(now()))-'||span||'),least(coalesce(p_end,public.fn_ca_club_data_pacific_day(now())),public.fn_ca_club_data_pacific_day(now()))),least(coalesce(p_end,public.fn_ca_club_data_pacific_day(now())),public.fn_ca_club_data_pacific_day(now()))-92),least(coalesce(p_end,public.fn_ca_club_data_pacific_day(now())),public.fn_ca_club_data_pacific_day(now()))';
  call:='('||array_to_string(ARRAY(SELECT quote_ident(x) FROM unnest(names) x),',')||')';
  body:='BEGIN PERFORM public.fn_ca_club_data_pacific_require(p_club_id,'||bounds||'); '||
  CASE WHEN res LIKE 'SETOF %' OR res LIKE 'TABLE(%' THEN 'RETURN QUERY SELECT * FROM public.' ELSE 'RETURN public.' END||quote_ident(p_target||'_core')||call||'; END;';
  IF res='jsonb' AND p_name NOT LIKE '%export_start%' THEN
   body:='DECLARE r jsonb; c jsonb; BEGIN PERFORM public.fn_ca_club_data_pacific_require(p_club_id,'||bounds||'); r:=public.'||quote_ident(p_target||'_core')||call||'; '||
   'r:=r||jsonb_build_object(''accounting_basis'',''pacific_net_money_flow'',''day_basis'',''America/Los_Angeles 00:00'',''accounting_coverage'',jsonb_build_object(''complete'',true)); ';
   IF p_name='ca_club_data_snapshot_v2_chicago_basis' THEN
    body:=body||'c:=public.fn_ca_club_data_pacific_coverage(p_club_id,(r->''previous_range''->>''start'')::date,(r->''previous_range''->>''end'')::date); r:=r||jsonb_build_object(''previous_coverage'',c); IF NOT (c->>''complete'')::boolean THEN r:=jsonb_set(r,''{delta}'',coalesce(r->''delta'',''{}''::jsonb)||jsonb_build_object(''fee_pct'',NULL,''games_pct'',NULL,''winnings_abs'',NULL,''fee_abs'',NULL)); END IF; ';
   END IF;
   body:=body||'RETURN r; END;';
  END IF;
  EXECUTE format('CREATE FUNCTION public.%I(%s) RETURNS %s LANGUAGE plpgsql %s SECURITY DEFINER SET search_path=public AS %L',p_target,args,res,
  CASE WHEN p_name LIKE '%export_start%' THEN 'VOLATILE' ELSE 'STABLE' END,body);
  EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC,anon,authenticated,service_role',p_target,ident);
 END IF;
END $copy$;

DO $readers$ DECLARE r record;d text; BEGIN
 FOR r IN SELECT * FROM (VALUES
 ('fn_ca_club_game_recent_rows','public.fn_ca_club_game_recent_rows_chicago_basis(uuid,date,date,integer)','6af4f572e8ea088ca5a42165cc23cec7'),
 ('ca_club_player_export_start','public.ca_club_player_export_start_chicago_basis(uuid,date,date,text,uuid)','485c6ea546d488ae7517386caacba66a'),
 ('ca_club_data_snapshot_v2','public.ca_club_data_snapshot_v2_chicago_basis(uuid,date,date,text,text,text,integer)','504a8b091d41b95e48227fb772ff5afa'),
 ('ca_club_game_export_start','public.ca_club_game_export_start_chicago_basis(uuid,date,date,text,text,text,text,uuid)','ea1b28faec5eb4f406ca30d08134be6a'),
 ('ca_club_player_page_core_20261006','public.ca_club_player_page_core_20261006_chicago_basis(uuid,date,date,text,text,jsonb,integer)','c1de7ddab2704e036eed9d81a8d8dbd0'),
 ('ca_club_data_screen','public.ca_club_data_screen_chicago_basis(uuid,date,date,text,text,text,integer)','c16222f69900e75fb34c23a27bc96789'),
 ('ca_club_player_breakdown','public.ca_club_player_breakdown_chicago_basis(uuid,date,date,integer)','db56288e1ec3bff4a5113746e53ad483'),
 ('ca_club_game_page_core_20261006','public.ca_club_game_page_core_20261006_chicago_basis(uuid,date,date,text,text,text,text,jsonb,integer)','ef4b8368671713befeeef2b055feb304'),
 ('fn_ca_club_games_searched','public.fn_ca_club_games_searched_chicago_basis(uuid,date,date,text,text,text)','9be466fcbd77d3b6c9bc12af74c48461'),
 ('fn_ca_club_games_unsearched','public.fn_ca_club_games_unsearched_chicago_basis(uuid,date,date,text,text)','ba5e0f45c0a91a4edcbbd6bd7f3e46b1'),
 ('fn_ca_club_data_hand_count','public.fn_ca_club_data_hand_count_chicago_basis(uuid,date,date,text,text,text)','364c6ec74cb8016b064b54476b359a34'),
 ('fn_ca_club_cash_felt','public.fn_ca_club_cash_felt_chicago_basis(uuid,date,date,text,text,text)','800c7ffbea2a0290c735aa24cfcab76f'),
 ('ca_club_data_player_totals','public.ca_club_data_player_totals_chicago_basis(uuid,date,date,text,text,text)','7e8bd822d9a2f3f486a9e54f2d56b62e')
 )x(name,sig,hash) LOOP
 PERFORM pg_temp.ca_pacific_copy(r.name||'_chicago_basis',r.sig,r.hash,r.name||'_pacific_basis');
 d:=pg_get_functiondef(replace(r.sig,'_chicago_basis','')::regprocedure);
 IF position('fn_ca_club_data_reads_union_basis' IN d)=0 OR position(r.name||'_chicago_basis' IN d)=0 THEN RAISE EXCEPTION 'PACIFIC_ROUTER_PREIMAGE_CHANGED: %',r.name; END IF;
 EXECUTE replace(replace(d,r.name||'_chicago_basis',r.name||'_pacific_basis'),'chicago_net_money_flow','pacific_net_money_flow');
 END LOOP;
END $readers$;
-- Gross CASH production for the by-agent report. Full UTC cores retain
-- their existing sealed/unsealed contract. Only partial UTC days read original
-- positive attribution receipts, rounded per receipt exactly as the existing
-- timestamp-taking downline reader. Personal fee redemptions, standing shares
-- and tournament earnings are deliberately outside this production definition.
CREATE FUNCTION public.fn_ca_club_data_pacific_cash_gross(p_club uuid,p_since timestamptz,p_until timestamptz)
 RETURNS TABLE(user_id uuid,rake numeric,hands bigint) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public SET TimeZone='UTC' AS $$
 WITH bounds AS MATERIALIZED(
  SELECT p_since lo,p_until hi,
   p_since::date::timestamp AT TIME ZONE 'UTC' first_midnight,
   p_until::date::timestamp AT TIME ZONE 'UTC' last_midnight
 ), spans AS MATERIALIZED(
  SELECT b.*,CASE WHEN lo>first_midnight THEN least(hi,first_midnight+interval '1 day') ELSE lo END head_end FROM bounds b
 ), ok_days AS MATERIALIZED(
  SELECT rc.day FROM public.club_rake_rollup_complete rc CROSS JOIN bounds b
  WHERE rc.club_id=p_club AND rc.day BETWEEN b.lo::date AND b.hi::date
   AND (rc.day::timestamp AT TIME ZONE 'UTC')>=b.lo AND ((rc.day+1)::timestamp AT TIME ZONE 'UTC')<=b.hi
 ), core AS(
  SELECT d.user_id,d.rake_amount rake,d.hands FROM public.club_rake_daily_user d JOIN ok_days o ON o.day=d.day WHERE d.club_id=p_club
  UNION ALL
  SELECT d.user_id,d.rake_cents::numeric/100,d.hands FROM public.ca_club_rake_daily_user d CROSS JOIN bounds b
  WHERE d.club_id=p_club AND d.day BETWEEN b.lo::date AND b.hi::date
   AND (d.day::timestamp AT TIME ZONE 'UTC')>=b.lo AND ((d.day+1)::timestamp AT TIME ZONE 'UTC')<=b.hi
   AND NOT EXISTS(SELECT 1 FROM ok_days o WHERE o.day=d.day)
 ), edges AS MATERIALIZED(
  SELECT lo,head_end hi FROM spans WHERE lo<head_end
  UNION ALL SELECT greatest(lo,last_midnight,head_end),hi FROM spans WHERE greatest(lo,last_midnight,head_end)<hi
 ), parts AS(
  SELECT * FROM core
  UNION ALL
  SELECT ra.player_id,sum(round(ra.rake_amount*100))::numeric/100,count(*)::bigint
  FROM edges e JOIN public.rake_attributions ra ON ra.club_id=p_club AND ra.created_at>=e.lo AND ra.created_at<e.hi
  WHERE ra.rake_amount>0 AND public.fn_ca_launch_accounting_accepts(ra.club_id,(SELECT rr.created_at FROM public.rake_records rr WHERE rr.id=ra.rake_record_id))
  GROUP BY ra.player_id
 ) SELECT p.user_id,sum(p.rake),sum(p.hands)::bigint FROM parts p GROUP BY p.user_id
 $$;
-- Reporting-only Rake Snapshot copies. UTC commission ledgers/rounding stay
-- unchanged; the report passes exact Pacific instants to timestamp readers.
DO $rake$ DECLARE r record;d text;ident text;n text;
BEGIN
 FOR r IN SELECT * FROM (VALUES
 ('fn_ca_rake_felt_v2','uuid[],date,date','fn_ca_rake_felt_pacific_v2'),
 ('fn_ca_rake_series_v2','uuid[],date,date,text','fn_ca_rake_series_pacific_v2'),
 ('fn_ca_rake_window_v2','uuid[],date,date','fn_ca_rake_window_pacific_v2'),
 ('fn_ca_rake_windows_v3','uuid[],date,date,boolean','fn_ca_rake_windows_pacific_v3'),
 ('fn_ca_rake_by_club_v2','uuid[],date,date,integer,integer,text,text','fn_ca_rake_by_club_pacific_v2'),
 ('fn_ca_rake_by_agent','uuid,date,date,integer,integer,text,text','fn_ca_rake_by_agent_pacific'),
 ('ca_rake_snapshot_v2','text,uuid,uuid,date,date,uuid,integer,integer,text,text','ca_rake_snapshot_pacific_v2'),
 ('ca_rake_export_start_v2','text,uuid,date,date,uuid,text,text,uuid','ca_rake_export_start_pacific_v2')
 )x(name,sig,target) LOOP
 d:=pg_get_functiondef(('public.'||r.name||'('||r.sig||')')::regprocedure);
 IF md5(d) IS DISTINCT FROM (CASE r.name
 WHEN 'fn_ca_rake_felt_v2' THEN '958e2544fe5818426b489072adc7f3d3'
 WHEN 'fn_ca_rake_series_v2' THEN '1867e5903651d7a4150f641a30204afd'
 WHEN 'fn_ca_rake_window_v2' THEN '85bb8d708da6baa9d2222b3c5643ad5e'
 WHEN 'fn_ca_rake_windows_v3' THEN '6f1695e0570dcd8af393dbb9609ddc5a'
 WHEN 'fn_ca_rake_by_club_v2' THEN '1ebceecdda85f1a14e51b8215f9fa709'
 WHEN 'fn_ca_rake_by_agent' THEN '9bd73f7e0e76910f19d43c355d9d81aa'
 WHEN 'ca_rake_snapshot_v2' THEN '3a65e07a01975f96ae0d9f9fded22325'
 WHEN 'ca_rake_export_start_v2' THEN '759f08aac899f4def0e559620fbb91a8' END) THEN RAISE EXCEPTION 'PACIFIC_RAKE_PREIMAGE_CHANGED: %',r.name; END IF;
 d:=replace(d,'FUNCTION public.'||r.name||'(','FUNCTION public.'||r.target||'(');
 d:=replace(d,'''America/Chicago''','''America/Los_Angeles''');
 d:=replace(d,'chicago_net_money_flow','pacific_net_money_flow');
 d:=replace(d,'''day_basis'',''America/Los_Angeles''','''day_basis'',''America/Los_Angeles 00:00''');
 d:=replace(d,'public.ca_club_data_game_ct','public.ca_club_data_pacific_game_ct');
 d:=replace(d,'public.ca_club_data_hands_ct','public.ca_club_data_pacific_hands_ct');
 d:=replace(d,'public.fn_ca_club_data_fact_window(','public.fn_ca_club_data_pacific_fact_window(');
 d:=replace(d,'public.fn_ca_rake_felt_v2(','public.fn_ca_rake_felt_pacific_v2(');
 d:=replace(d,'public.fn_ca_rake_series_v2(','public.fn_ca_rake_series_pacific_v2(');
 d:=replace(d,'public.fn_ca_rake_window_v2(','public.fn_ca_rake_window_pacific_v2(');
 d:=replace(d,'public.fn_ca_rake_windows_v3(','public.fn_ca_rake_windows_pacific_v3(');
 d:=replace(d,'public.fn_ca_rake_by_club_v2(','public.fn_ca_rake_by_club_pacific_v2(');
 d:=replace(d,'public.fn_ca_rake_by_agent(','public.fn_ca_rake_by_agent_pacific(');
 d:=replace(d,'public.ca_rake_snapshot_v2(','public.ca_rake_snapshot_pacific_v2(');
 IF r.name='fn_ca_rake_by_agent' THEN
  d:=replace(d,'p_start::timestamptz','(p_start::timestamp AT TIME ZONE ''America/Los_Angeles'')');
  d:=replace(d,'(p_end + 1)::timestamptz','((p_end+1)::timestamp AT TIME ZONE ''America/Los_Angeles'')');
  -- Preserve the entire commission CTE unchanged: replace only the rake
  -- earnings daily core, whose UTC buckets cannot answer Pacific edge hours.
  d:=regexp_replace(d,'WITH RECURSIVE ok_days AS MATERIALIZED \(.*?\), commission_days AS MATERIALIZED \(', $earned$WITH RECURSIVE earned AS MATERIALIZED (
   SELECT e.user_id,e.rake,e.hands FROM public.fn_ca_club_data_pacific_cash_gross(p_club_id,v_from,v_to) e
  ), commission_days AS MATERIALIZED ($earned$,'s');
 ELSIF r.name='ca_rake_snapshot_v2' THEN
  d:=replace(d,E'DECLARE\n',E'DECLARE\n  v_pacific_final jsonb; v_pacific_previous jsonb;\n');
  d:=replace(d,E'RETURN jsonb_build_object(\n    ''scope'',v_scope',E'v_pacific_final := jsonb_build_object(\n    ''scope'',v_scope');
  d:=replace(d,E'END;\n$function$',E'  v_pacific_previous:=public.fn_ca_club_data_pacific_coverage(coalesce(p_union_id,p_club_id),v_pstart,v_pend,731);\n  v_pacific_final:=v_pacific_final||jsonb_build_object(''previous_coverage'',v_pacific_previous,''accounting_coverage'',jsonb_build_object(''complete'',true));\n  IF NOT (v_pacific_previous->>''complete'')::boolean THEN\n    v_pacific_final:=jsonb_set(v_pacific_final,''{delta}'',jsonb_build_object(''fee_pct'',NULL,''games_pct'',NULL,''fee_abs'',NULL,''winnings_abs'',NULL));\n  END IF;\n  RETURN v_pacific_final;\nEND;\n$function$');
  d:=replace(d,'  IF v_scope = ''agent'' THEN',E'  IF v_scope <> ''agent'' THEN\n    PERFORM public.fn_ca_club_data_pacific_require(coalesce(p_union_id,p_club_id),v_start,v_end,731);\n  END IF;\n  IF v_scope = ''agent'' THEN');
 ELSIF r.name='ca_rake_export_start_v2' THEN
  d:=regexp_replace(d,'COALESCE\(p_request_id,\s*gen_random_uuid\(\)\)','md5(''ca-data-pacific:''||COALESCE(p_request_id,gen_random_uuid())::text)::uuid','gi');
  d:=replace(d,'IF v_existing.scope_type IS DISTINCT FROM v_scope','IF v_existing.metadata->>''day_basis'' IS DISTINCT FROM ''America/Los_Angeles 00:00'' OR v_existing.scope_type IS DISTINCT FROM v_scope');
  d:=replace(d,'''generated_at'', snapshot_shape.document -> ''generated_at'',','''day_basis'', ''America/Los_Angeles 00:00'', ''generated_at'', snapshot_shape.document -> ''generated_at'',');
 END IF;
 -- UTC whole-day cores in timestamp-taking agent readers remain UTC, even
 -- when the caller session has a different TimeZone setting.
 d:=replace(d,E'AS $function$',E'SET TimeZone TO ''UTC''\nAS $function$');
 EXECUTE d;
 EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC,anon,authenticated,service_role',r.target,r.sig);
 IF r.name IN('ca_rake_snapshot_v2','ca_rake_export_start_v2') THEN
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated,service_role',r.target,r.sig);
 END IF;
 END LOOP;
END $rake$;
REVOKE ALL ON FUNCTION public.fn_ca_club_data_fact_put(uuid,date,text,uuid,uuid,numeric,numeric,numeric,numeric,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_club_data_fact_put(uuid,date,text,uuid,uuid,numeric,numeric,numeric,numeric,timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.fn_ca_club_data_hand_put(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_club_data_hand_put(uuid,uuid,timestamptz) TO service_role;
-- New internals are not browser-callable; public routers retain original ACLs.
REVOKE ALL ON FUNCTION public.fn_ca_club_data_pacific_day(timestamptz) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_ca_club_data_pacific_day_start(date) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_ca_club_data_pacific_fact_window(uuid[],date,date) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_ca_club_data_pacific_own(text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_ca_club_data_pacific_leg_club(uuid,numeric,text,timestamptz,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_ca_club_data_pacific_seed(date,boolean) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_ca_club_data_pacific_require(uuid,date,date,integer) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_ca_club_data_pacific_coverage(uuid,date,date,integer) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_ca_club_data_pacific_cash_gross(uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON public.ca_club_data_pacific_fact_ct,public.ca_club_data_pacific_game_ct,public.ca_club_data_pacific_hands_ct FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
