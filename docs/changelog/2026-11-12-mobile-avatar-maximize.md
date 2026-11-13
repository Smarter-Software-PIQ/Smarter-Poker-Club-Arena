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

## Second pass, after the first live measurement

Release bb612c23 measured live on production (iPhone 14 Pro WebKit, spectator):
six of six portraits grew on a full six-max cash table and three of five on a
nine-max, with bottom and top seats at 2.45 to 2.5x. Several mid-rail seats
still stopped at 1.05 to 1.15x. Two causes: a seat's own action/amount tag lane
was a wall whenever that character's crown sat a few pixels short of the lane,
and the new bet-stack envelope was wider than the chips and amount it guards.
The seat's own tag lane is now always passable (the tag is drawn over the
portrait at z-index 30, so it stays whole), and the bet-stack envelope is
84 by 40 layout pixels. Other seats' tags, all cards, plates, badges, dealer
button, pot, board and controls remain hard obstacles. The seated hero keeps
the owner-approved 2x; opponents may reach 2.5x, capped by the hero's height.

## Third pass

A top chair's amount lane (seat width plus 48 px each side) reached across its
lower neighbour's crown, and a seat's own position badge was a wall at the
crown's right. The lane pad is 20 px (the widest pill is under 100 px), and a
seat's own badge, drawn over the portrait at z-index 6, is passable like its
own tag. Both stay hard obstacles for every other seat's portrait.

## Fourth pass

The dealer-button reservation is the hull of every spot the puck can take,
built from rim bands 0 to 100 px deep. Markers (puck and chip rests) live in
the outer 52 px; the deeper rungs reserved felt nothing rests on and walled
every mid-rail portrait. The band now stops at 52 px. The bet containment
cases (bets never read as another player's, never cover a portrait) pass with
it; a 0 px band failed them, so the band is the right guard, not the hull.
