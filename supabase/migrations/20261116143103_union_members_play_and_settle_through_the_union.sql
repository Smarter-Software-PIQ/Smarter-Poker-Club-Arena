-- A member's old standalone close is evidence for its original week only.
-- The historical join week can contain legitimate pre-join earnings. Weeks
-- starting under the membership never start a separate club book or payout.
-- @live-proof: position('standalone_week_belongs_to_union' in pg_get_functiondef('smarter_private.weekly_payout_scope_plan(timestamptz,timestamptz)'::regprocedure))>0 AND position('standalone_week_belongs_to_union' in pg_get_functiondef('public.fn_process_weekly_accounting_scope(uuid,uuid)'::regprocedure))>0 AND (SELECT count(*)=5 FROM pg_catalog.pg_trigger WHERE tgname='member_club_standalone_game_guard' AND tgenabled='O' AND tgrelid IN ('public.tables'::regclass,'public.tournaments'::regclass,'public.union_clubs'::regclass,'public.cash_games'::regclass,'public.tournament_schedules'::regclass))
BEGIN;
-- Active game writers normally hold these relations for several seconds.
-- Give the structural trigger install the bounded DDL budget used elsewhere.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15s';
SET LOCAL search_path=pg_catalog,public;

CREATE FUNCTION smarter_private.standalone_week_belongs_to_union(p_club uuid,p_from timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $body$
 SELECT EXISTS(SELECT FROM public.union_clubs m WHERE m.club_id=p_club AND m.union_id<>m.club_id AND coalesce(m.joined_at,(SELECT min(h.observed_at) FROM public.accounting_agreement_history h WHERE h.entity_type='union_clubs' AND h.entity_key=m.id::text))<=p_from)
$body$;
REVOKE ALL ON FUNCTION smarter_private.standalone_week_belongs_to_union(uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

DO $patch$
DECLARE
  original regprocedure:='public.fn_process_weekly_accounting_scope(uuid,uuid)'::regprocedure;
  mirror regprocedure:='smarter_private.weekly_payout_eligible_scopes(timestamptz,timestamptz)'::regprocedure;
  plan regprocedure:='smarter_private.weekly_payout_scope_plan(timestamptz,timestamptz)'::regprocedure;
  old_hash constant text:='4179282ab83f30094d4c3b2885102917';
  source text:=pg_get_functiondef(original);
  eligibility text:=pg_get_functiondef(mirror);
  planner text:=pg_get_functiondef(plan);
  eligible_anchor constant text:='AND GREATEST(w.first_week,public.fn_club_settlement_floor_week(w.club_id))<v_to';
  eligible_guard constant text:='AND NOT smarter_private.standalone_week_belongs_to_union(w.club_id,GREATEST(w.first_week,public.fn_club_settlement_floor_week(w.club_id))) ';
  week_anchor constant text:='v_end:=public.fn_union_week_start(v_from+interval ''8 days'');v_due:=public.fn_union_accounting_run_at(v_end);';
  plan_anchor constant text:='we:=public.fn_union_week_start(ws+interval ''8 days'');';
BEGIN
  IF md5(source)<>old_hash OR md5(eligibility)<>'f1a135b2555d4dfee67836d0b43af390' OR md5(planner)<>'ec30840469438a995d15dbbbefafefb0'
    OR position(eligible_anchor IN source)=0 OR position(eligible_anchor IN eligibility)=0
    OR position(week_anchor IN source)=0 OR position(plan_anchor IN planner)=0 THEN
    RAISE EXCEPTION 'union_member_standalone_scheduler_preimage_changed';
  END IF;
  -- Apply the same candidate rule in the book and its payout mirror. Also
  -- bound both week loops, since a real pre-join backlog may span the join.
  source:=replace(source,eligible_anchor,eligible_guard||eligible_anchor);
  source:=replace(source,week_anchor,'EXIT WHEN smarter_private.standalone_week_belongs_to_union(v_club.id,v_from); '||week_anchor);
  EXECUTE source;
  EXECUTE replace(replace(eligibility,eligible_anchor,eligible_guard||eligible_anchor),old_hash,md5(pg_get_functiondef(original)));
  EXECUTE replace(planner,plan_anchor,'EXIT WHEN sc.kind=''club'' AND smarter_private.standalone_week_belongs_to_union(sc.id,ws); '||plan_anchor);
END
$patch$;

-- The original owner-stamping triggers run first for games. An ordinary
-- union game therefore already belongs to its union. This guard covers private
-- games and reopening/moving rows as well as inserts. A shared transaction
-- lock serializes creation with the join's final check and cleanup.
CREATE FUNCTION smarter_private.guard_member_club_standalone_game()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE
  closed text[]:=ARRAY['CLOSED','DELETED','COMPLETED','CANCELLED','CANCELED','FAILED'];
BEGIN
  IF NEW.club_id IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='union_clubs' THEN
    IF NEW.club_id=NEW.union_id THEN RETURN NEW; END IF;
    IF TG_WHEN='BEFORE' THEN
      IF NEW.joined_at IS NULL THEN
        IF TG_OP='UPDATE' THEN NEW.joined_at:=OLD.joined_at; END IF;
        NEW.joined_at:=coalesce(NEW.joined_at,transaction_timestamp());
      END IF;
      PERFORM pg_advisory_xact_lock(hashtextextended('club-game-ownership:'||NEW.club_id::text,0));
    ELSIF EXISTS(SELECT FROM public.cash_games WHERE club_id=NEW.club_id AND (enabled OR state<>'dormant'))
      OR EXISTS(SELECT FROM public.tables WHERE club_id=NEW.club_id AND is_private AND NOT coalesce(is_deleted,false) AND NOT coalesce(upper(status)=ANY(closed),false))
      OR EXISTS(SELECT FROM public.tournament_schedules WHERE club_id=NEW.club_id AND active) THEN
      RAISE EXCEPTION 'Close club cash games and schedules before joining a union' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME='cash_games' THEN
    IF NEW.enabled IS FALSE AND NEW.state='dormant' THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME='tournament_schedules' THEN
    IF NEW.active IS NOT TRUE THEN RETURN NEW; END IF;
  ELSE
    IF upper(NEW.status)=ANY(closed) THEN RETURN NEW; END IF;
    IF TG_OP='UPDATE' THEN
      IF (OLD.club_id,OLD.union_id,OLD.is_private) IS NOT DISTINCT FROM (NEW.club_id,NEW.union_id,NEW.is_private)
         AND NOT coalesce(upper(OLD.status)=ANY(closed),false) THEN RETURN NEW; END IF;
    END IF;
  END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('club-game-ownership:'||NEW.club_id::text,0));
  IF EXISTS(SELECT FROM public.union_clubs m WHERE m.club_id=NEW.club_id AND m.union_id<>m.club_id) THEN
    RAISE EXCEPTION 'A union member club cannot operate a standalone cash game or tournament' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$body$;
REVOKE ALL ON FUNCTION smarter_private.guard_member_club_standalone_game() FROM PUBLIC,anon,authenticated,service_role;
-- The cash cluster writes a table before updating its parent cash game.
-- Acquire both DDL locks in that same order before creating any trigger.
LOCK TABLE public.tables,public.cash_games IN SHARE ROW EXCLUSIVE MODE;
CREATE TRIGGER member_club_standalone_game_guard BEFORE INSERT OR UPDATE OF club_id,union_id,joined_at ON public.union_clubs
  FOR EACH ROW EXECUTE FUNCTION smarter_private.guard_member_club_standalone_game();
CREATE TRIGGER member_club_must_finish_standalone_games AFTER INSERT OR UPDATE OF club_id,union_id ON public.union_clubs
  FOR EACH ROW EXECUTE FUNCTION smarter_private.guard_member_club_standalone_game();
CREATE TRIGGER member_club_standalone_game_guard AFTER INSERT OR UPDATE OF club_id,union_id,enabled,state ON public.cash_games
  FOR EACH ROW EXECUTE FUNCTION smarter_private.guard_member_club_standalone_game();
CREATE TRIGGER member_club_standalone_game_guard AFTER INSERT OR UPDATE OF club_id,active ON public.tournament_schedules
  FOR EACH ROW EXECUTE FUNCTION smarter_private.guard_member_club_standalone_game();
CREATE TRIGGER member_club_standalone_game_guard AFTER INSERT OR UPDATE OF club_id,union_id,is_private,status ON public.tables
  FOR EACH ROW EXECUTE FUNCTION smarter_private.guard_member_club_standalone_game();
CREATE TRIGGER member_club_standalone_game_guard AFTER INSERT OR UPDATE OF club_id,union_id,is_private,status ON public.tournaments
  FOR EACH ROW EXECUTE FUNCTION smarter_private.guard_member_club_standalone_game();
INSERT INTO public.ca_declared_money_triggers(table_name,trigger_name,note)
VALUES('tournaments','member_club_standalone_game_guard','Forbids a member club from owning an active standalone tournament while in a union. No chip writes.')
ON CONFLICT DO NOTHING;
COMMIT;
