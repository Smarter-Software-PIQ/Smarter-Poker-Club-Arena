CREATE OR REPLACE FUNCTION public.fn_gto_v31_release_evaluation_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'a release evaluation receipt is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.gto_v31_datasets d WHERE d.dataset_id = OLD.dataset_id) THEN
      RAISE EXCEPTION 'a release evaluation receipt is immutable';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.evaluation_kind IN ('paired_replay','league') THEN
    PERFORM 1 FROM public.gto_v31_evaluation_epochs p
      WHERE p.epoch_id = NEW.evaluation_epoch_id AND p.dataset_id = NEW.dataset_id
        AND p.engine_commit = NEW.evaluation_engine_commit
        AND p.superseded_at IS NULL AND p.promoted_at IS NULL
      FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'replay/league receipts are written only into the open evaluation epoch of their engine commit';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;
