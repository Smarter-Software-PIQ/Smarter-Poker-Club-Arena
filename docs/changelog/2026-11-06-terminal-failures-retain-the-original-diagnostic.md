# Terminal failures retain the original diagnostic

The 45-day freeze review found 1,061 original terminal-refusal alerts classified only as `other`. The ordinary finish catch held the actual error but persisted only event, winner and outcome booleans. A rotated process log therefore removed the evidence needed to investigate the refusal. The satellite catch included text in its message but omitted structured error identity too.

Both existing catches now retain the original message (at most 2,048 characters) and error name (at most 128) in the existing durable alert. No stack or arbitrary error properties are copied. Existing unknown-outcome fencing happens before the alert, and refusal backoff, deduplication, original request identity and financial execution are unchanged.

The actual finish/stop ownership regression failed before for MTT, SNG, Spin and satellite and passes after, including an oversized diagnostic and a blocked alert writer. This repairs evidence loss; it neither reconstructs missing historical causes nor qualifies any unknown freeze as fixed. Source, protected checks, deployment and live evidence are separate states recorded in the owning checkpoint.
