# tests/the-addon-resolver-reads-only-open-hand-envelopes.law.test.ts

fn_ca_resolve_unbound_pending_addons skips an add-on that is frozen in an
accepted hand's obligation envelope. It used to find those envelopes by reading
the post-commit payload of every commit the table ever had, which on a long-lived
table (160,470 commits) ran past the 8 s statement timeout on every call; the
engine then killed the table in a loop (135 restarts in 45 minutes on
2026-11-11), left two rebuys unresolved for almost four hours and held the
table's post-commit lock against a must-move from a sister table. Only
fn_ca_process_hand_post_commit_obligations completes an envelope, and it
resolves every frozen id in that same transaction, so an unresolved add-on can
only be frozen in an envelope that is still open. The law pins that the newest
definition restricts the check to open envelopes (payload present, post-commit
not completed), which the partial pending-commit index answers, and that the
eligible rows, their created_at/id order, the hand-post-commit mutex and the
single delivery through resolve_pending_addon are unchanged. The old/new
equivalence, exactly-once, retry, interruption and concurrency proofs run against
a real Postgres in scripts/ci/test-addon-resolver-bound.py.
