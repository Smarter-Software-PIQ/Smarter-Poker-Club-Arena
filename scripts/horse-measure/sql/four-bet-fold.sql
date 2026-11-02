-- Horse release verification: 4-BET-THEN-FOLD by variant and format.
-- A horse 4-bet preflop (ca_hand_facts.four_bet), never saw the flop, was not
-- all in and lost chips: it folded after its 4-bet was re-raised. Measured
-- 2026-11-02 04:00-16:00 UTC on the pre-rule-4 engine: nlh cash 58 of 441,
-- nlh tournament 25 of 777; every pot-limit Omaha, short-deck and limit
-- variant 2 of 1,000+ combined. Rules 4/4a/4b should take nlh to near zero
-- (HorseFourBetThenFoldRealHands.law.test.ts replays the 83 real hands).
-- The flags are a proxy (four_bet is computed by the stats builder): in the
-- 04:00-16:00 window every one of the 83 flagged hands parsed from its own
-- actions as a horse raise followed by a horse fold. A timeout or disconnect
-- fold would also count; treat a single-digit change as noise.
-- Windowed [:START, :END), keep <= ~12 hours per call. Read-only (one SELECT).
select f.game_variant, case when f.tournament_id is null then 'cash' else 'tour' end fmt,
  count(*) four_bets,
  count(*) filter (where not f.saw_flop and not f.was_all_in and f.net < 0) four_bet_then_fold
from public.ca_hand_facts f
where f.played_at >= :START::timestamptz and f.played_at < :END::timestamptz and f.four_bet
  and exists (select 1 from public.profiles p where p.id = f.user_id and p.is_horse)
group by 1, 2 order by 1, 2;
