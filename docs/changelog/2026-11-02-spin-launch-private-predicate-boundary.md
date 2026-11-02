# Spin launches keep private conversion calls inside their owner

Production held 64 full three-seat Spins in REGISTERING on November 2. Their paid seats and immutable draws existed, but the launch presentation update failed. A single self-aborting reproduction under SET LOCAL ROLE service_role returned SQLSTATE 42501, permission denied for fn_ca_midway_free_buy_conversion_transition. The same update as postgres succeeded inside the rollback probe.

The November 2 Free Buy migration added an unconditional call from the invoker fn_guard_managed_game_lifecycle trigger into a postgres-only conversion predicate. Every tournament update reached that call, including unrelated paid Spin launches. The funding/conversion tests ran as postgres and missed the engine role.

The follow-up migration nests that predicate call inside current_user = postgres, the identity of the existing private SECURITY DEFINER converter. All other callers reach the unchanged ordinary lifecycle checks. It grants no new access and changes no money, roster, draw, payout, launch identity or registered-contract rule. The private converter and money helpers remain private.

Regression: the maintained native Free Buy suite now reproduces the original permission failure as service_role, installs the exact follow-up migration, exercises engine presentation updates and ordinary authenticated updates through both trigger bodies, refuses a protected registered-contract change and forged conversion context, and verifies private ACLs and rollback. Existing 412-entry conversion and custody tests continue to run through the required chip-journal registration gate.

Delivery and live original-cohort results are tracked in the task checkpoint; source changes alone do not establish recovery.
