-- Events whose entries registered BEFORE the change (old promo head, old doors).
CREATE TABLE public.t_ids(label text PRIMARY KEY, id uuid);
-- L1: aiof G500, 124 legacy entries (like tonight's Afternoon Free Buy), more join after.
INSERT INTO public.t_ids SELECT 'L1', public.t_new('aiof', 500);
SELECT public.t_register((SELECT id FROM t_ids WHERE label='L1'), 124);
-- L2: regular G250, 189 legacy entries, players pay 351 (this morning's f4793b0d).
INSERT INTO public.t_ids SELECT 'L2', public.t_new('regular', 250);
SELECT public.t_register((SELECT id FROM t_ids WHERE label='L2'), 189);
-- L3: mystery, 143 legacy entries (tonight's Prime Time), more join after.
INSERT INTO public.t_ids SELECT 'L3', public.t_new('mystery', 0);
SELECT public.t_register((SELECT id FROM t_ids WHERE label='L3'), 143);
-- L4: legacy mystery entry that unregisters after the change.
INSERT INTO public.t_ids SELECT 'L4', public.t_new('mystery', 0);
SELECT public.t_register((SELECT id FROM t_ids WHERE label='L4'), 3);
