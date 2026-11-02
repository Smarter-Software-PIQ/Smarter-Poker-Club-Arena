# A missing engine does not establish tournament closure

Mongo's running tournament table showed “This Table Is No Longer Running” after the serving process failed on November 2. The 4404 path in TablePage checked only whether a cash table could be woken; a running tournament row and failed row reads fell through to the closure toast.

The source now requires the existing durable closure predicate before that verdict. Cash on-demand wake stays unchanged. Running tournament tables retain their normal reconnect ladder under their existing manager, without an extra wake, game restart, seat mutation or navigation. Unreadable and missing rows cannot establish closure. Actual closed, completed, cancelled and deleted rows retain the closure message.

Regression coverage retains the real closure predicate's lifecycle cases and binds the 4404 consumer to its wait branch. Validation results are recorded in the incident checkpoint.
