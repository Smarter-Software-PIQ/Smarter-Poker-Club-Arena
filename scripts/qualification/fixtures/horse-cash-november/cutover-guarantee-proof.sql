DO $proof$ BEGIN
 IF (SELECT count(*) FROM cutover_expected) <> 93 THEN RAISE EXCEPTION 'cutover fixture coverage'; END IF;
 IF EXISTS (SELECT 1 FROM cutover_expected e LEFT JOIN tournaments t USING(id) WHERE t.id IS NULL OR t.guaranteed_prize IS DISTINCT FROM e.amount OR t.name IS DISTINCT FROM e.label) THEN RAISE EXCEPTION 'cutover amount, label, or preservation mismatch'; END IF;
END $proof$;
