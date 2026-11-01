# 2026-11-01: the header notifications channel joins as the signed-in player

Found by the World Hub suite `messenger-calls-clubarena` (runs 41279887581 and
41280281132). A ringing call wrote its `incoming_call` row, and the Club Arena
lobby showed the Tap To Answer alert, but a page loaded straight onto a cash
table never did. Its realtime frames showed the ringing row's DELETE arriving
on `header-data-<user>` and its INSERT never arriving, and the channel's join
carried no access token.

`useHeaderDataStore` called `subscribe()` the moment `loadOnce` ran. On a table
route the main header is hidden, so `HeaderAppearanceSync` starts the store from
the user store, before the realtime socket is authorised. The channel joined
without a token, and row level security on `notifications` dropped every INSERT
(a DELETE carries only the key and is not filtered). Calls, new-message
pop-ups and the bell count were all silent at a table opened cold.

The channel now joins through `subscribeRealtime`, which waits for the shared
realtime admission (socket open and authorised), like every other page
channel. A pending admission is abandoned on teardown or a user change.
`tests/unit/headerChannelJoinsAuthenticated.test.ts` pins it.
