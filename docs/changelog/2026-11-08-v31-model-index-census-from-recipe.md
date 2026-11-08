# V31 Public215 Model Index Takes Its Census From The Frozen Recipe (2026-11-08)

`server/scripts/assemble-public215-model-index.py` refused any dataset that was not R7's shape: it required exactly 107 contexts, 57 sources per context, 6,099 global capture sources and 107 Linux parity results. R8 is 100 contexts x 57 = 5,700, so its model index could not be prepared.

The assembler now reads the census from the approved manifest (`public215_contexts`) and its frozen `training_recipe` (`context_count`, `training_sources_per_context`, `source_count`), and refuses any disagreement between them (`EXACT_RECIPE_CONTEXT_CENSUS`). For R7 every check is the same as before (107 x 57 = 6,099). Test: `test_census_comes_from_the_manifest_and_frozen_recipe_not_r7_literals`.
