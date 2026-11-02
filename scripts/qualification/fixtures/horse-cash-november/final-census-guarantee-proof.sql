DO $proof$ BEGIN
 IF (SELECT count(*) FROM tournaments t JOIN final_census_expected b USING(id)) <> (SELECT count(*) FROM final_census_expected) THEN RAISE EXCEPTION 'final_census fixture missing'; END IF;
 IF EXISTS(SELECT 1 FROM tournaments t JOIN final_census_expected b USING(id) WHERE t.guaranteed_prize IS DISTINCT FROM b.after OR t.name IS DISTINCT FROM b.after::text||' GTD' OR t.description IS DISTINCT FROM b.after::text||' Guarantee' OR t.short_description IS DISTINCT FROM b.after::text||' Chip Guarantee') THEN RAISE EXCEPTION 'final_census guarantee or label incorrect'; END IF;
 IF EXISTS(SELECT 1 FROM final_census_existing_before b LEFT JOIN tournaments t USING(id) WHERE to_jsonb(t) IS DISTINCT FROM to_jsonb(b)) THEN RAISE EXCEPTION 'final_census closure changed existing board'; END IF;
END $proof$;
