# Lightning Results Card

Lightning's lobby results wrapper matched the global metallic popup selector,
which painted an extra shell behind the approved console frame. The wrapper now
explicitly leaves the frame to the artwork. The recap uses the approved raised
spade head, a prominent fitted silver profit or red loss figure, and readable
blue labels with engraved row dividers. Unknown results remain unknown.

The same recap content is used inside the ended-room notice. Session reads,
settlement completion refresh, View Session, Play Again navigation, and dismissal
remain on their existing paths; this client styling change moves no chips and
requires no engine replacement.

Validation: compiler, copy gates, focused session/action tests and console/global
style contracts; actual component renders with global popup CSS at 375px, 393px
and desktop, including win/loss/zero/unknown/loading/error/long-name states.
A regression pins the missing shell overrides and single-console result.
Delivery and production evidence are retained in the task checkpoint.
