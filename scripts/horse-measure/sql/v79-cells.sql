-- Horse release verification: V79 CELLS (decision EV of horse calls).
-- EV of a call, bb = (net + chips the horse had already invested at the
-- node) / bb: chops carry their fractional return and turn calls include all
-- later betting. Source hand_history + ca_hand_facts (every hand kept).
-- Cells match the merged rule (HorseLogic v79InMeasuredCell): A = wager >=
-- 0.9 pot, board top Q+, effective > 60bb, not a heads-up table, not a bounty
-- event; B = 0.6-0.9 pot, ace-high, non-tournament, heads-up, > 60bb, not a
-- heads-up table. After V79 activates, weak-kicker calls in A and B should
-- become rare; the strong-kicker rows and N* neighbours are context.
-- Output rows are 'label|kicker|n|hands|sum|sum_sq_hand|sum_hand_x_n|sum_n_sq|chops|chop_ev|grid';
-- combine slices with horse-release-verify.py combine-v79. Windowed
-- [:START, :END), keep <= ~1 day per call. Read-only (one SELECT).
with cand as (
  select f.hand_id, f.user_id::text uid, f.net,
    strpos('23456789TJQKA', f.hole_cards->0->>'rank')+1 h1, strpos('23456789TJQKA', f.hole_cards->1->>'rank')+1 h2
  from public.ca_hand_facts f
  where f.played_at >= :START::timestamptz and f.played_at < :END::timestamptz and f.game_variant='nlh'
    and coalesce(f.passive_actions_turn,0)+coalesce(f.passive_actions_river,0)>0
    and f.hole_cards->0->>'rank' <> f.hole_cards->1->>'rank'
),
j as (
  select cand.*, h.tournament_id, h.big_blind bb, h.actions, h.pots
  from cand join public.hand_history h on h.id=cand.hand_id
  cross join lateral (select max(strpos('23456789TJQKA', left(b,1))+1) filter (where i<=4) t4, max(strpos('23456789TJQKA', left(b,1))+1) t5
                      from jsonb_array_elements_text(h.board) with ordinality q(b,i) where i<=5) bt
  where h.game_variant='nlh' and jsonb_array_length(h.board)>=4
    and (cand.h1 in (bt.t4,bt.t5) or cand.h2 in (bt.t4,bt.t5))
),
sp as (   -- horse calls (incl. all-in calls) facing a turn/river bet/raise, no prior hero bet/raise on that street
  select j.*, a.ord, a.e->'publicNode' pn, a.e->>'stage' street
  from j cross join lateral jsonb_array_elements(j.actions) with ordinality a(e,ord)
  where a.e->>'userId'=j.uid and a.e->>'origin'='horse_policy' and a.e->>'stage' in ('turn','river')
    and a.e->>'action' in ('call','all_in')
    and (a.e->'publicNode'->>'toCall')::numeric > 0
    and (a.e->>'action'='call' or (a.e->>'amount')::numeric <= (a.e->'publicNode'->>'currentBet')::numeric)
    and not exists (select 1 from jsonb_array_elements(j.actions) with ordinality p(e3,o3)
                    where p.o3 < a.ord and p.e3->>'stage'=a.e->>'stage' and p.e3->>'userId'=j.uid and p.e3->>'action' in ('bet','raise','all_in'))
),
t as (
  select sp.*, br, (select max(x) from unnest(br) x) top
  from sp cross join lateral (select array_agg(strpos('23456789TJQKA', substr(pn->'boards'->>0, 2*i-1, 1))+1) br
                              from generate_series(1, length(pn->'boards'->>0)/2) i) z
),
tp as (   -- top pair: board top rank unpaired on board, hero holds exactly one card of it, other card does not pair board
  select t.*, case when h1=top then h2 else h1 end kick from t
  where (select count(*) from unnest(br) x where x=top)=1
    and ((h1=top and h2<>top) or (h2=top and h1<>top))
    and not (case when h1=top then h2 else h1 end) = any(br)
),
s as (
  select tp.hand_id, tp.uid, tp.street, tp.bb, tp.top, tp.kick, tp.net,
    case when tp.tournament_id is not null then 'tournament'
         when exists (select 1 from public.lightning_hand l where l.hand_id=tp.hand_id) then 'lightning'
         when jsonb_array_length(pn->'seats')=2 then 'hu_cash' else 'cash' end fmt,
    (select count(*) from jsonb_array_elements(pn->'seats') s where s->>6 in ('0','2')) n_active,
    (jsonb_array_length(pn->'seats') = 2) hu_table,
    coalesce((select (tt.is_bounty or tt.is_pko or tt.is_mystery_bounty) from public.tournaments tt where tt.id = tp.tournament_id), false) bounty,
    hs, b.wager, b.pot_before,
    (select s2 from jsonb_array_elements(pn->'seats') s2 where (s2->>0)::int=b.bseat) bs,
    exists (select 1 from jsonb_array_elements(tp.actions) with ordinality x(e4,o4) where x.o4>tp.ord and x.e4->>'userId'=tp.uid
            and x.e4->>'stage'='river' and x.e4->>'action' in ('call','bet','raise','all_in') and (x.e4->>'amount')::numeric>0) more_river,
    exists (select 1 from jsonb_array_elements(coalesce(tp.pots,'[]')) pt where jsonb_array_length(pt->'awards')>1
            and exists (select 1 from jsonb_array_elements(pt->'awards') aw where aw->>'userId'=tp.uid)) chop
  from tp
  cross join lateral (select s from jsonb_array_elements(pn->'seats') s where (s->>0)::int=(pn->>'actorSeat')::int) h(hs)
  cross join lateral (   -- the wager faced: last bet/raise/all-in on this street that set currentBet
     select (x.e2->'publicNode'->>'actorSeat')::int bseat,
            (x.e2->>'amount')::numeric - coalesce((select (s->>2)::numeric from jsonb_array_elements(x.e2->'publicNode'->'seats') s where (s->>0)::int=(x.e2->'publicNode'->>'actorSeat')::int),0) wager,
            (x.e2->'publicNode'->>'pot')::numeric pot_before
     from jsonb_array_elements(tp.actions) with ordinality x(e2,o2)
     where x.o2 < tp.ord and x.e2->>'stage'=tp.street and x.e2->>'action' in ('bet','raise','all_in')
       and (x.e2->>'amount')::numeric = (pn->>'currentBet')::numeric
     order by x.o2 desc limit 1) b
),
f as (
  select s.*, wager/nullif(pot_before,0) pf,
    least((hs->>1)::numeric+(hs->>2)::numeric, (bs->>1)::numeric+(bs->>2)::numeric)/bb eff_bb,
    (net + (hs->>3)::numeric)/bb ev_bb,
    case when kick<=9 then 'weak_2_9' else 'strong_T+' end kc,
    case when n_active>2 then 'mw' else 'hu' end hm
  from s
),
lab as (
  select f.*, l.label from f cross join lateral unnest(array_remove(array[
     case when pf>=0.9 and top>=12 and eff_bb>60 and not hu_table and not bounty then 'A' end,
     case when pf>=0.9 and top>=12 and eff_bb>60 and not hu_table and not bounty then 'A.'||street end,
     case when pf>=0.9 and top>=12 and eff_bb>60 and not hu_table and not bounty then 'A.fmt.'||fmt end,
     case when pf>=0.9 and top>=12 and eff_bb>60 and not hu_table and not bounty then 'A.'||hm end,
     case when pf>=0.9 and top>=12 and eff_bb>60 and not hu_table and not bounty and street='turn' then 'A.turn.'||case when more_river then 'more_river' else 'last_commit' end end,
     case when pf>=0.6 and pf<0.9 and top=14 and fmt<>'tournament' and eff_bb>60 and hm='hu' and not hu_table then 'B' end,
     case when pf>=0.6 and pf<0.9 and top=14 and fmt<>'tournament' and eff_bb>60 and hm='hu' and not hu_table then 'B.'||street end,
     case when pf>=0.6 and pf<0.9 and top=14 and fmt<>'tournament' and eff_bb>60 and hm='hu' and not hu_table then 'B.'||hm end,
     case when pf>=0.6 and pf<0.9 and top=14 and fmt<>'tournament' and eff_bb>60 and hm='hu' and not hu_table and street='turn' then 'B.turn.'||case when more_river then 'more_river' else 'last_commit' end end,
     case when pf>=0.6 and pf<0.9 and top in (12,13) and fmt<>'tournament' and eff_bb>60 then 'N1.pf0.6-0.9_KorQhigh_nontour' end,
     case when pf>=0.6 and pf<0.9 and top=14 and fmt='tournament' and eff_bb>60 then 'N2.pf0.6-0.9_Ahigh_tournament' end,
     case when pf>=0.6 and top<=11 and eff_bb>60 then 'N3.pf>=0.6_JhighOrLower' end,
     case when pf>=0.6 and top>=12 and eff_bb<=60 then 'N4.pf>=0.6_eff<=60bb' end
  ], null)) l(label)
  -- A row with no readable EV (null net or a short seat array) would count in n
  -- but not in the sum, pulling the mean toward 0: drop it from every aggregate.
  where f.ev_bb is not null
),
hc as (select label, kc, hand_id, count(*) n_h, sum(ev_bb) s_h from lab group by 1,2,3)
select label||'|'||kc||'|'||sum(n_h)||'|'||count(*)||'|'||round(sum(s_h),3)||'|'||round(sum(s_h*s_h),2)||'|'||round(sum(s_h*n_h),3)||'|'||sum(n_h*n_h)
  ||'|'||(select sum(chop::int)||'|'||round(coalesce(sum(ev_bb) filter (where chop),0),2)||'|'||array_to_string(array[
     count(*) filter (where ev_bb<=-100),count(*) filter (where ev_bb<=-75),count(*) filter (where ev_bb<=-50),count(*) filter (where ev_bb<=-40),
     count(*) filter (where ev_bb<=-30),count(*) filter (where ev_bb<=-25),count(*) filter (where ev_bb<=-20),count(*) filter (where ev_bb<=-15),
     count(*) filter (where ev_bb<=-10),count(*) filter (where ev_bb<=-7.5),count(*) filter (where ev_bb<=-5),count(*) filter (where ev_bb<=-2.5),
     count(*) filter (where ev_bb<=0),count(*) filter (where ev_bb<=2.5),count(*) filter (where ev_bb<=5),count(*) filter (where ev_bb<=7.5),
     count(*) filter (where ev_bb<=10),count(*) filter (where ev_bb<=15),count(*) filter (where ev_bb<=20),count(*) filter (where ev_bb<=30),
     count(*) filter (where ev_bb<=50),count(*) filter (where ev_bb<=100)],',') from lab l2 where l2.label=hc.label and l2.kc=hc.kc) r
from hc group by label, kc order by 1;
