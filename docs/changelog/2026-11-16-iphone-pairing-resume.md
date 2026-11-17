# iPhone Browser Pairing After Resume

An approving browser listened only for newly inserted pairing requests. Opening Safari after an iPhone Home Screen browser requested approval could miss the request and leave the requester waiting. Read recent pending requests for the authenticated account and enrolled device when the listener starts, subscribes, reconnects, or the page returns to the foreground. Keep the existing three-minute request lifetime and server authorization; never infer physical identity from a user agent.

Deduplicate prompts across reads and live delivery. Keep a failed Approve/Deny choice visible for a user retry, disable duplicate submissions while it is pending, and close prompts/listeners when signing out. The requesting browser also reads its verdict immediately and on foreground, retaining its existing bounded observation. Sign-out cancels that waiter without opening another enrollment dialog.

Regression coverage in `aLoginOnANewDeviceClaimsTheAccount.test.ts` exercises startup, foreground/reconnect, duplicate events, stale/foreign requests, failed decisions, sign-out and immediate requester completion. Five new regression cases fail against the preceding implementation. This is a client-only change using existing database contracts; no engine replacement or account binding edits.
