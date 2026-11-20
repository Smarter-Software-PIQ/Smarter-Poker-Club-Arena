# All-In Is Always Two Actions, And River Equity Shows Only A Split (2026-11-19)

## Owner Rulings

- "you need to fix the all in button from auto going all in. either the slider goes all the way up and you click all in, or if the all in button is clicked, they need to confirm all in. either way, two actions for all in, never just one."
- "on the river it should never display 0% equity and 100% equity... thats already appearent by the hands. those pop ups with equity are only for pre flop, on the flop and turn. and only if its a split pot on the river show the split %"

The first ruling supersedes the 2026-08-19 "do NOT add a confirm-all-in button" rule.

## All-In

Root cause: `ActionPanel.handleAllIn` dispatched `allin` on the first tap from the main ALL IN button and from the bet-sizing ALL IN preset; the fixed-limit wager that equals the stack, the A key (`onAllIn` -> `handleActionPanelAction('allin')`) and the multi-table tile ALL IN did the same.

Now:

- Main ALL IN button and fixed-limit all-in wager: first tap arms (red "Confirm All In"), second tap shoves. The arm lapses after `ALL_IN_ARM_MS` (4 s), at the end of the turn, or when the all-in amount changes.
- Bet-sizing ALL IN preset: moves the slider to the top; the confirm button reads "All In For N" and is the second action. Where a pot-limit cap keeps the slider below the shove, the preset arms and confirms instead.
- A key: `allInIntent` nonce handed to ActionPanel; first press opens the slider at the top (or arms), second press confirms through the same `onAction` path.
- Multi-table tile: ALL IN, and a 1/2 Pot or Pot preset that would put hero all in, open the slider at that amount; the confirm reads "All In".
- Release UI harnesses (`player-browser-input.mjs`, `rit-player-ui-suite.mjs`) perform both actions.

Law: `tests/all-in-is-always-two-actions.law.test.tsx` (replaces `tests/actionpanel-no-allin-confirm.test.tsx`).

## River Equity

Root cause: the engine emits `all_in_equity` on every street including the river, and no client surface gated it by street.

One pure gate, `src/lib/equityDisplayGate.ts`: before the river every entry shows; on the river (every dealt board complete) only entries strictly between 0 and 100 shared by at least two players show, otherwise nothing. The street is read from the board each entry was computed on. Applied in `EquityBadgeLayer` (required `boardCardCounts` prop), the Run It Twice rows in `TablePage`, and the hand-history equity chips in `HandDetailView`.

Law: `tests/river-equity-shows-only-a-split.law.test.tsx`.
