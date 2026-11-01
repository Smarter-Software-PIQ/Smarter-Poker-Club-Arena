# Bound the composite supervisor test above its child budgets

The reboot-persistent pending-candidate regression runs three real supervisor
attempts sequentially, each with an unchanged 20-second recovery deadline. Its
15-second parent test deadline was shorter than one child allowance and timed
out during the required push suite, although the unchanged focused case passed
in about five seconds.

Derive this case's parent bound as three 20-second attempts plus the existing
15-second fixture/assertion allowance. All recovery assertions, child deadlines,
production timing, other test budgets and release safeguards remain unchanged.
This repairs a shared Phase 1 engine qualification blocker; it does not certify
activation, Inspector cleanup, hand custody or individual horse qualification.
