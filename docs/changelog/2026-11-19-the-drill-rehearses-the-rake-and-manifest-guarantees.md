# The drill rehearses the rake and manifest guarantees (2026-11-19)

Incident `d2d79c4f` (2026-11-18) produced three guarantees that no production
event had yet exercised. Each is now proven on a schedule or on every change.

| Guarantee | Introduced by | Proven by |
|---|---|---|
| A stored rake refused by a rule no retry can change is held terminal, named once, not re-asked under the same law, and releases its table | `20261118192000` | weekly alarm drill arm `rake_terminal_refusal_releases_its_table` |
| A dealt manifest capture that fails on a defect returns refused and names it in one critical alert | `20261119005831` | weekly alarm drill arm `manifest_refusal_is_named` |
| The DDL law `ca_cash_rake_provenance_law` refuses a redefinition that drops the dealt-chair evidence | `20261118164000`, `20261118190500` | `.github/workflows/the-provenance-law-refuses-a-dropped-fallback.yml` on every migration PR |

The DDL law is proven in CI, not by the drill, because proving it takes DDL and
production DDL probes are forbidden (CLAUDE.md section 2, rule 3). The CI job
installs the guard from the latest migration that defines it, so a later
migration that loosens the guard turns the job red.

The drill body is production's own definition (the 2026-10-06 subject change
had never reached a migration file), with the two arms inserted before the
record step. Both arms unwind like the existing nine; a quiet detector leaves
the note empty and pages critical, and the reason is in `detail`.

Pinned by `tests/unit/theDrillRehearsesTheRakeAndManifestGuarantees.test.ts`.
