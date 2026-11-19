# A shared hand is recorded once (2026-11-18)

## What happened

On 2026-11-18 production held three short link reservations for one hand, made inside ten seconds. Their payload lengths were 1,056, 3,030 and 3,540. Each was a different token and a different row in `ca_shared_hands`, and the link shown on the Share sheet changed while the player was looking at it.

## Root cause

The short link is keyed by the md5 of the encoded hand (`fn_ca_shared_hand_reserve`, through `useSharedHandShortLink`). The encoded hand includes the recorded presentation of the table: chip flights, seat paints, throws and board timing. `TablePage` journals those while the hand is on the felt, and the journals do not stop at `hand_complete`. The engine sends `pot_win` about three seconds after `hand_complete`, so the pot push and the winner's seat paint are journalled after the hand has ended.

The page handed the hand to the Share sheet at `hand_complete`, with whatever the journals held at that instant. It then handed it over again, with a larger journal each time, from three places:

1. when either share entry was opened (`refreshCompletedPresentation`),
2. when the next hand started, if the sheet was still showing the hand,
3. when a repeated `hand_complete` or `hand_complete_event` arrived, which rebuilt the whole hand with a new end time and timestamp.

Every hand over produced a new `sharedHandData`, a new payload, a new md5 and a new reservation. Nothing defined when the recording of a hand was finished, so nothing could say which payload was the hand's.

## Fix

`src/lib/sharedHandRecording.ts` is the one place that decides when a hand's recording is final.

- `begin(hand, facts)` is called at `hand_complete`. The hand's facts are kept and nothing is offered to the sheet.
- `seal(journal)` reads the journals one time and freezes the result. Later calls return nothing, and a repeated completion event for a sealed hand is refused.
- A journal that belongs to another hand is not merged, so a later hand's paints cannot reach an earlier hand.

`TablePage` seals at the end of the hand's presentation, which already exists as a defined instant: the post-hand reset (`handCompleteResetFnRef`), which `POT_WIN` pushes past the last award chip flight. The next `HAND_STARTED` also seals, before it empties the journals, for the case where the next deal arrives first. No new timer was added. Because the seal comes after the award is painted, the replay still shows the pot being awarded.

The sheet is given only the sealed hand, and only when a share entry is opened. `hand_complete` no longer writes `sharedHandData`, and the hand on an open sheet is never replaced. If a player taps Share while the award is still being painted, the request waits for the seal and the sheet opens by itself, with a toast saying so. The wait is at most the remaining post-hand hold. If no reset is armed, the recording is sealed on the spot. Sharing the same hand from Hand Detail waits in the same way, because that entry reads the presentation from the local archive, which the seal writes.

A `hand_complete` that names a different hand than the one on the felt no longer starts a recording.

Presentation and sharing only. No gameplay, money or engine path is touched. The sheet's own wait for a pending reservation is a separate change on another branch.

## Regression lock

`tests/unit/sharedHandIsRecordedOnce.test.ts`

- The recording offers nothing while the award is being painted. Three reads of a growing journal encode to three different payloads, which is what the page used to hand over. After the seal there is one payload, and later paints, later seals and a repeated completion do not change it.
- Another hand's journal is not merged.
- A repeated completion refreshes the facts only while the hand is open.
- A share request made before the seal is answered at the seal, with the final hand.
- `TablePage` uses the module, has no `refreshCompletedPresentation`, copies the journals only in the seal's reader, does not write `sharedHandData` in the hand end handler, seals before the next deal empties the journals and at the post-hand reset, and opens both share entries through the wait.

The four `TablePage` cases fail on the previous source.
