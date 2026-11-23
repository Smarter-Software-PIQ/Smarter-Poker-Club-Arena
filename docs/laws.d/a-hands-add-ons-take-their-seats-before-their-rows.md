# tests/a-hands-add-ons-take-their-seats-before-their-rows.law.test.ts

A hand's add-ons take their seats before their rows: the post-commit envelope (fn_ca_process_hand_post_commit_obligations) locks every live seat resolve_pending_addon will lock, by seat id, and then every add-on row, by created_at and id, before its add-on loop, the order every other door takes them in, so delivering a top-up after one hand can no longer deadlock with the next hand's commit on the same chair; the loop's own order, and so every amount applied or refunded, is unchanged (migration 20261123023325).
