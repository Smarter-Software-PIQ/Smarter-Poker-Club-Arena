DO $proof$ BEGIN
 IF (SELECT guaranteed_prize FROM tournaments WHERE id='94ef58cf-5f0b-47dd-bbe1-d490e036b083') IS DISTINCT FROM 1250.0 THEN RAISE EXCEPTION 'transition guarantee amount 94ef58cf-5f0b-47dd-bbe1-d490e036b083'; END IF;
 IF (SELECT name FROM tournaments WHERE id='94ef58cf-5f0b-47dd-bbe1-d490e036b083') IS DISTINCT FROM '1250 GTD' THEN RAISE EXCEPTION 'transition guarantee label 94ef58cf-5f0b-47dd-bbe1-d490e036b083'; END IF;
 IF (SELECT guaranteed_prize FROM tournaments WHERE id='92b73021-1e8e-410f-9ad0-72ae70e185ba') IS DISTINCT FROM 750.0 THEN RAISE EXCEPTION 'transition guarantee amount 92b73021-1e8e-410f-9ad0-72ae70e185ba'; END IF;
 IF (SELECT name FROM tournaments WHERE id='92b73021-1e8e-410f-9ad0-72ae70e185ba') IS DISTINCT FROM '750 GTD' THEN RAISE EXCEPTION 'transition guarantee label 92b73021-1e8e-410f-9ad0-72ae70e185ba'; END IF;
 IF (SELECT guaranteed_prize FROM tournaments WHERE id='678f4121-944d-4120-b8b9-ec6b4fa49405') IS DISTINCT FROM 1000.0 THEN RAISE EXCEPTION 'transition guarantee amount 678f4121-944d-4120-b8b9-ec6b4fa49405'; END IF;
 IF (SELECT name FROM tournaments WHERE id='678f4121-944d-4120-b8b9-ec6b4fa49405') IS DISTINCT FROM '1000 GTD' THEN RAISE EXCEPTION 'transition guarantee label 678f4121-944d-4120-b8b9-ec6b4fa49405'; END IF;
END $proof$;
