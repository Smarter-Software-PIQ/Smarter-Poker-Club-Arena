# tests/the-install-watch-reads-the-release-freeze-the-dispatcher-holds.law.test.ts

The merged-migration install watch starts the hour of an ordinary file whose first hour touches the nightly release schema freeze (23:45-04:15 America/Chicago) at the freeze end, so it never pages "dispatch it" for a file Dispatch Merged Migrations is holding on purpose; the SQL freeze bounds equal RELEASE_SCHEMA_FREEZE_CHICAGO and the native proof runs on every change to either clock.
