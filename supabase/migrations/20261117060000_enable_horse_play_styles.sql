-- 20261117060000_enable_horse_play_styles.sql
--
-- Version reserved for enabling horsePlayStyles
--
-- authority: horsePlayStyles docs/horse-option-authority.d/horsePlayStyles.md sha256 6d1c4230b6146134b15d0a6336c1241dbccfdf0dc2d6bdc0a43bef45f8dc373b

BEGIN;

INSERT INTO public.ca_horse_style_switch (option, state, note)
VALUES ('horsePlayStyles', 'on', 'authority: horsePlayStyles docs/horse-option-authority.d/horsePlayStyles.md sha256 6d1c4230b6146134b15d0a6336c1241dbccfdf0dc2d6bdc0a43bef45f8dc373b')
ON CONFLICT (option) DO UPDATE SET state = 'on', note = EXCLUDED.note;

COMMIT;
