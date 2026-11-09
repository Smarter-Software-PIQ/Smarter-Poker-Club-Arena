# tests/a-migration-install-waits-out-a-backup-export.law.test.ts

A merged migration never installs while a Backup Engine refresh is exporting production: the applier waits inside its existing bounded queue and refuses with nothing sent on timeout or an unreadable Backup state, so an install cannot make the certified copy disagree with itself.
