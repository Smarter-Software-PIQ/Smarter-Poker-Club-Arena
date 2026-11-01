# A ringing call alerts the player anywhere in Club Arena (2026-10-31)

Dan: "THE ONLY TIME ANYTHING APPEARS IS ONLY IF YOU ARE INSIDE THE MESSENGER
WHILE THE CALL IS RINGING, ZERO NOTIFICATIONS ANYWHERE ELSE."

Calls ring in the World Hub's CallProvider; Club Arena had no call handling at
all. The production trace of Dan's 20:50 UTC call showed the callee had been
playing in Club Arena until 20:41 (client `supabase-js-web/2.90.1`).

The World Hub now writes every ringing call as an `incoming_call`
notification row (World Hub #2627). In Club Arena:

- `useHeaderDataStore` re-dispatches that row as `ca:incoming-call` from its
  existing notifications channel, and any row deletion as
  `ca:call-alert-cleared`.
- `IncomingCallAlertHost` (lazy, mounted beside `MessageAlertsHost`) shows a
  45 second alert, "Incoming Video Call From <name>. Tap To Answer". The tap
  opens `/hub/messenger?incomingCall=<room>&answer=1`: in a "+" hub tab when
  live tables are open (HubFrame allows camera and microphone and keeps every
  felt mounted), otherwise as a page. The alert is removed when the World Hub
  deletes the row because the call was answered, declined or ended.

Pinned by `tests/unit/incomingCallAlerts.test.ts`.
