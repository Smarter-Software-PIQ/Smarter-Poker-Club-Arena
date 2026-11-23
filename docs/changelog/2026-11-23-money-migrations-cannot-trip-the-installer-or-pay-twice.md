# A money migration cannot trip the installer or pay a player twice

Two mistakes were made on the night of November 22 to 23 while a member's
promo was being returned to her. Both were caught by people reading, not by
the build. Both are now refused by the build.

## 1. Forcing every deferred check also forced the installer's own

`20261123024924` ran `SET CONSTRAINTS ALL IMMEDIATE` inside its DO block, to
fire the ledger's conservation checks before COMMIT. The installer
(`scripts/ci/apply-recorded-migration.mjs`) runs a file and its history row in
one transaction, and since `20261119053515` that transaction has a deferred
check of its own: `ca_migration_applier_claim_is_recorded`. "ALL" included it.
It fired before the history row existed and production refused the install at
04:10 UTC with `migration_applier_claim_unrecorded`. Nothing was applied and
the member waited for another install slot. #11822 moved the statement into
the probe branch.

**The rule** (`scripts/ci/migration-installer-claim-shape.mjs`). For a
migration from `20261123024924` on, in the text the install executes (comments,
string literals and function bodies removed), `SET CONSTRAINTS ALL IMMEDIATE`
in any case or spacing is allowed in one shape only:

    IF <condition> THEN
      SET CONSTRAINTS ALL IMMEDIATE;
      RAISE EXCEPTION ...;

A branch that always raises cannot commit. `SET CONSTRAINTS <name> IMMEDIATE`
stays allowed. The installer asks the same question before it connects and
refuses with a sentence, and
`tests/a-migration-cannot-force-the-installers-claim-check.law.test.ts` asks
it of every file at merge. Thirty-one older files carry the statement; they
already ran and are not re-judged.

Another session landed a line-based law for the same mistake the same night
(#11830, `tests/a-migration-never-fires-the-applier-claim-early.law.test.ts`):
it accepts the statement only when the line above is exactly `IF v_probe
THEN`. The two agree on the shape to write, the one `20261123024924` carries:
`IF v_probe THEN`, the statement and the `RAISE EXCEPTION` on three lines.
This rule adds the RAISE requirement, any case or spacing, and the
installer's own refusal.

Limits, stated in the rule: it cannot tell that the condition is false at
install, and it does not see the statement inside `EXECUTE '...'` or inside a
function the same file creates and then calls.

## 2. A proof is old by the time the file installs

`20261123002808` returned promo to two members. It was proven in a rolled-back
production probe at 00:31 UTC, merged, and waited about ninety minutes. At
00:38 UTC one member's agent re-sent him the same 10.00 by hand. The file
refused only on its own idempotency keys, so it would have paid him twice. It
was held and superseded by `20261123024924`, which refuses if any promo credit
from the same fund reached the member after the refund.

**The rule** (`scripts/ci/migration-made-whole-guard.mjs`). A migration from
`20261123120000` on whose install calls `fn_ca_adjustment_under_10_9` must
carry, before `BEGIN;`, exactly one line

    -- @already-made-whole-guard: <one sentence naming what is checked>

and, in its body, an `IF ... EXISTS (... public.chip_ledger ... created_at >
<event time> ...) THEN RAISE EXCEPTION`. Pinned by
`tests/a-hand-settlement-rechecks-at-install.law.test.ts`, which also holds
the exact held bytes as its failing case.

Limits, stated in the rule: text cannot prove the read names the right member,
fund or time, or that the ledger is the only place a make-good could land. It
makes the author write the re-check and say what it reads.

`20261123024924` is installed and was not edited (production stores a
migration's exact bytes in its history row). It carries the re-check but not
the header line, so the cut-over sits above it; the test shows it passes whole
once the line is added.

## Where an agent reads this

CLAUDE.md 10.9 ("Prove, then re-check at install") and section 3 of
`scripts/dev/probe-rpc.sql`.

## The installer's pinned bytes

`apply-recorded-migration.mjs` gained one import and one refusal directly
after the install-budget refusal, before any connection. Its hash is restamped
in the two source bindings that pin it, with the diff described there.
