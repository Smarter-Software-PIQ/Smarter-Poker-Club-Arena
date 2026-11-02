DO $proof$ BEGIN
 IF (SELECT guaranteed_prize FROM tournaments WHERE id='94ef58cf-5f0b-47dd-bbe1-d490e036b083') IS DISTINCT FROM 2500::numeric THEN RAISE EXCEPTION 'transition changed entered contract'; END IF;
 IF (SELECT guaranteed_prize FROM tournaments WHERE id='92b73021-1e8e-410f-9ad0-72ae70e185ba') IS DISTINCT FROM 1500::numeric THEN RAISE EXCEPTION 'transition changed locked contract'; END IF;
 IF (SELECT guaranteed_prize FROM tournaments WHERE id='678f4121-944d-4120-b8b9-ec6b4fa49405') IS DISTINCT FROM 2000::numeric THEN RAISE EXCEPTION 'transition changed running contract'; END IF;
 IF (SELECT guaranteed_prize FROM tournaments WHERE id='4e9ab7ad-50b0-4640-8859-f05777f62782') IS DISTINCT FROM 1500::numeric THEN RAISE EXCEPTION 'transition changed finalized contract'; END IF;
END $proof$;
