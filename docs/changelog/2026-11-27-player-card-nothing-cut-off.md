# Player Management cards: nothing is cut off at the bottom

Dan, 2026-11-27, with a screenshot of seated players' cards: "INSURE THINGS
AREN'T CUT OFF ON THE BOTTOM LIKE THEY ARE IN THE CURRENT LAYOUT."

## Cause

Two things together. The PlayerID, role and status line (which carries a
seated player's table name) sat in the name column only, so a long table name
wrapped to a second line inside a narrow column; and every card had one fixed
height, 187px of pitch, at every width. Measured on the live page at 614px: 12
of 14 seated cards had their table name past the bottom edge. The containment
spec did not catch it because its list of lines that must stay inside the card
left out `.member-seated` and `.member-online`.

## Fix

- The status line spans the full card width under the portrait column and the
  figures (`ArenaWorkspace.css`); the figures sit beside the portrait, name and
  upline.
- The card pitch follows the viewport (`src/lib/rosterCardPitch.ts`): each
  value is the tallest card measured at that width, in both stylesheet orders,
  with the longest table name and the widest figures, plus 8px.
- The containment spec now renders every card at that pitch and requires the
  seated table line and the online status to stay inside the card too.
  `tests/unit/aPlayerCardIsNeverCutOff.test.ts` pins the wiring.

## Selection box in the corner, and air under the portrait

Dan, the same afternoon: "PUT THE CHECK BOX IN THE UPPER RIGHT HAND CORNER,
NOT NEXT TO THE AVATAR. AND MAKE SURE THE NAME TITLE ISN'T TOUCHING THE FRAME
OF THE AVATAR."

- The selection box sits in the card's upper right corner; the figures start
  below its 44px target.
- The portrait and the name share the first grid cell, the name offset 12px
  below the portrait box (8px clear of the 4px ring), so it sits directly
  under the portrait however tall the figures are.
- The containment spec requires both: name at least 8px below the portrait,
  and the box within 24px of the card's top right.

The first push of this branch failed `CSS Beat general shard 1` at 360px and
375px: the hosted runner draws with DejaVu Sans where this machine has Inter,
so its cards came out taller. The pitches are now measured both ways
(`FONTCONFIG_FILE` mapping every missing face to DejaVu Sans reproduces the
runner's failure exactly) and the spec passes under both.

## The left edge shows the club level

Dan, the same afternoon: "THE COLORS ON THE LEFT SIDE SHOULD BE REPRESENTIVE
OF WHAT THERE LEVEL IN THE CLUB IS, THEY SHOULDN'T ALL BE BLUE. OWNER, CO
OWNER AND ADMINS ARE GREEN. SUPER AGENTS, AGENTS AND SUB AGENTS TEAL, AND
PLAYERS BLUE."

The edge used to follow presence (cyan online, blue seated, grey otherwise).
Each card now carries `data-club-level` from `clubLevel()` in
`src/types/clubRoles.ts` (staff, agent, player), and the edge is green
`#35d95a`, teal `#2dd4bf` or blue `#45adff`. Presence keeps the portrait ring
and the Online / At A Table line. `tests/unit/aPlayerCardShowsItsClubLevel.test.ts`.
