-- Byte-exact production definitions (pg_get_functiondef, read 2026-11-08) of the
-- frozen v1 public215 encoder closure the v2 chain builds on. Do not edit.
CREATE TYPE public.gto_v31_public215_tree AS (feature smallint[], threshold double precision[], left_child smallint[], right_child smallint[], leaf_value double precision[]);
CREATE TYPE public.gto_v31_public215_head AS (baseline double precision, trees public.gto_v31_public215_tree[]);
CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_f64(p_hex text)
 RETURNS double precision
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE b bytea;e integer;m bigint;v double precision;i integer;
BEGIN
 IF p_hex!~'^[0-9a-f]{16}$' THEN RAISE EXCEPTION 'public215 f64 word';END IF;
 b:=decode(p_hex,'hex');e:=((get_byte(b,0)&127)<<4)|(get_byte(b,1)>>4);
 IF e=2047 THEN RAISE EXCEPTION 'public215 nonfinite f64';END IF;
 m:=get_byte(b,1)&15;FOR i IN 2..7 LOOP m:=m*256+get_byte(b,i);END LOOP;
 IF e=0 THEN v:=(m::double precision/4503599627370496::double precision)*power(2::double precision,-1022::double precision);
 ELSE v:=(1::double precision+m::double precision/4503599627370496::double precision)*power(2::double precision,(e-1023)::double precision);END IF;
 IF get_byte(b,0)>=128 THEN v:=-v;END IF;
 IF encode(float8send(v),'hex')<>p_hex THEN RAISE EXCEPTION 'public215 f64 decode identity';END IF;
 RETURN v;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_ratio(p_n numeric, p_d numeric)
 RETURNS double precision
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE e integer:=0;n numeric:=p_n;q numeric;r numeric;
BEGIN
 IF p_n<0 OR p_d<=0 OR p_n>p_d OR p_n<>trunc(p_n) OR p_d<>trunc(p_d) OR p_d>9223372036854775807::numeric*990 THEN RAISE EXCEPTION 'public215 ratio bounds';END IF;
 IF p_n=0 THEN RETURN 0::double precision;END IF;
 WHILE n<p_d LOOP n:=n*2;e:=e-1;END LOOP;
 n:=p_n*power(2::numeric,52-e);q:=div(n,p_d);r:=n-q*p_d;
 IF r*2>p_d OR (r*2=p_d AND mod(q,2)=1) THEN q:=q+1;END IF;
 RETURN q::double precision*power(2::double precision,(e-52)::double precision);
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_graph(p_own integer[], p_board integer[])
 RETURNS double precision[]
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE h integer[];f integer[];slots integer[];v integer[];best integer[];i integer;j integer;a integer;b integer;c integer;hi integer;
BEGIN
 IF cardinality(p_own)<>2 OR cardinality(p_board) NOT IN(3,4,5) OR EXISTS(SELECT 1 FROM unnest(p_own||p_board)x WHERE x IS NULL OR x NOT BETWEEN 0 AND 51) OR (SELECT count(DISTINCT x) FROM unnest(p_own||p_board)x)<>cardinality(p_board)+2 THEN RAISE EXCEPTION 'public215 graph shape';END IF;
 FOR hi IN 0..1 LOOP
  h:=CASE WHEN hi=0 THEN p_own ELSE ARRAY[p_own[2],p_own[1]] END;
  IF h[1]/4<h[2]/4 THEN CONTINUE;END IF;
  FOR a IN 1..3 LOOP FOR b IN 1..3 LOOP FOR c IN 1..3 LOOP
   IF a=b OR a=c OR b=c THEN CONTINUE;END IF;f:=ARRAY[p_board[a],p_board[b],p_board[c]];
   IF f[1]/4<f[2]/4 OR f[2]/4<f[3]/4 THEN CONTINUE;END IF;
   slots:=h||f||ARRAY[COALESCE(p_board[4],-1),COALESCE(p_board[5],-1)];v:=ARRAY[]::integer[];
   FOR i IN 1..7 LOOP v:=array_append(v,CASE WHEN slots[i]<0 THEN 0 ELSE slots[i]/4+2 END);END LOOP;
   FOR i IN 1..7 LOOP FOR j IN i+1..7 LOOP v:=array_append(v,CASE WHEN slots[i]>=0 AND slots[j]>=0 AND slots[i]%4=slots[j]%4 THEN 1 ELSE 0 END);END LOOP;END LOOP;
   IF best IS NULL OR v<best THEN best:=v;END IF;
  END LOOP;END LOOP;END LOOP;
 END LOOP;
 RETURN best::double precision[];
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_board_relative_key_v2(p_combo_index integer, p_board text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'public'
AS $function$
DECLARE
  holes text[]; combo_high integer; combo_low integer;
  cards text[]; ranks integer[]:=ARRAY[]::integer[]; suits text[]:=ARRAY[]::text[];
  board_ranks integer[]; all_ranks integer[]; groups integer[]; multiplicities integer[];
  best integer[]:=ARRAY[]::integer[]; score integer[]; unique_ranks integer[];
  chosen integer[]; rank_counts integer[]; rank_count integer; subset_index integer; board_counts integer[]; all_counts integer[]; greater_count integer; same_count integer; suit_sort_keys integer[]:=ARRAY[]::integer[]; sort_key integer; swap_key integer; swap_tuple jsonb;
  bmult jsonb; hole_tuples jsonb[]:=ARRAY[]::jsonb[]; hole_relations jsonb;
  suit_tuples jsonb[]:=ARRAY[]::jsonb[]; suit_relations jsonb;
  tiebreak jsonb:='[]'::jsonb; tuple jsonb;
  i integer; j integer; a integer; b integer; c integer; d integer; e integer;
  r integer; top integer; contribution integer; min_hole integer:=2; max_hole integer:=0;
  straight integer; complete_ranks integer:=0; complete_cards integer:=0;
  flush_cards integer:=0; board_suit_count integer; hole_suit_count integer;
  unseen integer; adjacent integer:=0; one_gap integer:=0; windows integer:=0;
  suit text; suited_hole integer[]; run integer[]; is_flush boolean; has_straight boolean:=false;
  wire jsonb;
BEGIN
  IF p_combo_index NOT BETWEEN 0 AND 1325 OR length(p_board) NOT IN (6,8,10)
     OR p_board !~ '^([2-9TJQKA][cdhs]){3,5}$' THEN RETURN NULL; END IF;
  combo_high:=floor((1+sqrt(1+8*p_combo_index))/2)::integer;
  WHILE combo_high*(combo_high-1)/2>p_combo_index LOOP combo_high:=combo_high-1; END LOOP;
  WHILE (combo_high+1)*combo_high/2<=p_combo_index LOOP combo_high:=combo_high+1; END LOOP;
  combo_low:=p_combo_index-combo_high*(combo_high-1)/2;
  holes:=ARRAY[
    substr('23456789TJQKA',combo_low/4+1,1)||substr('cdhs',mod(combo_low,4)+1,1),
    substr('23456789TJQKA',combo_high/4+1,1)||substr('cdhs',mod(combo_high,4)+1,1)
  ];
  cards:=holes;
  FOR i IN 0..length(p_board)/2-1 LOOP cards:=array_append(cards,substr(p_board,2*i+1,2)); END LOOP;
  FOR i IN 1..cardinality(cards) LOOP FOR j IN i+1..cardinality(cards) LOOP
    IF cards[i]=cards[j] THEN RETURN NULL; END IF;
  END LOOP; END LOOP;
  FOR i IN 1..cardinality(cards) LOOP
    ranks:=array_append(ranks,strpos('23456789TJQKA',substr(cards[i],1,1))+1);
    suits:=array_append(suits,substr(cards[i],2,1));
  END LOOP;
  board_counts:=array_fill(0,ARRAY[15]); all_counts:=array_fill(0,ARRAY[15]);
  FOR i IN 1..cardinality(ranks) LOOP
    all_counts[ranks[i]]:=all_counts[ranks[i]]+1;
    IF i>=3 THEN board_counts[ranks[i]]:=board_counts[ranks[i]]+1; END IF;
  END LOOP;
  board_ranks:=ARRAY[]::integer[]; all_ranks:=ARRAY[]::integer[];
  FOR r IN REVERSE 14..2 LOOP
    IF board_counts[r]>0 THEN board_ranks:=array_append(board_ranks,r); END IF;
    IF all_counts[r]>0 THEN all_ranks:=array_append(all_ranks,r); END IF;
  END LOOP;
  bmult:='[]'::jsonb;
  FOR rank_count IN REVERSE 4..1 LOOP
    FOREACH r IN ARRAY board_ranks LOOP
      IF board_counts[r]=rank_count THEN bmult:=bmult||jsonb_build_array(rank_count); END IF;
    END LOOP;
  END LOOP;
  FOR i IN 1..2 LOOP
    greater_count:=0;
    FOREACH r IN ARRAY board_ranks LOOP
      IF r>ranks[i] THEN greater_count:=greater_count+1; END IF;
    END LOOP;
    hole_tuples:=array_append(hole_tuples,jsonb_build_array(greater_count,
      board_counts[ranks[i]],CASE WHEN ranks[i]=14 THEN 1 ELSE 0 END));
  END LOOP;
  -- Equal-length numeric tuples use the same lexicographic order as the old columns.
  IF hole_tuples[1]>hole_tuples[2] THEN
    hole_relations:=jsonb_build_array(hole_tuples[2],hole_tuples[1]);
  ELSE hole_relations:=jsonb_build_array(hole_tuples[1],hole_tuples[2]); END IF;

  -- Independent best-five enumeration (not the TS full-hand category counter).
  FOR a IN 1..cardinality(cards)-4 LOOP
   FOR b IN a+1..cardinality(cards)-3 LOOP
    FOR c IN b+1..cardinality(cards)-2 LOOP
     FOR d IN c+1..cardinality(cards)-1 LOOP
      FOR e IN d+1..cardinality(cards) LOOP
       -- Enumerate the same five cards without planning SQL for every subset.
       chosen:=ARRAY[a,b,c,d,e];
       rank_counts:=array_fill(0,ARRAY[15]);
       contribution:=0;
       FOREACH subset_index IN ARRAY chosen LOOP
         rank_counts[ranks[subset_index]]:=rank_counts[ranks[subset_index]]+1;
         IF subset_index<=2 THEN contribution:=contribution+1; END IF;
       END LOOP;
       unique_ranks:=ARRAY[]::integer[];
       FOR r IN REVERSE 14..2 LOOP
         IF rank_counts[r]>0 THEN unique_ranks:=array_append(unique_ranks,r); END IF;
       END LOOP;
       groups:=ARRAY[]::integer[];
       multiplicities:=ARRAY[]::integer[];
       FOR rank_count IN REVERSE 4..1 LOOP
         FOREACH r IN ARRAY unique_ranks LOOP
           IF rank_counts[r]=rank_count THEN
             groups:=array_append(groups,r);
             multiplicities:=array_append(multiplicities,rank_count);
           END IF;
         END LOOP;
       END LOOP;
       is_flush:=suits[a]=suits[b] AND suits[a]=suits[c]
         AND suits[a]=suits[d] AND suits[a]=suits[e];
       straight:=0;
       IF cardinality(unique_ranks)=5 THEN
         IF unique_ranks[1]-unique_ranks[5]=4 THEN straight:=unique_ranks[1];
         ELSIF unique_ranks=ARRAY[14,5,4,3,2] THEN straight:=5; END IF;
       END IF;
       IF is_flush AND straight>0 THEN score:=ARRAY[8,straight];
       ELSIF multiplicities[1]=4 THEN score:=ARRAY[7,groups[1],groups[2]];
       ELSIF multiplicities[1]=3 AND multiplicities[2]=2 THEN score:=ARRAY[6,groups[1],groups[2]];
       ELSIF is_flush THEN score:=ARRAY[5]||unique_ranks;
       ELSIF straight>0 THEN score:=ARRAY[4,straight];
       ELSIF multiplicities[1]=3 THEN score:=ARRAY[3]||groups;
       ELSIF multiplicities[1]=2 AND multiplicities[2]=2 THEN score:=ARRAY[2]||groups;
       ELSIF multiplicities[1]=2 THEN score:=ARRAY[1]||groups;
       ELSE score:=ARRAY[0]||unique_ranks; END IF;
       IF score>best THEN best:=score;min_hole:=contribution;max_hole:=contribution;
       ELSIF score=best THEN min_hole:=least(min_hole,contribution);max_hole:=greatest(max_hole,contribution); END IF;
      END LOOP;
     END LOOP;
    END LOOP;
   END LOOP;
  END LOOP;
  FOR i IN 2..cardinality(best) LOOP
    r:=best[i];
    tiebreak:=tiebreak||jsonb_build_array(jsonb_build_array(
      (ranks[1]=r)::integer+(ranks[2]=r)::integer,
      COALESCE(array_position(board_ranks,r)-1,-1),
      CASE WHEN r=ANY(ranks[1:2]) THEN 14-r ELSE -1 END));
  END LOOP;
  FOREACH suit IN ARRAY ARRAY['c','d','h','s'] LOOP
    board_suit_count:=0; hole_suit_count:=0; suited_hole:=NULL;
    FOR i IN 1..cardinality(cards) LOOP
      IF suits[i]=suit THEN
        IF i>=3 THEN board_suit_count:=board_suit_count+1;
        ELSE hole_suit_count:=hole_suit_count+1; suited_hole:=array_append(suited_hole,ranks[i]); END IF;
      END IF;
    END LOOP;
    IF cardinality(suited_hole)=2 AND suited_hole[1]<suited_hole[2] THEN
      suited_hole:=ARRAY[suited_hole[2],suited_hole[1]];
    END IF;
    tuple:=jsonb_build_array(board_suit_count,hole_suit_count);
    IF suited_hole IS NOT NULL THEN
      FOREACH r IN ARRAY suited_hole LOOP
        unseen:=14-r;
        FOR i IN 1..cardinality(cards) LOOP
          IF ranks[i]>r AND suits[i]=suit THEN unseen:=unseen-1; END IF;
        END LOOP;
        tuple:=tuple||jsonb_build_array(unseen);
      END LOOP;
    END IF;
    suit_tuples:=array_append(suit_tuples,tuple);
    IF cardinality(cards)<7 AND board_suit_count+hole_suit_count=4 THEN flush_cards:=flush_cards+9; END IF;
  END LOOP;
  -- Encode exactly the old four ORDER BY numeric columns, padding absent ranks as -1.
  FOR i IN 1..4 LOOP
    tuple:=suit_tuples[i];
    sort_key:=(((tuple->>0)::integer*4+(tuple->>1)::integer)*16+
      COALESCE((tuple->>2)::integer,-1)+1)*16+COALESCE((tuple->>3)::integer,-1)+1;
    suit_sort_keys:=array_append(suit_sort_keys,sort_key);
  END LOOP;
  FOR i IN 2..4 LOOP
    j:=i;
    WHILE j>1 AND suit_sort_keys[j]<suit_sort_keys[j-1] LOOP
      swap_key:=suit_sort_keys[j-1]; suit_sort_keys[j-1]:=suit_sort_keys[j]; suit_sort_keys[j]:=swap_key;
      swap_tuple:=suit_tuples[j-1]; suit_tuples[j-1]:=suit_tuples[j]; suit_tuples[j]:=swap_tuple;
      j:=j-1;
    END LOOP;
  END LOOP;
  suit_relations:=to_jsonb(suit_tuples);
  FOR top IN 5..14 LOOP
    run:=CASE WHEN top=5 THEN ARRAY[14,2,3,4,5] ELSE ARRAY[top-4,top-3,top-2,top-1,top] END;
    IF all_ranks @> run THEN has_straight:=true; END IF;
    same_count:=0;
    FOREACH r IN ARRAY run LOOP IF board_counts[r]>0 THEN same_count:=same_count+1; END IF; END LOOP;
    IF same_count>=4 THEN windows:=windows+1; END IF;
  END LOOP;
  IF cardinality(cards)<7 AND NOT has_straight THEN
    FOR r IN 2..14 LOOP
      IF NOT r=ANY(all_ranks) THEN
        FOR top IN 5..14 LOOP
          run:=CASE WHEN top=5 THEN ARRAY[14,2,3,4,5] ELSE ARRAY[top-4,top-3,top-2,top-1,top] END;
          IF (all_ranks||r) @> run THEN complete_ranks:=complete_ranks+1;complete_cards:=complete_cards+4;EXIT; END IF;
        END LOOP;
      END IF;
    END LOOP;
  END IF;
  FOR i IN 1..cardinality(board_ranks) LOOP FOR j IN i+1..cardinality(board_ranks) LOOP
    IF board_ranks[i]-board_ranks[j]=1 OR (board_ranks[i]=14 AND board_ranks[j]=2) THEN adjacent:=adjacent+1; END IF;
    IF board_ranks[i]-board_ranks[j]=2 OR (board_ranks[i]=14 AND board_ranks[j]=3) THEN one_gap:=one_gap+1; END IF;
  END LOOP; END LOOP;
  wire:=jsonb_build_array('holdem-board-relative-v2',cardinality(cards)-2,best[1],bmult,hole_relations,
    ranks[1]=ranks[2],complete_ranks,complete_cards,suit_relations,flush_cards,tiebreak,
    jsonb_build_array(min_hole,max_hole),jsonb_build_array(adjacent,one_gap,windows));
  RETURN regexp_replace(wire::text,'\s','','g');
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_base181(p_combo integer, p_board text, p_template jsonb)
 RETURNS double precision[]
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE prior text[]:=ARRAY['allcount10','allcount11','allcount12','allcount13','allcount14','allcount2','allcount3','allcount4','allcount5','allcount6','allcount7','allcount8','allcount9','boardcount10','boardcount11','boardcount12','boardcount13','boardcount14','boardcount2','boardcount3','boardcount4','boardcount5','boardcount6','boardcount7','boardcount8','boardcount9','boardmaxsuit','boardrank0','boardrank1','boardrank2','boardrank3','boardrank4','depth','facing_kind=all_in','facing_kind=bet','facing_kind=none','facing_kind=raise','facing_size_bucket=all_in','facing_size_bucket=none','facing_size_bucket=small','flushrank','game_family=cash','game_family=spin','game_family=tourney_ev','game_family=tourney_icm','hero_position=BB','hero_position=BTN','hero_position=SB','hgap','hhigh','hlow','holesuitboard0','holesuitboard1','hpocket','hsuited','iprange=01b3d4e721b36cf6d8d89fd4941b5ece0e9fd2853f61d1e5f98fbebb3f8f5228','iprange=46a1052fd09045ea14940360740c08c8e45786680fb629b992bd6dd60dbb7448','iprange=4e711cfed033f777818cc507b6c54c1963959d325916fad5eeb2903076817dea','iprange=53b631c6ee33a42f19c276dceef8e49bff0f5d012f3332200301e8e02a6f2e7f','iprange=5cfa49e8e307dde353df59384f9af0078989b1f79b610cd6ffce687952817eeb','iprange=7297e35f5f97d678bf1c50f2c67f00b676d0da819459b34b566abeb553dfee21','matches','maxsuit','node_role=all_in','node_role=barrel','node_role=bet_raise','node_role=cbet','node_role=check_raise','node_role=delayed_cbet','node_role=facing_bet','node_role=facing_raise','node_role=open','node_role=probe','nover','npairs','nquads','ntrips','nunder','objective=cash_ev','objective=chip_ev','objective=icm','ooprange=3ac1e6fa6d92a000680addaf06eab130d2af9467d2e90aceae7cb542b8725c11','ooprange=4002e2111513d1de3ea6dec8a16bedb436fdd7f9a34ea6f08e2f5e95ee7bba1a','ooprange=505f32cd9ae2cef66951fcaecc0e8a8fc217ef1d4c0010bc0fe7b57ccf5a417a','ooprange=5cfa49e8e307dde353df59384f9af0078989b1f79b610cd6ffce687952817eeb','ooprange=6f7f9456008af722359ef4b8d53353c7e3fbdb94412a2d7cc206526cf2857a1b','ooprange=85a3cb6615c4547abb4e559d5858dfbdc40eb4938abbf14c1bbf564c027b6c7e','opponent_position=BB','opponent_position=BTN','opponent_position=SB','pot_type=3bet','pot_type=4bet_plus','pot_type=limped','pot_type=srp','potbb','rakecap','rakepct','span','stackbb','straighttop','straightwindow','street=flop','street=river','street=turn','tablesize','utility_context=bubble','utility_context=cash_ev','utility_context=chip_ev','utility_context=final_table','utility_context=in_money','utility_context=ladder','utility_context=satellite','utility_context=spin_ladder'];own integer[];cards integer[];board integer[]:=ARRAY[]::integer[];ranks integer[];br integer[];hr integer[];bc integer[]:=array_fill(0,ARRAY[15]);ac integer[]:=array_fill(0,ARRAY[15]);sc integer[]:=array_fill(0,ARRAY[4]);bs integer[]:=array_fill(0,ARRAY[4]);ctx jsonb:=p_template->'context';scenario jsonb:=p_template->'scenario';f jsonb:='{}';v jsonb;out double precision[]:=ARRAY[]::double precision[];i integer;j integer;r integer;n integer;high integer;low integer;card integer;tmp integer;k text;val jsonb;matches integer:=0;nover integer:=0;nunder integer:=0;np integer:=0;nt integer:=0;nq integer:=0;maxs integer:=0;maxbs integer:=0;flushrank integer:=0;sw integer:=0;st integer:=0;hits integer;top integer;wr integer;countv integer;
BEGIN
 IF p_combo NOT BETWEEN 0 AND 1325 OR p_board!~'^([2-9TJQKA][cdhs]){3,5}$' THEN RAISE EXCEPTION 'public215 cards';END IF;
 high:=floor((1+sqrt(1+8*p_combo))/2)::integer;WHILE high*(high-1)/2>p_combo LOOP high:=high-1;END LOOP;WHILE (high+1)*high/2<=p_combo LOOP high:=high+1;END LOOP;low:=p_combo-high*(high-1)/2;own:=ARRAY[low,high];
 n:=length(p_board)/2;FOR i IN 0..n-1 LOOP board:=array_append(board,(strpos('23456789TJQKA',substr(p_board,2*i+1,1))-1)*4+strpos('cdhs',substr(p_board,2*i+2,1))-1);END LOOP;
 cards:=own||board;IF (SELECT count(DISTINCT x) FROM unnest(cards)x)<>n+2 THEN RAISE EXCEPTION 'public215 impossible deck';END IF;
 FOREACH card IN ARRAY board LOOP bc[card/4+2]:=bc[card/4+2]+1;bs[card%4+1]:=bs[card%4+1]+1;END LOOP;
 -- Original f09 hole normalization: rank descending, then matching-board suitcount descending.
 IF own[1]/4<own[2]/4 OR (own[1]/4=own[2]/4 AND bs[own[1]%4+1]<bs[own[2]%4+1]) THEN tmp:=own[1];own[1]:=own[2];own[2]:=tmp;END IF;
 FOREACH card IN ARRAY cards LOOP ac[card/4+2]:=ac[card/4+2]+1;sc[card%4+1]:=sc[card%4+1]+1;END LOOP;
 hr:=ARRAY[own[1]/4+2,own[2]/4+2];SELECT array_agg(x.value/4+2 ORDER BY x.value/4 DESC) INTO br FROM unnest(board)x(value);
 FOR i IN 1..2 LOOP matches:=matches+bc[hr[i]];IF hr[i]>br[1] THEN nover:=nover+1;END IF;IF hr[i]<br[n] THEN nunder:=nunder+1;END IF;END LOOP;
 FOR r IN 2..14 LOOP IF ac[r]=2 THEN np:=np+1;ELSIF ac[r]=3 THEN nt:=nt+1;ELSIF ac[r]=4 THEN nq:=nq+1;END IF;END LOOP;
 FOR i IN 1..4 LOOP maxs:=greatest(maxs,sc[i]);maxbs:=greatest(maxbs,bs[i]);END LOOP;
 FOREACH card IN ARRAY cards LOOP IF sc[card%4+1]>=5 THEN flushrank:=greatest(flushrank,card/4+2);END IF;END LOOP;
 FOR top IN 5..14 LOOP hits:=0;FOR wr IN top-4..top LOOP r:=CASE WHEN wr=1 THEN 14 ELSE wr END;IF ac[r]>0 THEN hits:=hits+1;END IF;END LOOP;sw:=greatest(sw,hits);IF hits=5 THEN st:=greatest(st,top);END IF;END LOOP;
 f:=jsonb_build_object('hhigh',hr[1],'hlow',hr[2],'hgap',hr[1]-hr[2],'hpocket',(hr[1]=hr[2])::integer,'hsuited',(own[1]%4=own[2]%4)::integer,'nover',nover,'nunder',nunder,'matches',matches,'maxsuit',maxs,'boardmaxsuit',maxbs,'span',br[1]-br[n],'npairs',np,'ntrips',nt,'nquads',nq,'straightwindow',sw,'straighttop',st,'flushrank',flushrank,'holesuitboard0',bs[own[1]%4+1],'holesuitboard1',bs[own[2]%4+1],'depth',(ctx->>'depth_bucket')::integer,'tablesize',(ctx->>'table_size')::integer,'potbb',public.fn_gto_v31_public215_f64(scenario->>'pot_chips_f64')/public.fn_gto_v31_public215_f64(scenario->>'chips_per_bb_f64'),'stackbb',public.fn_gto_v31_public215_f64(scenario->>'effective_stack_chips_f64')/public.fn_gto_v31_public215_f64(scenario->>'chips_per_bb_f64'),'rakepct',public.fn_gto_v31_public215_f64(scenario#>>'{rake_f64,0}'),'rakecap',public.fn_gto_v31_public215_f64(scenario#>>'{rake_f64,1}'));
 FOR i IN 1..n LOOP f:=f||jsonb_build_object('boardrank'||(i-1),br[i]);END LOOP;
 FOR r IN 2..14 LOOP f:=f||jsonb_build_object('boardcount'||r,bc[r],'allcount'||r,ac[r]);END LOOP;
 FOR k,val IN SELECT key,value FROM jsonb_each(ctx) LOOP IF k NOT IN('texture_class','depth_bucket','table_size') THEN f:=f||jsonb_build_object(k||'='||(val#>>'{}'),1);END IF;END LOOP;
 f:=f||jsonb_build_object('iprange='||(scenario->>'ip_range_checksum'),1,'ooprange='||(scenario->>'oop_range_checksum'),1);
 FOREACH k IN ARRAY prior LOOP out:=array_append(out,COALESCE((f->>k)::double precision,0));END LOOP;
 v:=public.fn_gto_v31_board_relative_key_v2(p_combo,p_board)::jsonb;IF v IS NULL THEN RAISE EXCEPTION 'public215 V2 geometry missing';END IF;
 out:=out||ARRAY[(v->>1)::double precision,(v->>2)::double precision];FOR i IN 0..8 LOOP out:=array_append(out,((v->>2)::integer=i)::integer::double precision);END LOOP;
 FOR i IN 0..4 LOOP out:=array_append(out,COALESCE((v#>>ARRAY['3',i::text])::double precision,-1));END LOOP;out:=array_append(out,jsonb_array_length(v->3)::double precision);
 FOR i IN 0..1 LOOP FOR j IN 0..2 LOOP out:=array_append(out,COALESCE((v#>>ARRAY['4',i::text,j::text])::double precision,-1));END LOOP;END LOOP;
 out:=out||ARRAY[(v->>5)::boolean::integer::double precision,(v->>6)::double precision,(v->>7)::double precision];
 FOR i IN 0..3 LOOP FOR j IN 0..3 LOOP out:=array_append(out,COALESCE((v#>>ARRAY['8',i::text,j::text])::double precision,-1));END LOOP;END LOOP;
 FOR i IN 0..3 LOOP out:=array_append(out,jsonb_array_length(v#>ARRAY['8',i::text])::double precision);END LOOP;out:=array_append(out,(v->>9)::double precision);
 FOR i IN 0..4 LOOP FOR j IN 0..2 LOOP out:=array_append(out,COALESCE((v#>>ARRAY['10',i::text,j::text])::double precision,-1));END LOOP;END LOOP;out:=array_append(out,jsonb_array_length(v->10)::double precision);
 FOR i IN 0..1 LOOP out:=array_append(out,(v#>>ARRAY['11',i::text])::double precision);END LOOP;FOR i IN 0..2 LOOP out:=array_append(out,(v#>>ARRAY['12',i::text])::double precision);END LOOP;
 IF cardinality(out)<>181 THEN RAISE EXCEPTION 'public215 base181 shape %',cardinality(out);END IF;RETURN out;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_features(p_combo integer, p_board text, p_template jsonb, p_mass numeric[])
 RETURNS double precision[]
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE out double precision[];board integer[]:=ARRAY[]::integer[];own integer[];hi integer;lo integer;i integer;
BEGIN
 IF cardinality(p_mass)<>8 OR p_mass[4]<=0 OR p_mass[8]<=0 OR p_mass[1]+p_mass[2]+p_mass[3]<>p_mass[4] OR p_mass[5]+p_mass[6]+p_mass[7]<>p_mass[8] THEN RAISE EXCEPTION 'independent exact WTL masses required';END IF;
 out:=public.fn_gto_v31_public215_base181(p_combo,p_board,p_template);
 FOR i IN 1..3 LOOP out:=array_append(out,public.fn_gto_v31_public215_ratio(p_mass[i],p_mass[4]));END LOOP;FOR i IN 5..7 LOOP out:=array_append(out,public.fn_gto_v31_public215_ratio(p_mass[i],p_mass[8]));END LOOP;
 hi:=floor((1+sqrt(1+8*p_combo))/2)::integer;WHILE hi*(hi-1)/2>p_combo LOOP hi:=hi-1;END LOOP;WHILE (hi+1)*hi/2<=p_combo LOOP hi:=hi+1;END LOOP;lo:=p_combo-hi*(hi-1)/2;own:=ARRAY[lo,hi];
 FOR i IN 0..length(p_board)/2-1 LOOP board:=array_append(board,(strpos('23456789TJQKA',substr(p_board,2*i+1,1))-1)*4+strpos('cdhs',substr(p_board,2*i+2,1))-1);END LOOP;
 out:=out||public.fn_gto_v31_public215_graph(own,board);IF cardinality(out)<>215 THEN RAISE EXCEPTION 'public215 full feature shape';END IF;RETURN out;
END $function$
;

CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_compiled_raw(p_heads gto_v31_public215_head[], p_x double precision[])
 RETURNS double precision[]
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE h public.gto_v31_public215_head;t public.gto_v31_public215_tree;i integer;v double precision;out double precision[]:=ARRAY[]::double precision[];
BEGIN
 IF cardinality(p_x)<>215 OR array_ndims(p_x)<>1 OR array_lower(p_x,1)<>1 OR EXISTS(SELECT 1 FROM unnest(p_x)x WHERE x IS NULL OR x::text IN('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'public215 finite215 vector';END IF;
 FOREACH h IN ARRAY p_heads LOOP
  v:=0::double precision;v:=v+h.baseline;
  FOREACH t IN ARRAY h.trees LOOP
   i:=1;WHILE t.feature[i]<>-1 LOOP IF p_x[t.feature[i]+1]<=t.threshold[i] THEN i:=t.left_child[i]+1;ELSE i:=t.right_child[i]+1;END IF;END LOOP;v:=v+t.leaf_value[i];
  END LOOP;
  IF v::text IN('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'public215 raw prediction overflow';END IF;out:=array_append(out,v);
 END LOOP;RETURN out;
END $function$
;

