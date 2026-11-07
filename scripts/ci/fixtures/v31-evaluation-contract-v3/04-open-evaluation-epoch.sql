CREATE OR REPLACE FUNCTION public.fn_gto_v31_open_evaluation_epoch(p_dataset_id uuid, p_engine_commit text, p_opened_by text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dataset public.gto_v31_datasets%ROWTYPE;
  v_current public.gto_v31_evaluation_epochs%ROWTYPE;
  v_epoch public.gto_v31_evaluation_epochs%ROWTYPE;
  v_has_current boolean;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' AND current_user NOT IN ('postgres','supabase_admin') THEN
    RAISE EXCEPTION 'service_role required';
  END IF;
  IF COALESCE(p_engine_commit,'')!~'^[0-9a-f]{40}$' OR p_engine_commit=repeat('0',40) THEN
    RAISE EXCEPTION 'an evaluation epoch binds one full engine commit';
  END IF;
  IF COALESCE(length(btrim(p_opened_by)),0) NOT BETWEEN 1 AND 200 OR p_opened_by ~ '[[:cntrl:]]'
     OR COALESCE(length(btrim(p_reason)),0) NOT BETWEEN 20 AND 2000 OR p_reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'an evaluation epoch needs an accountable opener and an audited reason of 20 to 2000 characters';
  END IF;
  -- Lock only a dataset that is awaiting evaluation. An active row is never
  -- locked here, so this can never wait on (or block) a promotion that holds
  -- the release gate while it retires the active dataset. Lock order is the
  -- same as mark-candidate and promotion: the awaiting dataset row, then gate.
  SELECT * INTO v_dataset FROM public.gto_v31_datasets
   WHERE dataset_id=p_dataset_id AND state IN ('evaluating','candidate') FOR UPDATE;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.gto_v31_datasets WHERE dataset_id=p_dataset_id) THEN
      RAISE EXCEPTION 'dataset is not awaiting evaluation; a promoted, retired or rejected dataset never reopens evaluation';
    END IF;
    RAISE EXCEPTION 'dataset does not exist';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('smarter-poker:gto-v31-release-gate', 0));
  IF v_dataset.state NOT IN ('evaluating','candidate')
     OR EXISTS (SELECT 1 FROM public.gto_v31_evaluation_epochs p
                 WHERE p.dataset_id=p_dataset_id AND p.promoted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'dataset is not awaiting evaluation; a promoted, retired or rejected dataset never reopens evaluation';
  END IF;
  IF v_dataset.quality_status<>'validated'
     OR COALESCE(v_dataset.dataset_checksum,'')!~'^[0-9a-f]{64}$'
     OR NOT EXISTS (SELECT 1 FROM public.gto_v31_release_evaluations e
                     WHERE e.dataset_id=p_dataset_id AND e.dataset_checksum=v_dataset.dataset_checksum
                       AND e.evaluation_kind='heldout' AND e.game_family='all' AND e.verdict='pass') THEN
    RAISE EXCEPTION 'only a sealed, validated dataset with a held-out pass is evaluated';
  END IF;
  IF EXISTS (SELECT 1 FROM public.gto_v31_release_evaluations e
              WHERE e.dataset_id=p_dataset_id AND e.evaluation_kind IN ('paired_replay','league')
                AND e.verdict='loss') THEN
    RAISE EXCEPTION 'a dataset that lost a release evaluation is never re-evaluated on another engine';
  END IF;
  SELECT * INTO v_current FROM public.gto_v31_evaluation_epochs
   WHERE dataset_id=p_dataset_id AND superseded_at IS NULL FOR UPDATE;
  v_has_current:=FOUND;
  IF v_has_current AND v_current.engine_commit=p_engine_commit THEN
    RETURN jsonb_build_object('epoch_id',v_current.epoch_id,'epoch_no',v_current.epoch_no,
      'engine_commit',v_current.engine_commit,'opened',false,'superseded_epoch_no',NULL);
  END IF;
  IF EXISTS (SELECT 1 FROM public.gto_v31_evaluation_epochs p
              WHERE p.dataset_id=p_dataset_id AND p.engine_commit=p_engine_commit) THEN
    RAISE EXCEPTION 'an engine commit is evaluated at most once per dataset';
  END IF;
  IF v_has_current THEN
    UPDATE public.gto_v31_evaluation_epochs
       SET superseded_at=now(), superseded_by_epoch_no=v_current.epoch_no+1,
           superseded_candidate=jsonb_build_object('state',v_dataset.state,
             'candidate_at',v_dataset.candidate_at,'audited_at',v_dataset.audited_at,
             'paired_replay',v_dataset.paired_replay,'league_gate',v_dataset.league_gate)
     WHERE epoch_id=v_current.epoch_id;
    IF v_dataset.state='candidate' THEN
      UPDATE public.gto_v31_datasets
         SET state='evaluating', paired_replay='{}'::jsonb, league_gate='{}'::jsonb, candidate_at=NULL
       WHERE dataset_id=p_dataset_id;
    END IF;
  ELSIF v_dataset.state<>'evaluating' THEN
    RAISE EXCEPTION 'a candidate without an evaluation epoch cannot be re-evaluated';
  END IF;
  INSERT INTO public.gto_v31_evaluation_epochs (dataset_id, epoch_no, engine_commit, opened_by, reason)
  VALUES (p_dataset_id, COALESCE(v_current.epoch_no,0)+1, p_engine_commit, btrim(p_opened_by), btrim(p_reason))
  RETURNING * INTO v_epoch;
  RETURN jsonb_build_object('epoch_id',v_epoch.epoch_id,'epoch_no',v_epoch.epoch_no,
    'engine_commit',v_epoch.engine_commit,'opened',true,
    'superseded_epoch_no',CASE WHEN v_has_current THEN v_current.epoch_no END);
END;
$function$
;
