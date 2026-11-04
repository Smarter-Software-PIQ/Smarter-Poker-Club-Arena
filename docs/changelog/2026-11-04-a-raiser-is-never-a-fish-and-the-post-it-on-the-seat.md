# A raiser is never a Fish, and the post-it on the seat (2026-11-04)

Two items from Dan, raised with Burls's share card.

## 1. The "FISH" title on a winning 34/17 player

**What Burls saw.** His KINGS CLUB cash card for the last 30 days: 1,623
hands, +13.6 bb/100, +420, VPIP 34.3%, PFR 17.1%, titled **FISH**.

**It was not random.** The title is computed by
`src/services/PlayerStyleClassifier.ts` from the exact figures printed on
the card (verified against the live `ca_player_stats_overview_separated_by_club`
payload for his account: VPIP 0.3432, PFR 0.1707, aggression factor 1.12,
1,623 hands). He missed the Fish rule proper (VPIP must exceed 35), missed
LAG (PFR must exceed 18), missed TAG (VPIP must be 28 or under), and then
landed in a **catch-all** that titled ANY player over 30% VPIP a Fish whenever
their aggression factor was under 2.0. That catch-all was the defect: a Fish
is loose AND passive, and a player who raises half the hands he plays is not
passive.

**Why the aggression factor could not rescue him.** The platform's AF
(`ca_fact_aggression_counts`) counts PREFLOP calls in its denominator. From
his own hand records: 290 preflop raises, 298 preflop calls, 203 postflop
bets/raises, 135 postflop calls. Total AF = 493 / 433 = 1.14 (what the card
reads). The textbook postflop AF the classifier's thresholds were written
against is 203 / 135 = 1.50. Every loose player's AF is pulled under those
thresholds the same way, so AF can only be a secondary signal.

**The fix.** The decision tree now reads VPIP (how many hands) and the
PFR / VPIP ratio (how many of them were raised) as the primary signals, with
AF breaking ties. No branch labels a raiser passive any more. Burls now reads
**LAG** (loose-aggressive). A genuine 38/9 or 36/12 player still reads Fish.
`tests/unit/PlayerStyleClassifier.test.ts` pins his exact live figures and
sweeps every VPIP from 15 to 70 to prove a player whose PFR is at least half
his VPIP is never titled Fish or Station.

**The badge now reads the same range as the card.** It used to be computed
from the LIFETIME stats and printed beside "Last 30 Days" numbers, so the
title could come from hands the card did not show. It now reads the printed
range and nothing else; when that range has too few hands to call (under 300)
the card carries no title rather than one borrowed from hands it does not show.

## 2. Player notes, audited, and the post-it on the seat

**Audit.** Tapping an opponent's avatar opens the throwable selector with a
**Notes** tab (or the note directly when throwables are off), which opens the
note editor: text, tags, colour, Cancel / Save. Save goes straight to
`player_notes` (self-owned under RLS; full unique index on
user + target, so the upsert is sound). The Notes Library lists, searches and
deletes. All of that was built and working. Two defects found and fixed:

- **A blank save wrote an empty row.** Clearing the text, tags and colour and
  pressing Save stored an empty note, which then counted as "a note on this
  player" everywhere notes are counted. A blank save now removes the row and
  says "Note Cleared".
- **Library swatches were painted with the raw DB label.** `'none'` is not a
  CSS colour, so the default swatch rendered transparent. Labels now map to
  their hex.

- **The Notes Library had no door.** The list / search / delete view of every
  note was fully built and reachable from nowhere. The hero hub (tap your own
  avatar) now carries **Player Notes** under the Profile tab, which opens it.

Saves and deletes also announce themselves through `playerNotesService`, and
the editor now confirms "Note Saved".

**The post-it.** `SeatSlot` takes `hasNote`; when true (and the seat is not
the hero's) it paints `.seat__note-marker`: a 16px sticky note in brass
(`#d6ad52`, the sanctioned warm accent) with a folded corner and three ink
lines, on the avatar's lower-left shoulder opposite the status dot, so the
bounty pill (seat top-left) and the position badge (avatar top-right) never
cover it. It is a marker, not a button: the avatar tap already opens the note.

`usePlayerNoteMarkers(userId)` loads the viewer's noted opponent ids once
per sign-in (ids only, never note text) and flips single bits from the
service's change feed, so a save shows the post-it immediately and a delete
removes it, with no re-read. It empties on sign-out or account switch; notes
stay private to their author.

Law: `tests/the-post-it-marks-a-noted-opponent.law.test.ts`
(`docs/laws.d/the-post-it-marks-a-noted-opponent.md`). Hook test:
`tests/unit/usePlayerNoteMarkers.test.tsx`.

## Files

- `src/services/PlayerStyleClassifier.ts`, `tests/unit/PlayerStyleClassifier.test.ts`
- `src/pages/PlayerStatsPage.tsx` (badge reads the printed range)
- `src/services/PlayerNotesService.ts` (change feed, `deleteNote`, `getNotedTargetIds`)
- `src/hooks/usePlayerNoteMarkers.ts`
- `src/components/table/SeatSlot.tsx`, `SeatSlot.css` (the marker)
- `src/pages/TablePage.tsx` (feeds `hasNote`; opens the Notes Library)
- `src/components/table/HeroHubPanel.tsx` (Player Notes item)
- `src/components/gameplay/PlayerNotesPanel.tsx`, `tests/unit/PlayerNotesPanelAccountSwitch.test.tsx`
- `tests/the-post-it-marks-a-noted-opponent.law.test.ts`, `tests/unit/usePlayerNoteMarkers.test.tsx`, `docs/laws.d/the-post-it-marks-a-noted-opponent.md`

## Follow-up the same day: titles explained, notes made usable

**Titles (Phase 1).** `VARIANT_LOOSENESS` scales VPIP by the games in the
sample (PLO 1.3, PLO5 1.4, PLO6 1.5, Short Deck 1.35, Hold'em 1) so a PLO
regular is judged against PLO ranges; every result carries a `reason` in the
player's own numbers ("Plays 34% Of Hands, Raises About Half Of Them"); only
Shark, TAG and LAG are `shareable` and print on the share image, the full read
staying on the Trophies tab with its reason; a card under 300 hands says when
its title unlocks. TAG, Rock and Maniac join `PLAYER_TAGS`.

**Notes (Phase 2).**
- The player menu (tap an opponent) now opens with **Add Note** / **Edit
  Note** carrying the post-it glyph, and prints an existing note's colour and
  tags under it: the read without the editor. Notes had two users in
  production; the door was a small word in the header.
- The seat post-it is tinted with the note's colour label; brass when none.
- Tags are free. The tag-pack diamond purchase and the VIP status read are
  removed from the panel (Dan: Club Arena is free to play).
- A note written on another device reaches every open table over realtime:
  migration `20261104193818` puts `player_notes` on the realtime publication
  with `REPLICA IDENTITY FULL` (so a DELETE can be attributed under RLS);
  `usePlayerNoteMarkers` subscribes to the player's own rows on the shared
  socket and re-reads once after a rejoin.
