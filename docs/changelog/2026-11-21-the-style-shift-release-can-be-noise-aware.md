# The Style-Shift Release Can Be Noise-Aware (option styleShiftReleaseIsNoiseAware, default OFF)

The 2026-11-06 style-shift release (`HorseOpponentExploit.styleShiftReleased`, Dan's ruling in
`2026-11-06-opportunity-scoped-decay-with-style-shift-release.md`) compares a fast-window rate with a long-window
rate with no allowance for sampling noise and, when any of six rates is 0.2 apart, ages every long-window gated
statistic. A stable player with mixed frequencies trips it on 2-4% of hands and loses most of his rare samples: a
stable 26% first-in raiser keeps 13.5 decayed fold-to-bet opportunities against 34.2 with no release (stationary
simulation, six seeds; `docs/horse-league-fixed-limit.md`, "The over-folder read and mixed frequencies", PR #11637).

## The root fix, behind a registered option (default OFF, live play unchanged)

- `styleShiftReleaseIsNoiseAware` (process switch, read `=== true`): a statistic moved only when the gap is at least
  `max(0.2, 1.5 * sqrt(q (1 - q) / nFast))`; a moved gated statistic ages only itself; a moved pfr still ages every
  gated statistic; the gear-shift gate reads the same rule. Off is the 2026-11-06 rule byte for byte.
- TypeScript: `HorseOpponentExploit.ts` (`STYLE_SHIFT_NOISE_K`, `styleShiftMoved`, `styleShiftBeyondNoise`),
  `HorseMind.applyStyleShiftReleaseIsNoiseAwareOption`, applied by the decision worker before every job.
- SQL twin: `20261121171027_the_style_shift_release_can_be_noise_aware.sql` (`fn_horse_exploit_add` reads the same
  switch row and calls `fn_horse_exploit_add_rule`), proved equal to the engine on PostgreSQL 16 by
  `scripts/ci/test-horse-exploit-style-shift-release-postgres.py`.
- Registry: `HorseDataLedger`, `HorseOptionSwitch` (release default OFF, Hold'em Strategy lane, shadow refused),
  switch list `20261122011559_horse_option_switch_style_shift_release_noise_aware.sql` (follows
  `20261121214238_horse_option_switch_holdem_priced_options_harm`; adds the option to the plain list only).
- League: `flh_style_release_noise_aware_steal_vs_value_only_blinds` and `human_nlh_style_release_noise_aware`
  (human-field cards: the process switch is set per pass, `withLeagueProcessSwitches`; a mirror card refuses to split
  it), and `server/src/scripts/styleShiftReleaseLeague.ts` for the Omaha development field and the gear-changer
  controls.

## Measured (seeds 20261120 and 20261121, bb/100 A minus B)

- Fixed-limit steal over mixed-frequency over-folders: +0.32 +/- 0.11, z 2.96 (the steal alone diverged on 2 of
  20,000 pairs; with the fix 84 and 68).
- Calibrated NLH field: +12.83 +/- 3.95, z 3.25.
- Omaha development field (PLO4): -13.92 +/- 7.51, z -1.85; seed 20261121 alone -27.79 +/- 12.04, z -2.31.
- Gear changers (the opponent's bb/100 against the Horses, on minus off): time shifter -25.20 +/- 47.80, tight image
  -6.34 +/- 21.46; no harm seen.
- `HorseManiacPressure` style-change streams with the option on: the same hands as off (NLH 21 and 11; PLO4 17 and 12,
  off 13).

Evidence NOT MET (`docs/horse-option-authority.d/styleShiftReleaseIsNoiseAware.md`): the Omaha reading must be
explained before any switch-on.
