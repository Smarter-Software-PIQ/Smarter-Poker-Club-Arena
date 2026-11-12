# F06 recovery requires a started hand

Issue #10564 follow-up to #10575 and #10581. Independent review found that the
bounded recovery counter reset after reservation, before a tournament preparation
could return for a pause. Move that reset to the existing HAND_START consumer.
Calls one through three retain fast recovery; the fourth and later calls preserve
normal stall backoff and watchdog behavior until a hand actually starts.

At the fourth resolution, use the existing durable engine-alert journal and
acknowledged receiver with a stable per-table fingerprint. A genuine HAND_START
resolves the alert, including one inherited by a replacement generation. Teardown
alone leaves the unresolved condition visible. No scheduler, repair mechanism,
new database door, release control or financial rule changes.

The connected regression drives real deal preparation into the time-bank pause
boundary and fails with the old early reset. Coverage also exercises HAND_START,
the exact fourth-call threshold and resolution of an inherited alert. Existing
alert-delivery tests cover offline durability and ordered acknowledgement.

Source review and tests do not establish production adoption. Activation stays
with the sole release custodian; acceptance requires the selected corrected
source, exact certification, seal, thaw and post-thaw progression. Natural eligible
recovery remains separately unverified until observed without manufacturing it.

The final candidate's required native accounting gates exposed a separate delivery
blocker: PGDG published a cron rebuild requiring a server newer than the server
available in its signed index. The maintained shared installer now asks apt to
simulate the complete requested tuple, and considers at most five alternate builds
of the same upstream cron version when the candidate cannot resolve. It records
the selected build and uses the existing signed install and full qualification;
it never changes the upstream extension version or bypasses a native gate. The
installer law tests cover candidate success, compatible selection, refusal,
upstream-version boundaries, explicit requests and the finite search bound.
