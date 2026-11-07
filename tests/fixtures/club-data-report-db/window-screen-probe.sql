SET ROLE authenticated;
SELECT set_config('test.role','authenticated',false);
SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000a1',false);
SELECT ca_club_data_screen(c,CURRENT_DATE-a,CURRENT_DATE-b,g,st,q,l)
FROM unnest(ARRAY['a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid,'a4143400-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','fade0000-0000-0000-0000-000000000001',NULL::uuid])c,
(VALUES(13,0),(27,14),(90,89))w(a,b),
(VALUES('ALL','ALL',NULL::text),('MTT','ALL',NULL),('HOLDEM','SMALL',NULL),('ALL','ALL','Mixed'))f(g,st,q),unnest(ARRAY[1,100])l
ORDER BY c,a,b,g,st,q,l;
SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000a2',false);
SELECT ca_club_data_screen('a0000000-0000-0000-0000-000000000001',CURRENT_DATE-27,CURRENT_DATE,'ALL','ALL',NULL,100);
