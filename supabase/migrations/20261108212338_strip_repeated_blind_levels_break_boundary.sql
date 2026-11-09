-- A break ends the comparison window. Only levels that sit directly next to
-- each other with no break between them can be a repeat; a level played after
-- a break is real play time and is never swallowed, whatever its blinds are.
create or replace function public.fn_ca_strip_repeated_levels(p_structure text)
returns text language plpgsql immutable set search_path to 'public','pg_temp' as $fn$
declare
  v jsonb; r jsonb; out_arr jsonb := '[]'::jsonb;
  prev_sb numeric := null; prev_bb numeric := null; prev_ante numeric := null;
  sb numeric; bb numeric; ante numeric;
  changed boolean := false; n integer := 0;
begin
  if p_structure is null or btrim(p_structure) = '' then return p_structure; end if;
  begin v := p_structure::jsonb; exception when others then return p_structure; end;
  if v is null or jsonb_typeof(v) <> 'array' then return p_structure; end if;
  for r in select value from jsonb_array_elements(v) loop
    if jsonb_typeof(r) <> 'object' then return p_structure; end if;
    if coalesce((r->>'isBreak')::boolean,false) then
      prev_sb := null; prev_bb := null; prev_ante := null;
      n := n + 1;
      if r ? 'level' then r := jsonb_set(r,'{level}',to_jsonb(n)); end if;
      out_arr := out_arr || jsonb_build_array(r);
      continue;
    end if;
    sb := public.fn_ca_blind_contract_number(r->'smallBlind');
    bb := public.fn_ca_blind_contract_number(r->'bigBlind');
    ante := case when r ? 'ante' then public.fn_ca_blind_contract_number(r->'ante') else 0 end;
    if sb is null or bb is null or ante is null then return p_structure; end if;
    if prev_bb is not null and sb = prev_sb and bb = prev_bb and ante = prev_ante then
      changed := true;
      continue;
    end if;
    prev_sb := sb; prev_bb := bb; prev_ante := ante;
    n := n + 1;
    if r ? 'level' then r := jsonb_set(r,'{level}',to_jsonb(n)); end if;
    out_arr := out_arr || jsonb_build_array(r);
  end loop;
  if not changed then return p_structure; end if;
  return out_arr::text;
end $fn$;

create or replace function public.fn_ca_repeated_levels_late_reg(p_structure text, p_late integer)
returns integer language plpgsql immutable set search_path to 'public','pg_temp' as $fn$
declare
  v jsonb; r jsonb;
  prev_sb numeric := null; prev_bb numeric := null; prev_ante numeric := null;
  sb numeric; bb numeric; ante numeric; i integer := 0; kept integer := 0;
begin
  if p_late is null or p_late <= 0 then return p_late; end if;
  if p_structure is null or btrim(p_structure) = '' then return p_late; end if;
  begin v := p_structure::jsonb; exception when others then return p_late; end;
  if v is null or jsonb_typeof(v) <> 'array' then return p_late; end if;
  for r in select value from jsonb_array_elements(v) loop
    i := i + 1;
    if i > p_late then exit; end if;
    if jsonb_typeof(r) <> 'object' then return p_late; end if;
    if coalesce((r->>'isBreak')::boolean,false) then
      prev_sb := null; prev_bb := null; prev_ante := null;
      kept := kept + 1; continue;
    end if;
    sb := public.fn_ca_blind_contract_number(r->'smallBlind');
    bb := public.fn_ca_blind_contract_number(r->'bigBlind');
    ante := case when r ? 'ante' then public.fn_ca_blind_contract_number(r->'ante') else 0 end;
    if sb is null or bb is null or ante is null then return p_late; end if;
    if prev_bb is not null and sb = prev_sb and bb = prev_bb and ante = prev_ante then
      continue;
    end if;
    prev_sb := sb; prev_bb := bb; prev_ante := ante; kept := kept + 1;
  end loop;
  return greatest(kept,1);
end $fn$;