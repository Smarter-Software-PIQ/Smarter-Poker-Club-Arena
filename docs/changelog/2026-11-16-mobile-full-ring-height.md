# Full-ring phone tables retain their longer canvas

A portrait phone lays the table out at 600 CSS pixels. Its final full-ring cap
reserved essentially the same 12% height as six-max, making both rings nearly
equal in length. Full ring now reserves half that top band and uses the actual
embedded slot down to the hero clearance when browser chrome retracts.

Both phone layouts keep the hero frame just above the fixed controller, including
the hand-strength label. Private cards share the frame's resting bottom edge;
the card reservation geometry uses the same anchor for all hand sizes and
retains deal/peek travel. The clearance equations use the current rail width caps.
No hand or action state feeds table sizing.

The existing CSS Beat table-proportions spec now exercises real phone screens
with the production scaled viewport, short/tall viewports, safe insets, stable
browser-chrome budgets, two/six cards and both rings. It requires a longer full
ring, aligned card/plate bottoms, complete label clearance, bounded empty space
and unchanged table dimensions when the action state changes. The original
source fails the length assertion in an isolated real-component reproduction.
Existing avatar reservation and static reserve tests cover the changed anchors.
Client-only publication uses the existing protected static publication route.

The static-reserve unit suite snapshots its unchanged source corpus once, as it
already does for CSS, instead of rereading every source file for seven assertions.
This removes the observed shared-SSD timeout without changing coverage, assertions
or timeout limits.

The built-app phone gate also checks the complete hero and HUD at a minimum of
two physical pixels above the frame. Its 320px/390px cases caught a layout-pixel
conversion shortfall before publication. Four layout pixels retain that minimum
at the smallest phone scale; the guard remains unchanged.
