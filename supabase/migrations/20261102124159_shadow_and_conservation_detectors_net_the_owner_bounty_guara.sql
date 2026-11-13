-- THE SHADOW NETS EVERY OVERLAY RETURN, NOT ONLY A VOID'S (2026-11-02).
--
-- Owner-authorized correction of 40 Chip Bounty Freezeout - 5K GTD (NLH)
-- (6b72abc3, scripts/operations/owner-bounty-guarantee-6b72abc3.sql, #9292)
-- returned 950 of its guarantee overlay to the union bank as one 'reversal'
-- leg out of prize_liability with metadata.kind =
-- 'owner_bounty_guarantee_correction', and took it out of the maintained
-- escrow (overlay_in 2530 -> 1580). The three read-only detectors net only
-- kind = 'reviewed_void_overlay_return', so they still counted the 950 as
-- overlay in the pool:
--   fn_ca_tournament_escrow_chips    shadow prize_balance 950 vs escrow 0
--                                    -> fn_ca_escrow_balance_drift incident
--   fn_tournament_conservation_delta(s) delta +950 "retained money it never
--                                    paid out" -> fn_tournament_money_conservation
-- The money is where it belongs (escrow terminal receipt: exact zero; bank
-- credited 950). This changes only what the three detectors read; no money
-- moves, no money-moving function changes, and every other predicate on the
-- reversal leg (category, from_type, from_entity_id) is unchanged.
-- @live-proof: position('owner_bounty_guarantee_correction' in pg_get_functiondef('public.fn_ca_tournament_escrow_chips(uuid)'::regprocedure))>0 AND position('owner_bounty_guarantee_correction' in pg_get_functiondef('public.fn_tournament_conservation_delta(uuid)'::regprocedure))>0 AND position('owner_bounty_guarantee_correction' in pg_get_functiondef('public.fn_tournament_conservation_deltas(timestamp with time zone,timestamp with time zone)'::regprocedure))>0
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';
DO $patch$
DECLARE
  d text;
  entry record;
BEGIN
  FOR entry IN SELECT * FROM (VALUES
    ('public.fn_ca_tournament_escrow_chips(uuid)',
     '5f97235a4eab2337c32db4f66ec0ea1b',
     $o$AND r.metadata->>'kind'='reviewed_void_overlay_return') AS returned$o$,
     $n$AND r.metadata->>'kind' IN ('reviewed_void_overlay_return','owner_bounty_guarantee_correction')) AS returned$n$),
    ('public.fn_tournament_conservation_delta(uuid)',
     '5dfb94036540ff7bdab61c4a91ff7ed6',
     $o$AND r.metadata->>'kind' = 'reviewed_void_overlay_return'), 0)$o$,
     $n$AND r.metadata->>'kind' IN ('reviewed_void_overlay_return', 'owner_bounty_guarantee_correction')), 0)$n$),
    ('public.fn_tournament_conservation_deltas(timestamp with time zone,timestamp with time zone)',
     '42ba1e0ca23edb232eae99433b152bfd',
     $o$AND l.metadata->>'kind' = 'reviewed_void_overlay_return'$o$,
     $n$AND l.metadata->>'kind' IN ('reviewed_void_overlay_return', 'owner_bounty_guarantee_correction')$n$)
  ) AS x(signature, expected, old_text, new_text) LOOP
    SELECT pg_get_functiondef(p.oid) INTO STRICT d
      FROM pg_proc p
     WHERE p.oid = entry.signature::regprocedure
       AND md5(p.prosrc) = entry.expected;
    IF (length(d) - length(replace(d, entry.old_text, ''))) / length(entry.old_text) <> 1 THEN
      RAISE EXCEPTION '% does not contain its overlay-return predicate exactly once', entry.signature;
    END IF;
    EXECUTE replace(d, entry.old_text, entry.new_text);
  END LOOP;
END;
$patch$;

-- Postcondition: the corrected event now balances in both detectors.
DO $check$
DECLARE
  t constant uuid := '6b72abc3-bd16-488c-aea5-54b1eace98d5';
  e record;
  x record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tournaments WHERE id = t) THEN RETURN; END IF;
  SELECT * INTO STRICT e FROM public.fn_ca_tournament_escrow(t);
  SELECT * INTO STRICT x FROM public.tournament_escrow WHERE tournament_id = t;
  IF abs(x.prize_balance - (e.prize_balance - x.reserve_out + x.reserve_in)) > 0.01
     OR abs(x.bounty_balance - e.bounty_balance) > 0.01
     OR abs(x.fee_balance - e.fee_balance) > 0.01 THEN
    RAISE EXCEPTION 'escrow shadow still disagrees for %', t;
  END IF;
  IF abs(COALESCE(public.fn_tournament_conservation_delta(t), 0)) > 0.05 THEN
    RAISE EXCEPTION 'conservation delta still % for %', public.fn_tournament_conservation_delta(t), t;
  END IF;
END;
$check$;
COMMIT;
