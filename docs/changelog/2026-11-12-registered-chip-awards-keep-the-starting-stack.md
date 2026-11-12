# Registered chip awards keep the starting stack

The rebuy migration from #10558 remains uninstalled. Its trigger function and
the installed add-on twin return immediately for every registered UPDATE.
The service lane is permitted through the lifecycle/registered-contract guards,
so it can persist a mismatched award or starting-stack change. Column-specific
UPDATE triggers also miss awards seeded by an earlier producer trigger.

20261112151009 supersedes the uninstalled 20261112013925 and replaces both twins with one final BEFORE
trigger for every INSERT/UPDATE, after the Free Buy producer. New/unregistered contracts normalize their
awards. Registered deciding-field transitions which introduce a mismatch
refuse with 23514; unchanged historical contracts keep their recorded supply.
Disabled features remain valid. No historical rows, wallet charges, prices,
fees or purchase/idempotency functions change.

The existing daily-maintenance native qualification executes the original
definitions and requires the registered service-write regression to fail,
then installs the actual successor and requires the same assertions to pass.
It covers rebuy, reentry, add-on, starting-stack changes, feature enablement,
earlier producer-trigger writes, disabled options, prices and historical no-ops.
Its existing workflow now selects these migration paths; no new workflow or
dependency is introduced.

Production installation must use the existing daily window route. Source
merge is not installation. Private incident compensation and participant
evidence live in the owning external checkpoint, not this public changelog.
