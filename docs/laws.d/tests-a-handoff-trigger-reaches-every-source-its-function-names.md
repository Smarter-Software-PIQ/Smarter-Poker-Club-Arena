# tests/a-handoff-trigger-reaches-every-source-its-function-names.law.test.ts

Every source fn_post_commit_handoff_is_a_warning() compares with `new.source = '...'` must be admitted by the WHEN clause of the latest migration that creates trigger a2_post_commit_handoff_is_a_warning. The Lightning branch added by 20261110234927 was dead code because the trigger only admitted the ServerTableEngine source, and the designed Lightning predecessor handoff kept paging critical (incident ee77584d, 79 occurrences).
