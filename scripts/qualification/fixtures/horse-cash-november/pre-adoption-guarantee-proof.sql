DO $proof$ BEGIN
 IF (SELECT count(*) FROM tournaments t JOIN pre_adoption_expected b USING(id)) <> (SELECT count(*) FROM pre_adoption_expected) THEN RAISE EXCEPTION 'pre_adoption fixture missing'; END IF;
 IF EXISTS(SELECT 1 FROM tournaments t JOIN pre_adoption_expected b USING(id) WHERE t.guaranteed_prize IS DISTINCT FROM b.after OR t.name IS DISTINCT FROM b.after::text||' GTD' OR t.description IS DISTINCT FROM b.after::text||' Guarantee' OR t.short_description IS DISTINCT FROM b.after::text||' Chip Guarantee') THEN RAISE EXCEPTION 'pre_adoption guarantee or label incorrect'; END IF;
 IF EXISTS(SELECT 1 FROM pre_adoption_existing_before b LEFT JOIN tournaments t USING(id) WHERE to_jsonb(t) IS DISTINCT FROM to_jsonb(b)) THEN RAISE EXCEPTION 'pre_adoption closure changed existing board'; END IF;
END $proof$;
