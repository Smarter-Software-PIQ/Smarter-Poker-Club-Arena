# Mobile Avatars Grow As Large As The Real Features Allow

Dan, November 12: the published enlargement "hardly looked changed at all"; the
goal is portraits as large as possible without breaking functionality or
overlapping existing features or displays.

Live measurement on production (WebKit, iPhone 14 Pro profile, isolated E2E
spectator) showed why: on a full six-max cash table two of six portraits grew,
on a full nine-max two or three of nine grew, and the rest kept scale 1. Two
rules in the fitter refused nearly every seat on a phone: an "adds no felt
pixel" gate, and a bet-tag lane reserved across the whole screen width for
every seat, which turned each seat's tag lane into a wall for its neighbours.

The felt is a surface, not a feature. The fitter no longer refuses felt
coverage. Every real display stays a hard obstacle: hero and revealed cards,
hidden-card fans in every state the variant can deal, the seat's bet chips and
amount tag (now reserved as the seat's own lane plus a new chip-stack envelope
at the seat-wrapper's bet offset, and any chips currently displayed), name
plates, position badges, dealer-button positions, pot, board, HUD, controls
and the other portraits. The zoom ceiling rises from 2x to 2.5x; a seat takes
the largest zoom its obstacles leave room for. Artwork stays fixed during a
hand exactly as before; anchors, hit targets and seat positions do not move.

Unit coverage pins the new behaviour (growth over the felt, refusal over a
reserved bet stack, the 2.5x ceiling). The real-component spectator case
passes. Production proof follows publication through the live spectator check.
