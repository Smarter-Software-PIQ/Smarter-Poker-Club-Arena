# The release checks every live Horse switch row against the candidate

A worker that is handed one switch row its build does not register, or in a state its build does not allow, treats the
whole option-switch configuration as invalid and runs every Horse option at its release default. Until now the only
guard was a lane running `switch.sh --audit-rows` by hand before each booking and after each seal; with a cutover every
couple of hours (owner, 2026-11-20 2:38 PM Chicago) the check belongs to the release.

- `server/scripts/engine-release-switch-rows.py candidate --repo . --sha TARGET` reads every row of
  `public.ca_horse_style_switch` through the read-only `DATABASE_URL` and checks it against TARGET's whitelist: the
  newest `*_horse_option_switch_*` full list plus every later `fn_ca_horse_option_register` /
  `fn_ca_horse_option_allow_shadow` call (list-once ready: lower level wins, locks stick, widening only by name).
- `post-seal --serving SHA --since T`: the registry the serving build publishes accepts every row and no
  `option_switch_config_{invalid,unreadable,stale}_seen` fired after T.
- Exit 0 pass, 1 refused (offenders listed), 3 unknown (never a pass). Read-only.
- Playbook step 7 item 8 runs it before dispatch; CI proves it on fixtures
  (`scripts/ci/test-engine-release-switch-rows.py`, workflow `a-switch-row-the-candidate-rejects-is-refused.yml`).

Checked on production rows (64) at 6:15 PM Chicago: main, CUTOVER-7 `95dae3848e51` and CUTOVER-8 `e2140d2d1581`
all accept every row; post-seal on `95dae3848e51` clean, no configuration alarm since the 4:11 PM seal.
