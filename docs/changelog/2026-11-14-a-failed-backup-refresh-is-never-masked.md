# A failed Backup refresh is never masked by a later provider error

Independent review of #10805 found one path where its new no-verdict rule weakened failure handling: if the refresh job failed and a later provider answer (the pending status write or the dispatch proof) stopped the certify job before its step turned the refresh result into rc=1, the verdict became `error` and an earlier `success` for the same SHA stayed standing over a partial copy. The verdict step now reads `needs.refresh.result` and writes `failure` whenever the refresh did not succeed, exactly as the certify step already treats it. Pinned in `tests/the-backup-day-ends-with-only-a-four-am-release.law.test.ts`.

The runbook and playbook now also say not to dispatch a booking commit by hand (a manual run never reads ALREADY CERTIFIED), and the DEFERRED wording no longer claims more than an owner selection refuses.
