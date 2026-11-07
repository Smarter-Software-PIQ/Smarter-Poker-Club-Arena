# Midway follows the edited weekly spreadsheet

The owner edited all seven day tabs, then directed that each repeated event use the majority settings across its days. The reviewed fixture contains 378 weekly starts. The two overlapping weekday 6 PM templates become one 25 Chip Bankroll Builder. The last explicit owner reply makes the Thursday/Saturday nightcap Last Chance Six Card PLO (PLO6), opening at 50/100, and also sets Sunday Deep Stack Satellite 25 to 50/100.

The existing hard-coded schedule write boundary now retains the reviewed names, days, times and configuration when an older creator submits its historical defaults. The original tournament insert reads those exact terms, including guarantee, total entry, stack, blind structure and registration cutoff. The schedule and final clock boundaries preserve the authored clock. Pre-created tables inherit their event's actual opening blinds. The serving engine already reads these persisted contracts through existing APIs, so this is a database/configuration delivery without an engine replacement.

Existing started or settling tournaments retain accepted terms. A changed unstarted occurrence is cancelled only through `atomic_cancel_tournament`, with its exact refund receipt. The explicit installer releases only that cancelled event's own spawn claim in the same transaction, allowing the existing schedule creator to publish the replacement. Replays preserve the durable receipt and cannot remove a replacement claim. No financial guard is weakened, and no watcher, repair cron or start hold is added.

The native regression reproduces the legacy drift, then exercises all 143 canonical creation contracts, the 378 weekly slots, old-writer attempts, table blind inheritance, unrelated clubs, started-game preservation and operator restrictions. It runs in the existing Midway native CI route. Publication still requires protected merge, exact migration installation and readback of the actual upcoming events.

Source: https://docs.google.com/spreadsheets/d/1L27Z3Wq9FSxyqGMJvAJZtgMXtYKCK4j8F_PUx0RNEJg/edit

The initial installation rolled back at the existing eight-second statement limit: the unchanged exact time-zone validator cost about 56 ms per schedule row, making the 143-row upsert exceed its budget. The uninstalled migration now uses six deterministic upserts of at most 25 rows within the same transaction. The one-second lock limit, eight-second statement limit, validator and schedule guards remain enforced. The native fixture includes the production validator and CHECK.

The transition installer also verifies that a matching satellite still points to an unstarted, announced or registering parent that begins after its feeder. A cancelled or missing parent uses the existing exact cancellation and refund authority. The converted Thursday/Saturday Last Chance Six Card PLO uses seven seats, consistent with the six-card deck capacity.
