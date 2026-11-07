# Midway follows the edited weekly spreadsheet

The owner edited all seven day tabs, then directed that each repeated event use the majority settings across its days. The reviewed fixture contains 378 weekly starts. The two overlapping weekday 6 PM templates become one 25 Chip Bankroll Builder. The last explicit owner reply makes the Thursday/Saturday nightcap Last Chance Six Card PLO (PLO6), opening at 50/100, and also sets Sunday Deep Stack Satellite 25 to 50/100.

The existing hard-coded schedule write boundary now retains the reviewed names, days, times and configuration when an older creator submits its historical defaults. The original tournament insert reads those exact terms, including guarantee, total entry, stack, blind structure and registration cutoff. The schedule and final clock boundaries preserve the authored clock. Pre-created tables inherit their event's actual opening blinds. The serving engine already reads these persisted contracts through existing APIs, so this is a database/configuration delivery without an engine replacement.

Existing started or settling tournaments retain accepted terms. A changed unstarted occurrence is cancelled only through `atomic_cancel_tournament`, with its exact refund receipt. The explicit installer releases only that cancelled event's own spawn claim in the same transaction, allowing the existing schedule creator to publish the replacement. Replays preserve the durable receipt and cannot remove a replacement claim. No financial guard is weakened, and no watcher, repair cron or start hold is added.

The native regression reproduces the legacy drift, then exercises all 143 canonical creation contracts, the 378 weekly slots, old-writer attempts, table blind inheritance, unrelated clubs, started-game preservation and operator restrictions. It runs in the existing Midway native CI route. Publication still requires protected merge, exact migration installation and readback of the actual upcoming events.

Source: https://docs.google.com/spreadsheets/d/1L27Z3Wq9FSxyqGMJvAJZtgMXtYKCK4j8F_PUx0RNEJg/edit

The initial installation rolled back at the existing eight-second statement limit: the unchanged exact time-zone validator cost about 56 ms per schedule row, making the 143-row upsert exceed its budget. The uninstalled migration now uses six deterministic upserts of at most 25 rows within the same transaction. The one-second lock limit, eight-second statement limit, validator and schedule guards remain enforced. The native fixture includes the production validator and CHECK.

The transition installer also verifies that a matching satellite still points to an unstarted, announced or registering parent that begins after its feeder. A cancelled or missing parent uses the existing exact cancellation and refund authority. The converted Thursday/Saturday Last Chance Six Card PLO uses seven seats, consistent with the six-card deck capacity.

The second installation rolled back at the applier's twelve-second transaction limit. Retirement now updates only active schedules, preserving 48 already inactive historical rows and avoiding their repeated time-zone validation. The native fixture enforces the same twelve-second transaction budget and proves those historical rows remain untouched; all existing statement, lock and source checks remain enforced.

The existing-row route uses six bounded updates followed by insertion of missing identities. PostgreSQL checks an existing-row upsert twice; direct updates validate each of the 142 existing identities once. The native fixture includes those existing rows, the retired active identity, the original board trigger and 48 inactive rows under the provider's unchanged twelve-second transaction budget.

A followup migration corrects the required internal add-on break clock to one minute for eleven schedules with add-ons disabled. The disabled setting remains unchanged. The original installed migration remains immutable; only the authoritative catalog and those eleven schedule configurations change. The native fixture reproduces the original NOT NULL failure before the followup and validates all 143 creation contracts afterward.

The existing Free Buy funding watch excludes cancelled historical entries from its missing-ticket branch after exact cancellation returns their tickets. It continues detecting live entries without tickets and tickets still spent on cancelled events. Existing watch closure resolves cleared findings and alerts; no manual alert suppression or financial mutation is added.

The earlier daily 6 PM fallback now applies only when the schedule lacks current authoritative weekly terms. This lets the existing canonical creation guard apply the owner's 50/100 Bankroll Builder structure. Legacy schedules retain their fallback. Native coverage loads the actual earlier bounty guard, reproduces its structure-drift rejection, and verifies canonical creation after the guarded correction.
