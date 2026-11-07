CREATE OR REPLACE FUNCTION public.fn_gto_v31_evaluation_epoch_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.gto_v31_datasets d WHERE d.dataset_id = OLD.dataset_id) THEN
      RAISE EXCEPTION 'an evaluation epoch is permanent provenance';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.epoch_id IS DISTINCT FROM OLD.epoch_id OR NEW.dataset_id IS DISTINCT FROM OLD.dataset_id
     OR NEW.epoch_no IS DISTINCT FROM OLD.epoch_no OR NEW.engine_commit IS DISTINCT FROM OLD.engine_commit
     OR NEW.opened_at IS DISTINCT FROM OLD.opened_at OR NEW.opened_by IS DISTINCT FROM OLD.opened_by
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR (OLD.superseded_at IS NOT NULL AND
         (NEW.superseded_at, NEW.superseded_by_epoch_no, NEW.superseded_candidate)
           IS DISTINCT FROM (OLD.superseded_at, OLD.superseded_by_epoch_no, OLD.superseded_candidate))
     OR (OLD.promoted_at IS NOT NULL AND
         (NEW.promoted_at, NEW.promoted_serving_commit)
           IS DISTINCT FROM (OLD.promoted_at, OLD.promoted_serving_commit)) THEN
    RAISE EXCEPTION 'an evaluation epoch is permanent provenance; only its one supersession or promotion is recorded';
  END IF;
  RETURN NEW;
END;
$function$
;
