-- 20261121171027_the_style_shift_release_can_be_noise_aware
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-21 17:10:27 UTC.
--
-- WHAT WAS WRONG:
--
-- The durable opponent profile learns through fn_horse_exploit_add (migration
-- 20261107022913, the SQL twin of HorseOpponentExploit.decayAndAddOpportunityScoped,
-- Dan's ruling of 2026-11-06,
-- docs/changelog/2026-11-06-opportunity-scoped-decay-with-style-shift-release.md).
-- Its style-shift release fires when ANY of six fast-window rates (pfr, rfi,
-- three-bet, bet when checked to, fold to a bet, river call) is 0.2 from its
-- long-window rate on at least 3 decayed fast opportunities, and then ages
-- EVERY long-window gated statistic at the fast rate. A fast window of 3 to 12
-- decayed opportunities is noisy, so a player whose frequencies never change
-- trips it by chance on 2-4% of hands, and a stable 26% first-in raiser keeps
-- about a third of the decayed fold-to-bet sample he keeps with no release
-- (docs/horse-league-fixed-limit.md, "The over-folder read and mixed
-- frequencies").
--
-- WHAT THIS CHANGES:
--
-- The root fix ships behind the Horse option styleShiftReleaseIsNoiseAware,
-- registered default OFF (its switch list is a separate follow-up migration
-- written by server/scripts/gen-horse-option-switch-sql.ts). Both learners read
-- the one switch row, so the persisted profile and live memory follow one rule:
--   - fn_horse_exploit_add_rule(base, delta, hands, noise_aware): IMMUTABLE.
--     noise_aware false is the 20261107022913 body byte for byte. noise_aware
--     true: a statistic MOVED only when its fast rate differs from its long
--     rate by at least greatest(0.2, 1.5 * sqrt(q (1 - q) / nFast)), q the
--     long rate shrunk half an observation toward one half, nFast the decayed
--     fast count (still at least 3); a moved gated statistic ages only its own
--     long window; a moved pfr still ages every gated window.
--     (HorseOpponentExploit.STYLE_SHIFT_NOISE_K and styleShiftMoved.)
--   - fn_horse_style_shift_release_is_noise_aware(): STABLE, true only while
--     ca_horse_style_switch holds an 'on' row for the option (the engine's
--     optionSwitchDecisionOpts reads the same row: 'on' is on, everything else,
--     on_shadow included, which this process switch never takes, is off).
--   - fn_horse_exploit_add(base, delta, hands): same signature, default and
--     STRICT contract, now STABLE (it reads the switch row) and a call of the
--     rule with the switch. With no row, an off row, or the list migration not
--     yet installed it returns exactly what it returned before.
--
-- MEASURED: scripts/ci/test-horse-exploit-style-shift-release-postgres.py
-- installs this file on a scratch PostgreSQL 16 cluster and compares the rule
-- with HorseOpponentExploit.decayAndAddOpportunityScoped on 4,000 random rows,
-- each switch state, exactly; switch off it is byte-identical to the
-- 20261107022913 function on the same rows, and p_hands <> 1 keeps the
-- multi-hand rule in both states.
--
-- CREATE OR REPLACE FUNCTION only, one transaction: no table lock, no data
-- rewrite, no back-fill. Existing rows continue from their counters. Either
-- side may be installed first: an engine without the option never writes the
-- row, and this function reads no row as off.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_horse_exploit_add_rule(p_base jsonb,p_delta jsonb,p_hands bigint,p_noise_aware boolean)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog,public AS $fn$
DECLARE
 slow constant double precision := power(0.5::double precision,1.0/30);
 fast constant double precision := power(0.5::double precision,1.0/8);
 keys constant text[] := ARRAY['hands','vpip','pfr','rfiOpp','rfi','threeBetOpp','threeBet','foldTo3BetOpp','foldTo3Bet','betCheckedToOpp','betCheckedTo','foldToBetOpp','foldToBet','riverCallOpp','riverCall','fHands','fPfr','fRfiOpp','fRfi','fThreeBetOpp','fThreeBet','fBetCheckedToOpp','fBetCheckedTo','fFoldToBetOpp','fFoldToBet','fRiverCallOpp','fRiverCall'];
 gates constant jsonb := '{"rfiOpp":"rfiOpp","rfi":"rfiOpp","fRfiOpp":"fRfiOpp","fRfi":"fRfiOpp","threeBetOpp":"threeBetOpp","threeBet":"threeBetOpp","fThreeBetOpp":"fThreeBetOpp","fThreeBet":"fThreeBetOpp","foldTo3BetOpp":"foldTo3BetOpp","foldTo3Bet":"foldTo3BetOpp","betCheckedToOpp":"betCheckedToOpp","betCheckedTo":"betCheckedToOpp","fBetCheckedToOpp":"fBetCheckedToOpp","fBetCheckedTo":"fBetCheckedToOpp","foldToBetOpp":"foldToBetOpp","foldToBet":"foldToBetOpp","fFoldToBetOpp":"fFoldToBetOpp","fFoldToBet":"fFoldToBetOpp","riverCallOpp":"riverCallOpp","riverCall":"riverCallOpp","fRiverCallOpp":"fRiverCallOpp","fRiverCall":"fRiverCallOpp"}';
 pairs constant text[] := ARRAY['pfr','hands','fPfr','fHands','rfi','rfiOpp','fRfi','fRfiOpp','threeBet','threeBetOpp','fThreeBet','fThreeBetOpp','betCheckedTo','betCheckedToOpp','fBetCheckedTo','fBetCheckedToOpp','foldToBet','foldToBetOpp','fFoldToBet','fFoldToBetOpp','riverCall','riverCallOpp','fRiverCall','fRiverCallOpp'];
 released boolean := false; i integer; fo double precision; lo double precision;
 f text; g text; isfast boolean; factor double precision; acc jsonb := '{}'::jsonb;
 sl double precision; q double precision; released_all boolean := false; released_gates text[] := ARRAY[]::text[];
BEGIN
 -- A multi-hand import carries no per-hand opportunity record, so it keeps
 -- the per-hand rule it was written with.
 IF p_hands IS DISTINCT FROM 1 THEN
  RETURN (SELECT jsonb_object_agg(k,coalesce((p_base->>k)::double precision,0)*
   power(CASE WHEN left(k,1)='f' AND k NOT IN ('foldToBet','foldToBetOpp','foldTo3Bet','foldTo3BetOpp') THEN fast ELSE slow END,p_hands::double precision)
   +coalesce((p_delta->>k)::double precision,0)) FROM unnest(keys) k);
 END IF;
 IF NOT p_noise_aware THEN
 -- Style-shift release (HorseOpponentExploit.styleShiftReleased).
 -- Too thin a fast window to judge any rate: no release.
 IF coalesce((p_base->>'fHands')::double precision,0) >= 3 AND coalesce((p_base->>'hands')::double precision,0) > 0 THEN
 FOR i IN 0..5 LOOP
  fo := coalesce((p_base->>pairs[i*4+4])::double precision,0);
  lo := coalesce((p_base->>pairs[i*4+2])::double precision,0);
  IF fo >= 3 AND lo > 0 AND abs(coalesce((p_base->>pairs[i*4+3])::double precision,0)/fo
     - coalesce((p_base->>pairs[i*4+1])::double precision,0)/lo) >= 0.2 THEN
   released := true; EXIT;
  END IF;
 END LOOP;
 END IF;
 FOREACH f IN ARRAY keys LOOP
  g := gates->>f;
  isfast := left(f,1)='f' AND f NOT IN ('foldToBet','foldToBetOpp','foldTo3Bet','foldTo3BetOpp');
  IF isfast THEN factor := fast;
  ELSIF g IS NULL OR coalesce((p_delta->>g)::double precision,0) > 0 THEN
   factor := CASE WHEN released AND g IS NOT NULL THEN fast ELSE slow END;
  ELSE factor := CASE WHEN released THEN fast ELSE 1 END;
  END IF;
  acc := acc || jsonb_build_object(f, coalesce((p_base->>f)::double precision,0)*factor + coalesce((p_delta->>f)::double precision,0));
 END LOOP;
 RETURN acc;
 END IF;
 -- Noise-aware release (HorseOpponentExploit.styleShiftMoved, STYLE_SHIFT_NOISE_K 1.5):
 -- a statistic moved only beyond its sampling bound; pfr (pairs 0) releases
 -- every gated window, any other moved statistic only its own long window.
 IF coalesce((p_base->>'hands')::double precision,0) > 0 THEN
 FOR i IN 0..5 LOOP
  fo := coalesce((p_base->>pairs[i*4+4])::double precision,0);
  lo := coalesce((p_base->>pairs[i*4+2])::double precision,0);
  IF fo >= 3 AND lo > 0 THEN
   sl := coalesce((p_base->>pairs[i*4+1])::double precision,0);
   q := (sl + 0.5) / (lo + 1);
   IF abs(coalesce((p_base->>pairs[i*4+3])::double precision,0)/fo - sl/lo)
      >= greatest(0.2, 1.5 * sqrt((q * (1 - q)) / fo)) THEN
    IF i = 0 THEN released_all := true;
    ELSE released_gates := released_gates || pairs[i*4+2];
    END IF;
   END IF;
  END IF;
 END LOOP;
 END IF;
 FOREACH f IN ARRAY keys LOOP
  g := gates->>f;
  isfast := left(f,1)='f' AND f NOT IN ('foldToBet','foldToBetOpp','foldTo3Bet','foldTo3BetOpp');
  released := g IS NOT NULL AND (released_all OR g = ANY (released_gates));
  IF isfast THEN factor := fast;
  ELSIF g IS NULL OR coalesce((p_delta->>g)::double precision,0) > 0 THEN
   factor := CASE WHEN released THEN fast ELSE slow END;
  ELSE factor := CASE WHEN released THEN fast ELSE 1 END;
  END IF;
  acc := acc || jsonb_build_object(f, coalesce((p_base->>f)::double precision,0)*factor + coalesce((p_delta->>f)::double precision,0));
 END LOOP;
 RETURN acc;
END $fn$;

CREATE OR REPLACE FUNCTION public.fn_horse_style_shift_release_is_noise_aware()
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $fn$
 SELECT EXISTS (SELECT 1 FROM public.ca_horse_style_switch
                WHERE option = 'styleShiftReleaseIsNoiseAware' AND state = 'on')
$fn$;

CREATE OR REPLACE FUNCTION public.fn_horse_exploit_add(p_base jsonb,p_delta jsonb,p_hands bigint DEFAULT 1)
RETURNS jsonb LANGUAGE sql STABLE STRICT SET search_path=pg_catalog,public AS $fn$
 SELECT public.fn_horse_exploit_add_rule(p_base, p_delta, p_hands,
                                         public.fn_horse_style_shift_release_is_noise_aware())
$fn$;

REVOKE ALL ON FUNCTION public.fn_horse_exploit_add_rule(jsonb,jsonb,bigint,boolean),
  public.fn_horse_style_shift_release_is_noise_aware(),
  public.fn_horse_exploit_add(jsonb,jsonb,bigint)
  FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
