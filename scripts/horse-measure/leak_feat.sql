CREATE FUNCTION pg_temp.cls(ranks int[], suits text[], n int) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $c$
DECLARE i int; j int; cnt int; s text; dr int[]; lo int; run boolean; miss int; h1 int; h2 int; hits1 int := 0; hits2 int := 0; bmax int := 0; bpair boolean := false;
  made text := 'air'; fd boolean := false; sd boolean := false; sub text := '';
BEGIN
  h1 := ranks[1]; h2 := ranks[2];
  FOR i IN 3..(2+n) LOOP
    IF ranks[i] = h1 THEN hits1 := hits1 + 1; END IF;
    IF ranks[i] = h2 THEN hits2 := hits2 + 1; END IF;
    IF ranks[i] > bmax THEN bmax := ranks[i]; END IF;
    FOR j IN (i+1)..(2+n) LOOP IF ranks[i] = ranks[j] THEN bpair := true; END IF; END LOOP;
  END LOOP;
  IF h1 = h2 THEN
    IF hits1 > 0 THEN made := 'two_pair_plus'; ELSE made := 'one_pair'; sub := CASE WHEN h1 > bmax THEN 'top' ELSE 'under' END; END IF;
  ELSE
    IF hits1 >= 2 OR hits2 >= 2 OR (hits1 >= 1 AND hits2 >= 1) THEN made := 'two_pair_plus';
    ELSIF hits1 = 1 OR hits2 = 1 THEN
      IF bpair THEN made := 'two_pair_plus';
      ELSE made := 'one_pair'; sub := CASE WHEN (CASE WHEN hits1 = 1 THEN h1 ELSE h2 END) >= bmax THEN 'top' ELSE 'under' END; END IF;
    END IF;
  END IF;
  -- flush / straight among all cards
  FOREACH s IN ARRAY ARRAY['s','h','d','c'] LOOP
    cnt := 0; FOR i IN 1..(2+n) LOOP IF suits[i] = s THEN cnt := cnt + 1; END IF; END LOOP;
    IF cnt >= 5 THEN made := 'two_pair_plus'; END IF;
    IF cnt = 4 AND n < 5 AND (suits[1] = s OR suits[2] = s) THEN fd := true; END IF;
  END LOOP;
  dr := ARRAY(SELECT DISTINCT x FROM unnest(ranks[1:(2+n)]) x);
  IF 13 = ANY(dr) THEN dr := dr || 0; END IF;
  FOR lo IN 0..9 LOOP
    miss := 0;
    FOR i IN 0..4 LOOP IF NOT ((lo+i) = ANY(dr)) THEN miss := miss + 1; END IF; END LOOP;
    IF miss = 0 THEN made := 'two_pair_plus'; END IF;
    IF miss = 1 AND n < 5 THEN sd := true; END IF;
  END LOOP;
  IF made = 'two_pair_plus' THEN RETURN made; END IF;
  IF made = 'one_pair' THEN RETURN 'one_pair:' || sub; END IF;
  IF fd OR sd THEN RETURN 'draw'; END IF;
  RETURN 'air';
END $c$;

CREATE FUNCTION pg_temp.feat(hc jsonb, bd jsonb, ac jsonb, hero text, hseat int) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $f$
DECLARE
  a jsonb; pn jsonb; ranks int[] := '{}'; suits text[] := '{}'; rv int; s text; ok boolean := true; nb int;
  rank_order constant text := '23456789TJQKA';
  street text; uid text; act text; amt numeric; tocall numeric; pot numeric; bb numeric := 0; hstack numeric;
  out jsonb := '{}'::jsonb;
  -- preflop
  pre_raises int := 0; hero_first boolean := false; hero_opened boolean := false; hero_pre_last text := null;
  last_aggr text := null; pre_aggr_count int := 0; dealer int := null; maxseat int := 0;
  hpos text := 'other'; threebettor text := null; hero_3b_faced boolean := false;
  flop_players text[] := '{}';
  -- per street
  st_aggr int; st_hero_bet boolean; st_decided boolean; cur_street text := '';
  hole_cls text; tier text; suited boolean; h1 int; h2 int;
  sidx int; tidx int; idx int;
BEGIN
  IF hc IS NULL OR bd IS NULL OR ac IS NULL OR jsonb_typeof(hc) <> 'array' OR jsonb_typeof(ac) <> 'array' THEN RETURN NULL; END IF;
  FOR a IN SELECT value FROM jsonb_array_elements(hc || bd) LOOP
    IF jsonb_typeof(a) = 'object' THEN rv := position(upper(left(a->>'rank',1)) in rank_order); s := lower(left(a->>'suit',1));
    ELSIF jsonb_typeof(a) = 'string' AND length(a #>> '{}') = 2 THEN rv := position(upper(left(a #>> '{}',1)) in rank_order); s := lower(right(a #>> '{}',1));
    ELSE rv := 0; s := ''; END IF;
    IF rv = 0 OR s NOT IN ('s','h','d','c') THEN ok := false; END IF;
    ranks := ranks || rv; suits := suits || s;
  END LOOP;
  IF NOT ok OR jsonb_array_length(hc) <> 2 THEN RETURN NULL; END IF;
  nb := jsonb_array_length(bd);
  h1 := greatest(ranks[1], ranks[2]); h2 := least(ranks[1], ranks[2]); suited := suits[1] = suits[2];
  hole_cls := CASE WHEN h1 = h2 THEN 'pocket_pair'
                   WHEN h1 >= 9 AND h2 >= 9 THEN 'broadway'
                   WHEN suited AND h1 - h2 <= 2 THEN 'suited_connector'
                   WHEN suited AND h1 = 13 THEN 'suited_ace'
                   ELSE 'junk' END;
  tier := CASE WHEN (h1 = h2 AND h1 >= 11) OR (h1 = 13 AND h2 = 12) THEN 'premium'
               WHEN (h1 = h2 AND h1 >= 8) OR (h1 = 13 AND h2 = 11) OR (h1 = 13 AND h2 = 10 AND suited) OR (h1 = 12 AND h2 = 11 AND suited) THEN 'strong'
               WHEN (h1 = h2 AND h1 >= 5) OR (h1 = 13 AND suited) OR (h1 = 13 AND h2 >= 9) OR (h1 >= 10 AND h2 >= 9) THEN 'medium'
               ELSE 'weak' END;
  out := out || jsonb_build_object('hole', hole_cls, 'tier', tier);

  -- forced posts: position
  FOR a IN SELECT value FROM jsonb_array_elements(ac) LOOP
    IF a->>'userId' = hero AND a->>'action' = 'sb' THEN hpos := 'sb'; END IF;
    IF a->>'userId' = hero AND a->>'action' = 'bb' THEN hpos := 'bb'; END IF;
    IF a ? 'publicNode' AND dealer IS NULL THEN dealer := (a->'publicNode'->>'dealerSeat')::int; bb := coalesce((a->'publicNode'->>'bigBlind')::numeric, 0);
      SELECT coalesce(max((x->>0)::int),0) INTO maxseat FROM jsonb_array_elements(a->'publicNode'->'seats') x; END IF;
  END LOOP;
  IF hpos = 'other' AND dealer IS NOT NULL AND hseat = dealer THEN hpos := 'btn'; END IF;
  IF bb <= 0 THEN RETURN NULL; END IF;
  out := out || jsonb_build_object('pos', hpos);

  FOR a IN SELECT value FROM jsonb_array_elements(ac) LOOP
    street := a->>'stage'; uid := a->>'userId'; act := a->>'action';
    IF street IS NULL OR uid IS NULL OR act IN ('sb','bb','straddle','post','ante','return','uncalled') THEN CONTINUE; END IF;
    IF street <> cur_street THEN cur_street := street; st_aggr := 0; st_hero_bet := false; st_decided := false; END IF;
    IF street = 'flop' AND NOT (uid = ANY(flop_players)) THEN flop_players := flop_players || uid; END IF;
    pn := a->'publicNode';
    amt := CASE WHEN jsonb_typeof(a->'amount') = 'number' THEN (a->>'amount')::numeric ELSE 0 END;
    tocall := coalesce((pn->>'toCall')::numeric, 0); pot := coalesce((pn->>'pot')::numeric, 0);

    IF uid = hero AND pn IS NOT NULL THEN
      SELECT (x->>1)::numeric INTO hstack FROM jsonb_array_elements(pn->'seats') x WHERE (x->>0)::int = hseat LIMIT 1;
      IF street = 'preflop' THEN
        IF NOT hero_first THEN
          hero_first := true;
          out := out || jsonb_build_object('pre_first', jsonb_build_object('raises_before', st_aggr, 'act', act, 'open_bb', round(coalesce((pn->>'currentBet')::numeric,0)/bb,2), 'tocall_bb', round(tocall/bb,2), 'pot_bb', round(pot/bb,2), 'stack_bb', round(coalesce(hstack,0)/bb,1)));
          IF act IN ('raise','all_in') AND st_aggr = 0 THEN hero_opened := true; END IF;
        ELSIF hero_opened AND NOT hero_3b_faced AND tocall > 0 THEN
          hero_3b_faced := true;
          sidx := ((hseat - coalesce(dealer,0) - 1 + 2*greatest(maxseat,1)) % greatest(maxseat,1));
          tidx := CASE WHEN threebettor IS NULL THEN null ELSE 0 END;
          out := out || jsonb_build_object('pre_3b', jsonb_build_object('act', act, 'tocall_bb', round(tocall/bb,2), 'pot_bb', round(pot/bb,2), 'ip', (sidx > coalesce((out->>'_tb_idx')::int, -1)), 'stack_bb', round(coalesce(hstack,0)/bb,1)));
        END IF;
        IF act = 'all_in' OR (act = 'call' AND hstack IS NOT NULL AND hstack <= tocall) THEN
          IF NOT (out ? 'pre_allin') THEN
            out := out || jsonb_build_object('pre_allin', jsonb_build_object('kind', CASE WHEN act = 'all_in' AND tocall = 0 THEN 'shove_open' WHEN act = 'all_in' THEN 'shove_over' ELSE 'call_allin' END, 'stack_bb', round((coalesce(hstack,0) + coalesce((pn->>'currentBet')::numeric,0) - tocall)/bb,1), 'raises_before', st_aggr));
          END IF;
        END IF;
      ELSE
        IF tocall > 0 AND NOT st_decided THEN
          st_decided := true;
          out := out || jsonb_build_object(street, jsonb_build_object(
            'cls', pg_temp.cls(ranks, suits, CASE street WHEN 'flop' THEN 3 WHEN 'turn' THEN 4 ELSE 5 END),
            'act', act,
            'frac', CASE WHEN pot - tocall > 0 THEN round(tocall/(pot - tocall),2) ELSE 1 END,
            'tocall_bb', round(tocall/bb,1), 'pot_bb', round(pot/bb,1),
            'aggr', st_aggr, 'after_own_bet', st_hero_bet,
            'vs_pfa', (last_aggr IS NOT NULL AND last_aggr <> hero AND street = 'flop'),
            'allin_price', (hstack IS NOT NULL AND hstack <= tocall)));
        ELSIF tocall = 0 AND act IN ('bet','all_in') THEN
          st_hero_bet := true;
          IF street = 'river' AND st_aggr = 0 THEN
            out := out || jsonb_build_object('river_bet', jsonb_build_object('cls', pg_temp.cls(ranks, suits, 5), 'frac', CASE WHEN pot > 0 THEN round(amt/pot,2) ELSE 1 END, 'bet_bb', round(amt/bb,1)));
          END IF;
        END IF;
      END IF;
    END IF;

    IF act IN ('bet','raise') OR (act = 'all_in' AND (a ? 'isFullRaise')) THEN
      st_aggr := st_aggr + 1;
      IF street = 'preflop' THEN
        IF hero_opened AND uid <> hero AND threebettor IS NULL THEN threebettor := uid;
          out := out || jsonb_build_object('_tb_idx', ((coalesce((a->>'seat')::int, 0) - coalesce(dealer,0) - 1 + 2*greatest(maxseat,1)) % greatest(maxseat,1))); END IF;
        last_aggr := uid;
      END IF;
    END IF;
  END LOOP;
  out := out || jsonb_build_object('n_flop', coalesce(array_length(flop_players,1),0), 'nb', nb);
  RETURN out;
END $f$;
