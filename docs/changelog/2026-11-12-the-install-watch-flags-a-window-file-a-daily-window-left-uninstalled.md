# 2026-11-12: the install watch flags a window file a daily window left uninstalled

The daily-maintenance window installer was skipped on 2026-11-10, 11-11 and
11-12 because each day's reservation refused at the 03:30 Chicago cutoff
("Release controls changed during reservation"). Nothing reported it: the
merged-migration install watch remembers window files and never pages them,
so six window files sat uninstalled across three windows and the alert store
stayed silent.

Migration `20261112105047` adds step 4 to `fn_ca_merged_migration_install_watch`.
A waiting window file that was on main before the latest window's 03:30 cutoff
and is still uninstalled at 04:20 Central is raised once as
`WindowMigrationNotInstalled`. The alert is a warning in the private alert
store, not an owner page. Step 2 resolves it when the file installs, is removed
or is superseded. The hourly rule is unchanged. The installer fix itself is #10585.

Native proof: `scripts/ci/test-a-merged-migration-left-uninstalled-is-paged.py`.
Two new cases cover it, and they fail on the `20261112035143` definition
(`MIGWATCH_PRE_WINDOW=1`).
