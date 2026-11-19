# The Omaha nut-class pot size is off-only (omahaNutClassValueSize)

omahaNutClassValueSize failed its declared re-run on 2026-11-15 (Horse-only PLO4 -1.19 bb/100, z -2.91; PLO5 -1.31, z -2.22; human-like field +2.29, SE 0.44) and Hand Analysis ruled it OFF; #10989 made it read `=== true`. The option switch still offered `on` for it and listed its release default as on. Now it is in OPTION_SWITCH_OFF_ONLY (ploFailed) and in the release-default OFF list, the law test lists it with the other failed 2026-11-15 options, and the follow-up migration `20261118164511_horse_option_switch_omaha_nut_class_off_only` re-asserts the database lists (the PostgreSQL proof script lists follow). No decision changes: no switch row exists for it, and the code default is off.

Authority file: docs/horse-option-authority.d/omahaNutClassValueSize.md. The migration installs only in an installer window.
