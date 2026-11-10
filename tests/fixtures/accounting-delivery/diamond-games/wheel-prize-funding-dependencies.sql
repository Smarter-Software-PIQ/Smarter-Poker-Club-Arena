-- Production DDL from 20261005152200 and 20261010035655, scoped to the two
-- readers the isolated Diamond fixture does not otherwise exercise.
SELECT to_regprocedure('public.fn_ca_diamond_house_available()') IS NULL AS load_house_reader \gset
\if :load_house_reader
CREATE TABLE public.ca_diamond_house_earmarks (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at            timestamptz NOT NULL DEFAULT now(),
  entry         text        NOT NULL CHECK (entry IN ('open','pay','release')),
  earmark_key   text        NOT NULL CHECK (btrim(earmark_key) <> ''),
  purpose       text        NOT NULL CHECK (purpose IN ('guarantee','promotional_entry','jackpot_seed')),
  amount        bigint      NOT NULL CHECK (amount > 0 AND amount = trunc(amount)),
  tournament_id uuid        NULL,
  holder_id     uuid        NULL,
  expires_at    timestamptz NULL,
  recorded_by   uuid        NULL,
  reason        text        NOT NULL CHECK (btrim(reason) <> ''),

  -- A guarantee belongs to an event. A promotional entry belongs to a holder,
  -- and to one event or to any event. A jackpot seed belongs to neither.
  CONSTRAINT ca_diamond_house_earmarks_shape CHECK (
    CASE purpose
      WHEN 'guarantee'         THEN tournament_id IS NOT NULL AND holder_id IS NULL
      WHEN 'promotional_entry' THEN holder_id IS NOT NULL
      WHEN 'jackpot_seed'      THEN tournament_id IS NULL AND holder_id IS NULL
    END
  ),
  -- Only a promotional entry has a shelf life (A17).
  CONSTRAINT ca_diamond_house_earmarks_expiry_shape CHECK (
    purpose = 'promotional_entry' OR expires_at IS NULL
  )
);

COMMENT ON TABLE public.ca_diamond_house_earmarks IS
  'What the Diamond house has promised and not yet paid: guarantees set aside at creation, unredeemed promotional entries and jackpot seeds. Append-only; one key is a sequence of open, pay and release entries and the open amount is the arithmetic. An earmark moves no Diamond, so it never reaches ca_mint_ledger, fn_ca_arena_diamonds() or the supply identity - it only lowers what fn_ca_diamond_house_available() reports. Rule R3 of docs/DIAMOND-DESTINATIONS-DESIGN-2026-09-21.md.';
COMMENT ON COLUMN public.ca_diamond_house_earmarks.entry IS
  'open promises, pay keeps the promise to a named player, release gives back what is no longer needed. Caps are checked on open and on nothing else: a cap stops a promise being made, never one being kept (ruling 21).';
COMMENT ON COLUMN public.ca_diamond_house_earmarks.amount IS
  'Whole Diamonds, always positive. A Diamond is indivisible, so an earmark is too.';

CREATE INDEX ix_ca_diamond_house_earmarks_key ON public.ca_diamond_house_earmarks (earmark_key, id);
CREATE INDEX ix_ca_diamond_house_earmarks_open_guarantee
  ON public.ca_diamond_house_earmarks (purpose, at) WHERE purpose = 'guarantee';
CREATE INDEX ix_ca_diamond_house_earmarks_holder ON public.ca_diamond_house_earmarks (holder_id, at)
  WHERE holder_id IS NOT NULL;
CREATE INDEX ix_ca_diamond_house_earmarks_tournament ON public.ca_diamond_house_earmarks (tournament_id, at)
  WHERE tournament_id IS NOT NULL;

CREATE FUNCTION public.fn_ca_diamond_house_earmarks_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'ca_diamond_house_earmarks is append-only: a promise is closed by a pay or a release entry, never by editing the promise'
    USING ERRCODE = '42501';
END $$;
COMMENT ON FUNCTION public.fn_ca_diamond_house_earmarks_append_only() IS
  'Refuses every UPDATE, DELETE and TRUNCATE on the house earmark ledger. What the house promised and what it did about it is the audit trail of the guarantee.';
REVOKE ALL ON FUNCTION public.fn_ca_diamond_house_earmarks_append_only() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_ca_diamond_house_earmarks_append_only
  BEFORE UPDATE OR DELETE ON public.ca_diamond_house_earmarks
  FOR EACH ROW EXECUTE FUNCTION public.fn_ca_diamond_house_earmarks_append_only();
CREATE TRIGGER trg_ca_diamond_house_earmarks_no_truncate
  BEFORE TRUNCATE ON public.ca_diamond_house_earmarks
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_ca_diamond_house_earmarks_append_only();

ALTER TABLE public.ca_diamond_house_earmarks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ca_diamond_house_earmarks FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.ca_diamond_house_earmarks_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.ca_diamond_house_earmarks TO service_role;

-- ---------------------------------------------------------------------------
-- 2. WHAT IS OPEN, AND WHAT IS AVAILABLE
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.fn_ca_diamond_earmark_open(p_key text)
RETURNS bigint LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT COALESCE(SUM(CASE e.entry WHEN 'open' THEN e.amount ELSE -e.amount END), 0)::bigint
    FROM public.ca_diamond_house_earmarks e
   WHERE e.earmark_key = p_key
$$;
COMMENT ON FUNCTION public.fn_ca_diamond_earmark_open(text) IS
  'What one earmark still promises: its opens less its pays and releases. Zero when it was never opened, which is also zero when it has been fully kept - the ledger says which.';
REVOKE ALL ON FUNCTION public.fn_ca_diamond_earmark_open(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_diamond_earmark_open(text) TO service_role;

CREATE FUNCTION public.fn_ca_diamond_earmarks_open(p_purpose text DEFAULT NULL)
RETURNS bigint LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT COALESCE(SUM(CASE e.entry WHEN 'open' THEN e.amount ELSE -e.amount END), 0)::bigint
    FROM public.ca_diamond_house_earmarks e
   WHERE p_purpose IS NULL OR e.purpose = p_purpose
$$;
COMMENT ON FUNCTION public.fn_ca_diamond_earmarks_open(text) IS
  'Everything the Diamond house has promised and not yet paid or released, all purposes or one. This is the platform''s outstanding exposure, which A5 caps for guarantees.';
REVOKE ALL ON FUNCTION public.fn_ca_diamond_earmarks_open(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_diamond_earmarks_open(text) TO service_role;

-- The number every door that wants to promise something must read. R3: "An
-- earmark lowers the house's available balance (balance less open earmarks)
-- and moves nothing." ca_diamond_house.balance itself is untouched by this
-- file, so fn_ca_diamond_trial_balance, fn_ca_diamond_snapshot and
-- fn_ca_diamond_register_vs_supply all read exactly what they read before.
CREATE FUNCTION public.fn_ca_diamond_house_available()
RETURNS bigint LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT (SELECT h.balance FROM public.ca_diamond_house h WHERE h.id = 1)::bigint
       - public.fn_ca_diamond_earmarks_open(NULL)
$$;
COMMENT ON FUNCTION public.fn_ca_diamond_house_available() IS
  'The Diamond house balance less everything it has already promised. A door that is about to promise reads this, never ca_diamond_house.balance. It can be read as negative only if a promise was opened before the house was funded, which the earmark guard refuses, so in practice it is at least 0.';
REVOKE ALL ON FUNCTION public.fn_ca_diamond_house_available() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_diamond_house_available() TO service_role;

-- ---------------------------------------------------------------------------

\endif
SELECT to_regprocedure('public.fn_ca_assert_emergency_path(text)') IS NULL AS load_emergency_reader \gset
\if :load_emergency_reader
CREATE TABLE public.ca_emergency_stops (
 path text PRIMARY KEY CHECK(path IN ('tournament_registration','positive_issuance','cashout')),
 stopped boolean NOT NULL DEFAULT false,
 version bigint NOT NULL DEFAULT 0 CHECK(version>=0),
 reason text,
 actor_id uuid,
 updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
INSERT INTO public.ca_emergency_stops(path) VALUES ('tournament_registration'),('positive_issuance'),('cashout');
ALTER TABLE public.ca_emergency_stops ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_emergency_stops FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.ca_emergency_stops TO service_role;
CREATE FUNCTION public.fn_ca_assert_emergency_path(p_path text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE active boolean;
BEGIN
 IF p_path IS NULL OR p_path NOT IN('tournament_registration','positive_issuance','cashout')
 THEN RAISE EXCEPTION 'unknown_emergency_path' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('ca-emergency-stop:'||p_path,0));
 SELECT stopped INTO active FROM public.ca_emergency_stops WHERE path=p_path FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'emergency_stop_authority_missing' USING ERRCODE='55000'; END IF;
 IF active THEN RAISE EXCEPTION 'emergency_path_stopped:%',p_path USING ERRCODE='P0410'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.fn_ca_assert_emergency_path(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_assert_emergency_path(text) TO service_role;

\endif
