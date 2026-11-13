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

## Six-card tables

Dan, November 12: six-card tables needed to be larger; that was the point. The
earlier exclusion of six-card layouts is removed. The hero six-card row shift
and the six-card hidden fans were already reserved as hard obstacles, so the
cards keep their room; the fixture now exercises a six-card seated ring and a
six-card spectator ring through folds, reveals and turns with fixed artwork.

## One Size, Centred, Never Moving

Dan, November 12: every avatar is the exact same size in six- and nine-handed
games, never moves once set, is always centred over its frame box, and is the
largest size that overlaps or blocks nothing displayed.

Every opponent portrait on a table now takes one uniform zoom: the largest
rung that every occupied seat can take at once, grown straight up from its
plate with no sideways shift and no torso crop, checked first against the
settled table and then against every neighbour already at that size. The
seated hero keeps its approved 2x, centred the same way; opponents are never
taller than the hero's portrait. The marker solver (chips and puck) now treats
the enlarged portrait as a display to stay clear of, so the fitter no longer
guesses rest zones: the felt band and the per-seat bet envelope are gone, the
puck keeps a small box at its preferred spot beside each chair, and chips
already on the felt stay hard. A seat's own face-down fan, drawn over its
portrait like its tag and badge, is passable for that seat only; the amount
lane is a fixed 108 px centred on its seat. The fixture pins one size for
every opponent and a centred transform on every portrait.

## Sizes Never Change Once Set

Dan, November 12: avatars were flickering between large and small; they must
stay the same size 100% of the time, with no size changes.

Causes, all fixed: (1) any layout-key change (an iOS toolbar collapsing
resizes the scaler) cleared the fitted paint and dropped every portrait to its
small baseline until a refit; (2) each pass removed and restored the image's
filter, restarting its 0.25 s filter transition, which the opponent layout
reads as a running animation and so never settled, so the refit never came;
(3) the uniform size was searched afresh on every refit.

Now a pass that cannot refit carries the displayed paint over on any layout
that still takes it, and requests its own refit (bounded); the reset before a
pass removes only the zoom, translation and plate frames (what moves a box),
never the filter or torso clip; the table's chosen sizes are locked and a
refit confirms them before searching; fitted choices and their reservations
survive key changes, rescaled to the current render ratio; row placement
measures the resting portrait slot, never the zoomed paint on screen. A layout
that no longer takes the paint (kill table, landscape, narrow phone) drops all
of it. The fixture pins it: a viewport height change and the relayouts after
it keep every portrait's paint byte-for-byte.

## The Lock Is Absolute

Measured live after release 088a8778 (every frame for 75 s per table, through
viewport-height changes and live hands): no portrait ever dropped to its small
baseline, but a refit could still re-decide the size. A PLO6 table stepped once
from 1.55x to 1.5x after a height change, and a Lightning table stepped
1.7x, 1.6x, 1.55x, 1.45x as players came and went. Once a table's sizes are
set they are now final for that ring: every later refit (resize, toolbar, new
hand, new player) reuses them exactly with no search. Existing portraits keep
their exact transform, rescaled to the current render ratio; a new arrival
takes the locked size, straight up from its plate, centred, cropped at its
plate. Only a different ring (capacity, or the viewer sitting down or standing
up) starts over.
