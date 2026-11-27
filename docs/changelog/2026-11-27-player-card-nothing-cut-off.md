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
