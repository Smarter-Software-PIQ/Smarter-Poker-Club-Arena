# Satellite settlement counts the live target field

The installed roster trigger has counted a running non-seat-first tournament's registered/playing field since September 22. Both satellite settlement authorities still compared `current_players` with every historical entrant. After a target elimination, a legitimate direct seat could therefore refuse with P0404 until admission closed and the satellite fell back to a ticket.

The November 6 satellite c41182ee-6e7a-453f-870d-57167a124bbd recorded this refusal against target 5022c4f0-04d3-4325-8b1f-303fee1f6ac7, whose retained roster includes two eliminations before the refusal. It ultimately issued twelve value tickets. The generic historical error does not retain each compared bank value, so the source mismatch is demonstrated independently in the isolated funded regression rather than asserting that every historical P0404 has this cause.

Migration 20261106113500 corrects the before/after counter cases in both original settlement functions. Running non-seat-first targets use the live roster count, matching the owning trigger. Total roster growth remains independently checked; seat-first behavior, financial balances, receipt replay and award rules retain their existing checks. Exact function preimages, postimages and owner/ACL checks protect installation. No historical receipt, counter or balance is repaired by this migration.

The existing satellite-value-awards PostgreSQL route includes real paid target registrations, an actual roster-trigger elimination, successful direct seat delivery, malformed-counter refusal and immutable receipt replay. It exercises cohort and single-winner paths and rejects migration replay. The existing accounting shard invokes this route. Qualification and production installation remain distinct; live deployment evidence belongs in the owning task checkpoint.

CI caught the live-proof comment after COMMIT, which the maintained installer refuses. Moved that comment into the header; SQL statements and qualified postimages are unchanged. The maintained migration-installability test validates the final envelope.
