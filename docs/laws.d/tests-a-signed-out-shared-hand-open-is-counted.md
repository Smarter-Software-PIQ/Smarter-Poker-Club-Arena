# tests/a-signed-out-shared-hand-open-is-counted.law.test.ts

A signed-out open of a shared hand is counted, exactly once, and nothing a
caller with no account can run writes the count.

Migration 20261126054024 (issue #9828) made `fn_ca_shared_hand_open` a pure
read and `fn_ca_shared_hand_count_view` the only writer of the view count,
executable by authenticated and service_role only. From then a signed-out open
was not counted, so the sender's "N Views" undercounted.

A signed-in opener still counts through the RPC with their own session. A
signed-out opener posts the token to World Hub's `POST
/api/club-arena/shared-hand-view`, which calls the writer with the service
role, refuses Bearer requests and crawler user agents, and counts one view per
visitor per link per ten minutes. Link-preview crawlers fetch the `/h/<token>`
card and the og image and run no client JavaScript, so they never reach either
path.

The law fails the build if the client reaches the counter RPC outside its
signed-in branch, posts to World Hub from the signed-in branch (a double
count), sends an Authorization header on the signed-out post, waits on the
count before opening, or if any migration from 20261126054024 on declares an
anon-executable shared-hand writer or grants the counter to anon or PUBLIC.
