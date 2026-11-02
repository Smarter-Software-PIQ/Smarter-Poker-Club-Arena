DO $proof$ BEGIN
 IF (SELECT count(*) FROM tournaments t JOIN delayed_expected b USING(id)) <> (SELECT count(*) FROM delayed_expected) THEN RAISE EXCEPTION 'delayed fixture missing'; END IF;
 IF EXISTS(SELECT 1 FROM tournaments t JOIN delayed_expected b USING(id) WHERE t.guaranteed_prize IS DISTINCT FROM b.after OR t.name IS DISTINCT FROM b.after::text||' GTD' OR t.description IS DISTINCT FROM b.after::text||' Guarantee' OR t.short_description IS DISTINCT FROM b.after::text||' Chip Guarantee') THEN RAISE EXCEPTION 'delayed guarantee or label incorrect'; END IF;
 IF EXISTS(SELECT 1 FROM delayed_existing_before b LEFT JOIN tournaments t USING(id) WHERE to_jsonb(t) IS DISTINCT FROM to_jsonb(b)) THEN RAISE EXCEPTION 'delayed closure changed existing board'; END IF;
END $proof$;
