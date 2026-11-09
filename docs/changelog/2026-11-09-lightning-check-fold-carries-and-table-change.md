# 2026-11-09: Lightning Check/Fold carries and releases on the bet; the table change is one motion

Owner request (Dan, 2026-11-09, Lightning games only), verbatim:

> 1, when you are playing lightning games, the transition to the new table
> needs to smoother, it feels rough and glitchy. 2, when your in the sb or bb
> you should still be able to "fast fold" when you hit the "check/fold" button.
> it should "fold you in that hand" right away, even though the action and
> avatar doesn't change or remove until the action is on you. if you aren't
> folded pre, or on any other street, the "check/fold" stays active for all
> streets until someone bets, or the player reaches showdown. they do not have
> to stay at the table or re select check/fold on any other streets. (this
> applies only to lightning games) 3, find any and all ways to improve this
> further.

Client and engine. No database change, no new request or event, no timer,
watcher or repair path. Classic tables take none of the new branches.

## Check/Fold

### What a player had

- A big blind who armed Check/Fold and was then raised stayed at the table
  until the action came round, although their answer was already known. Only
  the Fold button (shown once a bet is owed) released early.
- The arm was spent by every street: the shared pre-action engine is
  single-shot (Dan 2026-08-28, for every table), so a player checking a hand
  down pressed it again on the flop, the turn and the river.

### Engine (`server/src/lightning/LightningHandHost.ts`)

- `setPreAction('auto_check_fold')` from a player who already owes chips and
  is not on the turn goes through the existing `fast_fold` door: private
  release now, the public fold in turn order, exactly as the Fold button.
- `releasePricedCheckFolds()` runs after every accepted bet, raise or all-in.
  Each player holding an armed Check/Fold who now owes chips is released
  through the existing `requestFold` (the pending-fold path of 2026-10-26).
  The seat about to act is left to its own turn, where the same arm folds it.
  With the operator's fast-fold switch off nothing is released early.
- `runPreAction` arms the same Check/Fold again after its own free check, for
  the same hand and a player still in it. Lightning only: the shared
  `PreActionEngine` is unchanged and still single-shot everywhere else.
- The Lightning block advertises `check_fold_carries: true`.

The rule never asks whether the player is a horse (CLAUDE.md 10.5).

### Client

- `src/lightning/lightningCheckFold.ts`: two pure rules.
  `lightningCheckFoldSurvives` keeps the lit toggle across a street change and
  the hero's own free check, for the hand it was armed in and only against an
  engine that carries the arm, so the bar never claims an arm the engine has
  spent. `lightningCheckFoldReleaseDue` covers an engine that does not carry
  it: the room sends the existing Lightning Fold request the moment a bet
  prices the armed Check/Fold, through the button's own handler.
- `TablePage.tsx` reads them at the street boundary, at the hero's accepted
  action, in the bar's change handler and in the exit hold. When the engine
  folds an armed Check/Fold, the hold shows that fold as a pressed one (cue and
  muck) instead of leaving the cards face up until they vanish.

### Compatibility

| Client | Engine                                                   | Result                                                                                   |
| ------ | -------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| new    | serving engine (`fold_on_turn`, no `check_fold_carries`) | the room releases a priced Check/Fold itself; the arm is still spent per street          |
| new    | new                                                      | the engine releases and carries; the room sends nothing                                  |
| old    | new                                                      | the engine releases and carries; the old bar unlights after a street, the arm still acts |

So the release on a bet does not wait for the engine. Carrying across streets
is new engine behaviour and activates with the engine at its daily window.

## The table change

Read from the code that drew it:

1. A hand played to its end had no exit. Only a fold marked the felt as
   leaving; a finished table sat at full strength and was swapped for the next
   one in one frame. `lightningFeltLeaving` now marks the felt once the hand
   on it is over (the hand-bound completion latch, set after the full award
   hold, CLAUDE.md 10.6) as well as during the fold hold.
2. The exit fade took the whole hold, so a next hand landing inside the hold
   removed the marker mid-fade and half-faded opponents snapped to full
   strength with new faces. The fade is now 0.26 s ease-out inside the 0.5 s
   hold, holds its last frame, and scales with Animation Speed as before.
3. The pot was not in the fade and vanished in one frame at the end of it.
   `.pot-area` fades with the opponents and the board.
4. The new table did not arrive as a table. A player met before who was dealt
   the same chair cut in at full strength while the others faded in one by one,
   the last 400 ms after the first. A Lightning room now passes its hand number
   to `useSeatArrivals` as an epoch: a new table's opponents all arrive, on a
   40 ms ripple capped at 160 ms. An epoch that moves ahead of its roster never
   replays the leaving table. Classic passes no epoch and is unchanged apart
   from the shorter ripple, which only Lightning uses.

## Tests

- Engine, `LightningHandHost.test.ts`: release at arm when priced; release on a
  raise before the turn with chips conserved; carry to showdown with the driver
  never asked for the seat; fold and release on a later-street bet; turn-bound
  with the fast fold off. The old case "a queued priced check/fold stays in the
  hand until its turn" pinned the behaviour this request replaces and was
  rewritten in the same commit. Four of the five fail on the previous source.
- Client: `tests/lightning/lightning-check-fold-carries.test.ts` and
  `tests/lightning/lightning-table-change-is-one-motion.test.tsx` (new; 18
  cases fail on the previous source). Updated because the pinned behaviour was
  deliberately replaced: `lightning-smoother-motion.test.tsx` (the marker rule,
  the fade, the quiet release) and `lightning-seat-arrival.test.tsx` (ripple).

## Not verified here

Nothing was watched on a live table: the motion was reasoned from source and
pinned by tests, not seen. Live proof on a Lightning table is still owed.
