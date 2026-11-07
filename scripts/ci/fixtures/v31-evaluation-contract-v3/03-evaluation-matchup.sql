CREATE OR REPLACE FUNCTION public.fn_gto_v31_evaluation_matchup(p_kind text, p_family text, p_dataset_checksum text, p_epoch_no integer)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT 'gto_v31_'||p_kind||'_'||p_family||'_'||p_dataset_checksum
         ||CASE WHEN p_epoch_no > 1 THEN '_epoch'||p_epoch_no ELSE '' END
$function$
;
