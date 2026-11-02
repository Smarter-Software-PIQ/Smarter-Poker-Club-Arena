DO $proof$ BEGIN
 IF (SELECT guaranteed_prize FROM tournaments WHERE id='0251fba4-dcc2-41f0-aec2-9cd567785c3d') <> 250.0 THEN RAISE EXCEPTION 'guarantee preservation case 0 failed'; END IF;
 IF (SELECT guaranteed_prize FROM tournaments WHERE id='0418daad-05a5-4aa7-9728-5bf1a3ac12cc') <> 500.0 THEN RAISE EXCEPTION 'guarantee preservation case 1 failed'; END IF;
 IF (SELECT guaranteed_prize FROM tournaments WHERE id='04746fce-4bad-4547-96ac-7e87b398648c') <> 5000.0 THEN RAISE EXCEPTION 'guarantee preservation case 2 failed'; END IF;
 IF (SELECT guaranteed_prize FROM tournaments WHERE id='047da62c-3337-48f7-a3d2-22f0a802f14e') <> 2000.0 THEN RAISE EXCEPTION 'guarantee preservation case 3 failed'; END IF;
 IF (SELECT guaranteed_prize FROM tournaments WHERE id='04ba4cca-c6a1-45a3-bd3c-5150b43e963b') <> 500.0 THEN RAISE EXCEPTION 'guarantee preservation case 4 failed'; END IF;
 IF (SELECT guaranteed_prize FROM tournaments WHERE id='069ccf16-2b6f-4eb1-b980-a875860c4b44') <> 5000.0 THEN RAISE EXCEPTION 'guarantee preservation case 5 failed'; END IF;
 IF (SELECT guaranteed_prize FROM tournaments WHERE id='0778af66-7924-44dd-b537-56af19adf1ad') <> 1999 THEN RAISE EXCEPTION 'guarantee preservation case 6 failed'; END IF;
 IF (SELECT guaranteed_prize FROM tournaments WHERE id='077ae84a-0f9f-4bde-b02d-a071a2651176') <> 25000 THEN RAISE EXCEPTION 'guarantee preservation case 7 failed'; END IF;
 IF (SELECT guaranteed_prize FROM tournaments WHERE id='0ae8dd91-4ed7-407d-a4ce-7a5f81116435') <> 1000.0 THEN RAISE EXCEPTION 'guarantee preservation case 8 failed'; END IF;
 IF (SELECT name FROM tournaments WHERE id='0251fba4-dcc2-41f0-aec2-9cd567785c3d') <> '250 GTD' THEN RAISE EXCEPTION 'advertised guarantee stale'; END IF;
 IF pg_temp.reduced_guarantee_copy('40 Chip Freezeout - 5K GTD (NLH) | 20K Stack',5000,2500) <> '40 Chip Freezeout - 2.5K GTD (NLH) | 20K Stack' THEN RAISE EXCEPTION 'name conversion changes unrelated terms'; END IF;
END $proof$;
