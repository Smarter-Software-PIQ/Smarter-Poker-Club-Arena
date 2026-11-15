# A paused migration install resumes what merged during it (2026-11-15)

Incident c1a85d20 (MergedMigrationNotInstalled, critical, fourth recurrence).

**What happened.** For the 1806z owner engine window, both `apply-merged-migration.yml` and `dispatch-merged-migrations.yml` were switched off at 17:12 UTC (`disabled_manually`), as the cutover playbook's step 5 pause intends. The release sealed `652726c8` at 18:28 UTC. Ordinary merges kept landing: #10983, #10985, #10991, #10997 and #10999 merged 17:26-18:48 UTC with five ordinary migrations. GitHub drops the `closed` event of a switched-off workflow rather than queuing it, so none was ever dispatched, and `fn_ca_merged_migration_install_watch` paged each one an hour after its merge.

**Root cause.** The playbook's resume step was "re-enable the applier". Re-enabling installs nothing that was dropped during the pause, so every cutover that overlapped ordinary merges stranded their migrations until a page.

**Fix.** `scripts/release/resume-migration-installs.sh <pause-start-sha>` is the resume step: it switches both workflows back on, refuses to send unless each reads `active`, and sends every ordinary migration added or modified on main since the pause once, oldest first, through the existing Apply Merged Migration door (which answers ALREADY-APPLIED for an installed version and refuses SUPERSEDED files). Window files stay for 04:00. It refuses inside the :50-:03 UTC DDL refusal. The playbook's steps 5 and 10 and its failure table now say this. Pinned by `tests/a-paused-migration-install-resumes-what-merged-during-it.law.test.ts`.

**Damage.** The five stranded files are 20261114072215, 20261115164243, 20261115164443, 20261115164547 and 20261115170236; they install by running the script against pause point `652726c8b`.
