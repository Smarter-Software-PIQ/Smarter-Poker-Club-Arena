# The withdrawal tool can retire a stuck release that froze and was thawed

Release attempt 42099609162-1 announced an off-cycle break at 20:27 UTC on
November 5 and froze the platform at 20:29. One table still had a hand in
progress, so its restart certificate stayed shut and it refused before changing
the engine. The still-serving engine thawed the break at 20:33. The attempt then
stayed behind as an expired owner, and every newer release refused to compete
with it.

The reviewed withdrawal tool could only retire that kind of owner over a
non-original engine if it had never frozen. It now also accepts an owner that
froze, provided the complete version 3 thaw for its exact announcement exists
and was recorded by the engine that is still serving. Every other check stays
the same: no maintenance owner, a fresh idle leader, its own request deadline
passed, and no later boundary. Anything else still refuses.
