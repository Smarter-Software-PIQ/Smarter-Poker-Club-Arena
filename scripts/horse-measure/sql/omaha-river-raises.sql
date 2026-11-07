-- Horse river-raise evidence for the V15 raise gate (2026-11-07, the scope of
-- v15RiverNoNearLock). Every horse Omaha (plo4, plo5, plo6, plo8, flo8) RIVER
-- decision facing a wager (toCall > 0) that CALLED or RAISED (a raise, or an
-- all-in above the current bet), classified at the decision with the same
-- reads the V15 gate uses (omahaNutStatus in HorseEval.ts, re-implemented in
-- pg_temp.v15cls below; the TypeScript check is in
-- docs/horse-measure/2026-11-07/v15-river-raise-scope.md):
--   flush_<nut|second|third_plus>_<paired|unpaired>  (higherFlushRanks 0 / 1 / 2+)
--   straight_<nut|nonnut>[_flushboard][_paired]       (straightIsNut, boardMono15, boardPaired15)
--   boat_plus, below_straight
-- The decision EV is the V81 one: (net + chips already invested at the node)
-- over bb, the action's value against folding, later actions included.
-- Output is AGGREGATED: raise_ev = [day, class, slice (variant / format /
-- wager >= 0.8 pot, '' for the whole class), n decisions, g hands, mean EV bb,
-- 95% CI low, high], CIs clustered by hand (SE = sqrt(g/(g-1) *
-- sum_h (s_h - m n_h)^2) / n), over the FIRST river raise facing a wager
-- (the horse had not bet or raised this river yet), bomb pots apart; counts =
-- [day, class, calls, first raises, re-raises, bomb-pot raises]. Folds are not
-- selected: the EV is raise (or call) against folding, never raise against
-- calling. A full UTC day runs in one call.
-- Read-only: one pg_temp helper (session temp schema) and one SELECT.
CREATE OR REPLACE FUNCTION pg_temp.v15cls(hc jsonb, bd text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $c$
DECLARE
  hr int[] := '{}'; hs text[] := '{}'; br int[] := '{}'; bs text[] := '{}';
  nh int; i int; j int; a int; b int; c int; r5 int[]; s5 text[];
  best int := 0; sc int; st int; mx int; dist int; fl boolean; cat int;
  paired boolean; mono boolean; suit text; htop int; higher int; seen int[]; btop int; cnt int; k int; rr int;
BEGIN
  IF bd IS NULL OR length(bd) <> 10 THEN RETURN 'not_river'; END IF;
  nh := jsonb_array_length(hc);
  FOR i IN 0..nh - 1 LOOP
    hr := hr || (position(hc->i->>'rank' in '23456789TJQKA') + 1);
    hs := hs || left(hc->i->>'suit', 1);
  END LOOP;
  FOR i IN 0..4 LOOP
    br := br || (position(substr(bd, 2 * i + 1, 1) in '23456789TJQKA') + 1);
    bs := bs || substr(bd, 2 * i + 2, 1);
  END LOOP;
  FOR i IN 1..nh - 1 LOOP FOR j IN i + 1..nh LOOP
    FOR a IN 1..3 LOOP FOR b IN a + 1..4 LOOP FOR c IN b + 1..5 LOOP
      r5 := ARRAY[hr[i], hr[j], br[a], br[b], br[c]];
      s5 := ARRAY[hs[i], hs[j], bs[a], bs[b], bs[c]];
      fl := s5[1] = s5[2] AND s5[2] = s5[3] AND s5[3] = s5[4] AND s5[4] = s5[5];
      SELECT count(DISTINCT x), max(m) INTO dist, mx FROM (SELECT x, count(*) OVER (PARTITION BY x) m FROM unnest(r5) x) q;
      st := 0;
      IF dist = 5 THEN
        IF (SELECT max(x) - min(x) FROM unnest(r5) x) = 4 THEN st := (SELECT max(x) FROM unnest(r5) x);
        ELSIF r5 @> ARRAY[14, 2, 3, 4, 5] THEN st := 5; END IF;
      END IF;
      cat := CASE WHEN fl AND st > 0 THEN 9 WHEN mx = 4 THEN 8 WHEN mx = 3 AND dist = 2 THEN 7
                  WHEN fl THEN 6 WHEN st > 0 THEN 5 ELSE 0 END;
      sc := cat * 100 + CASE WHEN cat = 5 THEN st ELSE 0 END;
      IF sc > best THEN best := sc; END IF;
    END LOOP; END LOOP; END LOOP;
  END LOOP; END LOOP;
  cat := best / 100;
  IF cat >= 7 THEN RETURN 'boat_plus'; END IF;
  IF cat < 5 THEN RETURN 'below_straight'; END IF;
  paired := (SELECT count(DISTINCT x) FROM unnest(br) x) < 5;
  mono := (SELECT max(n) FROM (SELECT count(*) n FROM unnest(bs) x GROUP BY x) q) >= 3;
  IF cat = 6 THEN
    FOREACH suit IN ARRAY ARRAY['h', 'd', 'c', 's'] LOOP
      IF (SELECT count(*) FROM unnest(bs) x WHERE x = suit) >= 3
         AND (SELECT count(*) FROM unnest(hs) x WHERE x = suit) >= 2 THEN
        htop := 0; seen := '{}';
        FOR i IN 1..nh LOOP IF hs[i] = suit THEN htop := greatest(htop, hr[i]); seen := seen || hr[i]; END IF; END LOOP;
        FOR i IN 1..5 LOOP IF bs[i] = suit THEN seen := seen || br[i]; END IF; END LOOP;
        higher := 0;
        FOR rr IN htop + 1..14 LOOP IF NOT (rr = ANY (seen)) THEN higher := higher + 1; END IF; END LOOP;
        RETURN 'flush_' || CASE higher WHEN 0 THEN 'nut' WHEN 1 THEN 'second' ELSE 'third_plus' END
               || CASE WHEN paired THEN '_paired' ELSE '_unpaired' END;
      END IF;
    END LOOP;
    RETURN 'flush_unknown';
  END IF;
  btop := 0;
  FOR k IN REVERSE 14..5 LOOP
    cnt := 0;
    FOR i IN 0..4 LOOP rr := CASE WHEN k - i = 1 THEN 14 ELSE k - i END; IF rr = ANY (br) THEN cnt := cnt + 1; END IF; END LOOP;
    IF cnt >= 3 THEN btop := k; EXIT; END IF;
  END LOOP;
  RETURN 'straight_' || CASE WHEN btop <= best % 100 THEN 'nut' ELSE 'nonnut' END
         || CASE WHEN mono THEN '_flushboard' ELSE '' END || CASE WHEN paired THEN '_paired' ELSE '' END;
END $c$;
with cand as (
  select f.hand_id, f.user_id::text uid, f.net, f.hole_cards, f.game_variant v, f.played_at
  from public.ca_hand_facts f
  where f.played_at >= :START::timestamptz and f.played_at < :END::timestamptz
    and f.game_variant in ('plo4', 'plo5', 'plo6', 'plo8', 'flo8')
    and coalesce(f.passive_actions_river, 0) + coalesce(f.aggressive_actions_river, 0) > 0
    and exists (select 1 from public.profiles p where p.id = f.user_id and p.is_horse)
),
j as (
  select cand.*, h.tournament_id, h.big_blind bb, h.actions, (h.bomb_pot is not null) bomb, (h.community_cards2 is not null) multi
  from cand join public.hand_history h on h.id = cand.hand_id
),
sp as (
  select j.*, a.ord, a.e->'publicNode' pn,
    case when a.e->>'action' = 'call' or (a.e->>'action' = 'all_in' and (a.e->>'amount')::numeric <= (a.e->'publicNode'->>'currentBet')::numeric)
         then 'call' else 'raise' end kind,
    case when exists (select 1 from jsonb_array_elements(j.actions) with ordinality p(e3, o3)
                      where p.o3 < a.ord and p.e3->>'stage' = 'river' and p.e3->>'userId' = j.uid
                        and p.e3->>'action' in ('bet', 'raise', 'all_in')) then 1 else 0 end own
  from j cross join lateral jsonb_array_elements(j.actions) with ordinality a(e, ord)
  where a.e->>'userId' = j.uid and a.e->>'origin' = 'horse_policy' and a.e->>'stage' = 'river'
    and a.e->>'action' in ('call', 'raise', 'all_in')
    and (a.e->'publicNode'->>'toCall')::numeric > 0
),
d as (
  select sp.hand_id, to_char(sp.played_at at time zone 'UTC', 'YYYY-MM-DD') dy, sp.v,
    case when sp.tournament_id is null then 'cash' else 'mtt' end fmt,
    case when sp.multi then 'multi_board' else pg_temp.v15cls(sp.hole_cards, sp.pn->'boards'->>0) end cls,
    sp.kind, sp.own, sp.bomb,
    case when b.pot_before > 0 and b.wager / b.pot_before >= 0.8 then 'pf>=0.8' else 'pf<0.8' end pf,
    (sp.net + coalesce((select (s->>3)::numeric from jsonb_array_elements(sp.pn->'seats') s
                        where (s->>0)::int = (sp.pn->>'actorSeat')::int), 0)) / nullif(sp.bb, 0) ev
  from sp
  left join lateral (
     select (x.e2->>'amount')::numeric - coalesce((select (s->>2)::numeric from jsonb_array_elements(x.e2->'publicNode'->'seats') s
                                                   where (s->>0)::int = (x.e2->'publicNode'->>'actorSeat')::int), 0) wager,
            (x.e2->'publicNode'->>'pot')::numeric pot_before
     from jsonb_array_elements(sp.actions) with ordinality x(e2, o2)
     where x.o2 < sp.ord and x.e2->>'stage' = 'river' and x.e2->>'action' in ('bet', 'raise', 'all_in')
     order by x.o2 desc limit 1) b on true
),
dc as (select * from d where cls not in ('below_straight', 'not_river', 'boat_plus') and ev is not null),
hand as (
  select dy, v, fmt, cls, kind, own, bomb, pf, hand_id, count(*) hn, sum(ev) hs
  from dc group by dy, v, fmt, cls, kind, own, bomb, pf, hand_id
),
cell as (
  -- the raise cells: first river raise facing a wager (own 0), bomb pots apart,
  -- by class alone and by class x variant / format / wager size
  select dy, cls, coalesce(v, '') || coalesce(fmt, '') || coalesce(pf, '') slice,
    sum(hn) n, count(*) g, sum(hs) s, sum(hs * hs) s2, sum(hs * hn) sn, sum(hn * hn) n2
  from hand where kind = 'raise' and own = 0 and not bomb
  group by grouping sets ((dy, cls), (dy, cls, v), (dy, cls, fmt), (dy, cls, pf))
),
ci as (
  select dy, cls, slice, n, g, s / n m,
    case when g > 1 then sqrt(greatest(0, g::numeric / (g - 1) * (s2 - 2 * (s / n) * sn + (s / n) ^ 2 * n2))) / n end se
  from cell
),
cnt as (
  -- how often each class raises at all: decisions by kind (re-raises apart, bomb pots apart)
  select dy, cls, sum(hn) filter (where kind = 'call') calls,
    sum(hn) filter (where kind = 'raise' and own = 0 and not bomb) raises,
    sum(hn) filter (where kind = 'raise' and own = 1 and not bomb) reraises,
    sum(hn) filter (where kind = 'raise' and bomb) bomb_raises
  from hand group by dy, cls
)
select jsonb_build_object(
  'raise_ev', (select coalesce(jsonb_agg(jsonb_build_array(dy, cls, slice, n, g, round(m, 1), round(m - 1.96 * se, 1), round(m + 1.96 * se, 1)) order by dy, cls, slice), '[]') from ci),
  'counts', (select coalesce(jsonb_agg(jsonb_build_array(dy, cls, calls, raises, reraises, bomb_raises) order by dy, cls), '[]') from cnt)) result
