# Collision reservations retain installable migration versions

The Horse preregistration delivery's trusted migration-ledger check failed on a default-branch migration that the production applier could not install. The shell reservation tool's collision fallback concatenated a twelve-digit minute with four random digits, producing sixteen-digit versions. Its validation gate checked letter suffixes and name length but did not reject that shape.

The existing reserver now draws a valid fourteen-digit UTC second in the next hour on collision. It also refuses a reservation when its lock cannot be acquired, retaining the other caller's lock instead of proceeding and removing it. The existing naming gate enforces the production applier's fourteen-digit filename contract for new executable work; verified historical recordings and inert tombstones keep their existing treatment.

Both affected unapplied reporting migrations were re-reserved through the corrected shell helper. Their entire SQL files remain byte-for-byte identical:

| Former version   | Reserved replacement | Window |
| ---------------- | -------------------- | ------ |
| 2026110120481553 | 20261101220206       | w1q28  |
| 2026110120487766 | 20261101220250       | w1q21  |

Neither old version/name had an installation-history row. This change executes neither reporting operation and changes no financial records. Their original owner retains those operations. Git records both moves as 100% renames; the task evidence retains their full-file hashes.

The forced-collision and held-lock regressions fail before the reserver correction and pass afterward. The malformed-name regression likewise fails against the former validator. The connected reservation/name test set passes 26 assertions. The trusted ledger checks default main, so its existing failure can only be verified resolved after the protected filename correction reaches main; it is not reported as passing on the unmerged branch.
