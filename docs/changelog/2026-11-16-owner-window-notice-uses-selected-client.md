# Owner window readiness reads the client actually published

The optional owner-window readiness observer used a publisher run’s trigger SHA
as its delivered client SHA. The publisher intentionally resolves current
protected main after the trigger. On November 16, original run 43926114174 was
triggered by a8d3024e225d71d1dbab9f59d7bfba1f9d2f441f, selected and published
44c1bde95b30adf12cd11bc46c4bbfc4a6fc4e19, and completed its actual
publish-to-origin job at 18:17:36 UTC. The selected client contained the 18:40
notice; the trigger did not. Reading the trigger could suppress a truthful
readiness notification even after the required twenty-minute notice lead.

The observer now uses the existing production-e2e provenance verifier to validate
the original protected publisher run and its unique immutable selected client
artifact. It continues to require a successful actual publication completed
before the lead cutoff and the booked notice in the currently served client.
Missing, ambiguous, expired, incomplete or foreign provenance fails closed.
No release gate, control, schedule, dispatcher or publication route changes.

The maintained Python decision regression uses distinct trigger and selected
client revisions and covers invalid artifacts, foreign source runs, skipped or
failed publication, missing completion and the exact lead cutoff. The existing
notification-only law also covers the reused verifier’s read-only source.
