# Five of six live-table fixes from Dan's Lightning seat (2026-11-09)

Dan sent three screenshots from a live PLO4 Lightning table and a finished
heads-up match, with six defects. **Five are fixed here; the sixth - the hero
avatar matching the villains' - is deliberately NOT, and section 4 says why.**
Each section names what he said, what was actually wrong, and where the change
is.

---

## 1. "Stand Up & Leave" stood in the middle of the table

> "the stand up and leave button for lightning games needs to move to the left
> side, not in the middle of the table covering the top villain. And it should
> just say, 'Leave Next Hand'"

The control was rendered into `TableHUD`'s `centerTop` slot, which is the
centre of the HUD's upper row — directly over the top seat, which on a
two-handed table is the only villain there is. It is now the second item in the
upper-left corner, under the hamburger, which is also where Dan put it on
2026-11-08 ("it belongs in the upper left corner below the hamburger menu").

One trap worth recording: that corner's existing contents are wrapped in
`embeddedTableId ? null : (…)`, because an embedded table's hamburger lives in
the tab bar instead. A Lightning table is always embedded, so hanging the leave
control inside that same condition would have removed it from the product
entirely. The corner is now a stack: the menu column keeps its condition, and
the leave control is a sibling that renders either way.

The stack wrapper is `pointer-events: none` with its children `auto`
(`TablePage.css`). `.table-hud__corner > *` makes a corner's direct child
accept input, and this wrapper is as wide as its widest child — a 180px
invisible slab at `z-index: 101` over the seats below it. That is the same
defect `TableHUD.css` records for the upper-right corner and the tournament
bar; it is not repeated here.

The label is now `Leave Next Hand` (`Leaving...` while in flight). **No
behaviour changed with it** — the durable stop already refused every new deal
while the hand in front of the player finished through the original leave
owner. The button now says what it has always done.

## 2. The action buttons were too small on a phone

> "the fold check bet buttons are too small on movile, they should be double
> the current size. we have alot of room on the bottom to increase the sizes."

`--sp-action-btn-h` at `<=480px`: **52px -> 96px**, in the one place a phone's
button height is declared. Not 104: at 100 a villain's name plate comes to rest
on the painted felt at 375px with six seats (measured - 98 clears, 100 does
not). Two screens keep the height they have today, each for its own measured
reason: 375x667, whose nine-seat ring makes the adaptive pass shrink a
villain's revealed cards mid-runout at 80 and whose embedded shell fails from
the other side at 64, and 320x568, which has less room still. `--sp-bottom-row-h`, `--sp-action-reserve`,
`--sp-hud-line` and the felt's height budget are all derived from it, so the
felt, the bottom-left HUD stack and the chat button all give up the same strip
in the same breath; nothing else needed restating, and restating any of it is
how those four numbers drift apart.

`--sp-action-pad-top` is deliberately NOT doubled — it is the gap above the
row, not part of the control, and 12px of dead air over a 104px button reads as
a loose bar rather than a bigger one.

The label and amount type grow with the button (1.25rem / 1rem) at the same
`<=480px` breakpoint that doubled it, not in the 640px block, where the height
is still on the continuous curve and a 1.25rem word would overflow it.

`tests/e2e/support/geometry-baseline.json` is regenerated in the same commit:
btnH 52 -> 96 and feltH down 44px on the phones that took the bigger bar, with
feltW, card2W, card2H, avatar, heroAvatar, seatW and plo4Row identical on all
fifteen devices - which is what says the felt's own proportions are untouched
and only the bottom chrome changed.

## 3. The four table tools were smaller than the hamburger

> "the message button, previous hand, time bank and rabbit hunt buttons should
> all be the same size as the hamburger menu button."

**This was already half done, and that is why it did not look done.** Dan asked
for the same thing on 2026-11-01, and the TILES were moved to
`--sp-tabbar-control` (`TableHUD.css`, 52px at every width). But the painted
frame is not the tile — it is the normalisation in `TableToolIconSizing.css`,
which sizes each raster so its painted button, rather than its `<img>` box,
lands on one square. That declaration stayed on `--sp-game-tool-size`, the 40px
Lobby footprint. So every tool sat in a hamburger-sized box drawing a
hamburger-times-0.77 button.

Measured off Dan's screenshot, which is what sent me to the right file:
hamburger 39px, chat 31px, time bank 30px, previous hand 30px — 0.77 to 0.79 of
it, which is 40/52.

The frame now reads `--sp-table-tool-frame`, defaulting to the same
`--sp-tabbar-control` the hamburger is sized from, so the two cannot disagree
again. `--sp-game-tool-size` keeps its own consumers (the add-chips button, the
seat-change dock) and is no longer what this reads.

The `<img>` box is the frame times the art's gutter scale, so it is ~1.25x the
frame and overflows the 52px tile by about 7px a side. That is transparent
gutter: the tiles are laid out and spaced by their boxes, so the painted frames
still sit 8px apart and nothing clips.

## 4. The hero avatar read as the smallest one at the table - NOT SHIPPED HERE

> "the 'hero' avatar is smaller then all the other avatars at the table, it
> should always be the same size."

This supersedes Dan's 2026-08-15 "HERO avatar should always be 33% bigger than
the villains", and the diagnosis below stands. It is not in this release, and
the reason is worth more than the fix.

**What is actually true, measured.** The slot _is_ 1.3333x, and
`tests/e2e/table-proportions.spec.ts` proves it in a browser on thirteen
devices. `--seat-avatar-size` sizes the seat's FRAME - the wrap, the ring, the
mask, the plate. The painted character is sized from `--seat-avatar-base`
(`SeatKnockout.css` reads it as `--sko-unit`), and the hero never redeclared
that one. So the hero gets a frame a third larger around a bust drawn at
exactly the villain's size, and a character filling 75% of its frame beside
villains filling 100% of theirs reads as the smaller avatar. Measured off the
screenshot: hero bust 46x76, villain bust 45x73 - the same character in a
bigger box.

**Why it is not here.** Setting `--seat-avatar-hero-ratio` to 1 is one token,
and that token is load-bearing for a lattice of hand-measured constants:

- `--sp-hero-clear`, the strip between the felt and the bar, which is sized to
  the hero block and goes 15px slack the moment the block shrinks
  (`the bottom reserve holds the hero block on every phone, with nothing
spare` catches it, and says to lower the reserve in the same commit);
- the short ring's own `--sp-hero-clear`, a literal 64 that has to stay exactly
  four pixels above the base or `6-max stays shorter and centered` reads the
  six-max ring as giving up height nobody asked it to;
- `.seat__cards--hero`, the band the hero's own hole cards are centred in,
  which is half the hero block tall: shrink the block and on a 375x667 screen
  in the embedded shell the band becomes shorter than a two-card row and 6.8px
  of the player's own cards go under the decision row;
- the point at which the adaptive pass starts resizing a villain's revealed
  cards mid-runout.

Each of those was chased to a fix during this PR and each fix moved the next
one. Proof that the hero resize is the common cause: with it reverted and
everything else in place, every one of those beats is green; with it in, they
fail in different places on different devices. It is its own piece of work -
re-derive the reserve, the short-ring offset and the card band FROM the hero's
size rather than from a measurement of the old one - and it does not belong
welded to five fixes that are ready.

## 5. The time bank bled through the open bet slider

> "the action slider menu that pops up when click raise, allows the time bank
> to appear and bleed through."

In his screenshot the stopwatch tile sits squarely on the 33% preset. The
previous-hand card and the chat bubble beside it are both correctly gone, so
`.ca-raising` — the class `ActionPanel` puts on its own `.table-page` ancestor,
and the block in `TablePage.css` that hides this corner — was doing its job.
One element in the list was still painting.

That element is the one with `position: relative` and a `backdrop-filter`
(`TimebankCounter.css`): a stacking context of its own, on a compositor that
does not have to agree with us about an inherited `visibility`.

So the fix is not another rule. `ActionPanel` now reports its raise mode up
through `onRaiseModeChange`, and `TablePage` stops rendering the bottom-left
corner for as long as the overlay is open. A control that does not exist cannot
be composited over the slider, on any engine. Nothing in that corner is usable
while a bet is being sized, so it costs the player nothing.

`.ca-raising` stays exactly as it was — it still hides the chat bubble and dims
the rest, and two mechanisms pointing the same way is belt and braces.

## 6. The heads-up loser was shown the champion card

> "in heads up, the loser received a Champion and prize 38 even though they
> lost."

`announceSpectatorChampion` in `TablePage.tsx` was written for a SPECTATOR: it
reads the committed `position = 1` row and announces who won. It is also the
path a PARTICIPANT takes once the tournament commits, with their own finish
passed in as `participant` — and both called `setTournamentWinner` with the
champion's name, the champion's prize, and **no position**. The overlay's
`position` prop defaults to `1`, so `TournamentWinnerOverlay` printed
"Champion! / 1st Place / <the winner> / Prize: <the winner's prize>" to the
player who had just lost, and then navigated them to the lobby with their own
(correct) result behind it.

Heads-up is where it is unmissable, because the loser is the only other person
it can be shown to. At a 200-runner final it was showing the same thing to
everyone who busted in the money.

The announcement is now chosen by whose result it is:

| who is looking             | what they see                                                      |
| -------------------------- | ------------------------------------------------------------------ |
| spectator / qualifier list | unchanged — the committed champion                                 |
| this player won            | the champion card, with their own prize                            |
| this player cashed         | the overlay's existing paid-finish face, their own place and prize |
| this player lost unpaid    | **no celebration at all**                                          |

The last row matters: the result card waiting in the lobby already tells them
where they finished, and there is nothing here to celebrate, so they leave on
the 2.5s beat a bust takes rather than sitting through a 20-second dwell in
front of somebody else's trophy.

The `qualifiers` branch is untouched. It is only ever set when there is no
champion row at all, and the player it is shown to is a qualifier themselves.

---

## Verified live, 2026-11-09

Merged as squash `490c72a315a000f66575edb6cd53b96e5635da41`.
`publish-club-arena.yml` run `42630046134` terminal-success, and both public
endpoints report that exact revision:

| endpoint                                               | `ca_sha`                                   |
| ------------------------------------------------------ | ------------------------------------------ |
| `https://ca-static.smarter.poker/build-info.json`      | `490c72a315a000f66575edb6cd53b96e5635da41` |
| `https://smarter.poker/hub/club-arena/build-info.json` | `490c72a315a000f66575edb6cd53b96e5635da41` |

### What was read off the published bytes

The published chunks for that revision, fetched from the origin, carry each
fix:

- **1. Lightning leave control.** `Leave Next Hand` is the control's only
  label in `assets/TablePage-DmR4Volk-v6.js`; the old "Stand Up & Leave" string
  is gone. `hud-ul-column--stack` is present in both that chunk and
  `assets/TablePage-B0Di7btR-v6.css`.
- **2. Action buttons.** `assets/ActionPanel-CkGUqL_y-v6.css` declares
  `--sp-action-btn-h: 96px` under `@media(max-width:480px)`, with the two
  recorded exceptions intact: `52px` under
  `@media(max-width:375px) and (max-height:700px) and (orientation:portrait)`
  and `48px` under `@media(max-width:340px) and (orientation:portrait)`. The
  root value is the unchanged `clamp(46px, min(calc(36.5px + 2.545vw), calc(20px + 6vh)), 72px)`.
- **3. Felt tool buttons.** `--sp-table-tool-frame: var(--sp-tabbar-control, 52px)`
  is in the published TablePage stylesheet.
- **5. Raise slider.** `onRaiseModeChange` is in the published TablePage chunk,
  so the bottom-left HUD row unmounts while the bet slider is open.
- **6. Heads-up result.** The published chunk carries the new closeout
  verbatim: `championName` is `void 0` for a qualifier list or a cashing
  non-winner, `position` is spread in only for a cashing non-winner, and the
  lobby hand-off is `goToLobbyWithResult(position, prize, celebrates ? DISPLAY_MS : 2500)`.

### What was read off the running page

In Dan's signed-in Chrome (as `KingFish`), on the live Lightning cash table
`0f84a1ab-5abb-41b4-a8bd-a33af58f73ea` at 775px:

- **3.** `--sp-table-tool-frame` computes to **52px** on both mounted tool
  images (chat, previous hand), equal to the hamburger trigger's measured
  52x52 box. Their `--sp-tool-art-scale` values (1.286 and 1.267) are the
  per-asset alpha corrections that land each painted glyph on that 52px frame,
  which is why the image elements measure 66.9 and 65.9 while the painted
  icons match the hamburger. The time-bank and rabbit-hunt controls mount only
  for a seated player and were not on screen; all four read the same single
  rule, and the CSS Beat harness measures all four at 52px (44px at 320px).
- **1.** The upper-left HUD corner's only child is the new
  `hud-ul-column hud-ul-column--stack`, with `pointer-events: none` on the
  stack and its children re-enabling, and there are **zero** center-top nodes
  on the page: the slot that used to cover the top villain is gone from the
  live bundle. The leave control itself mounts only inside a Lightning pool
  session, which that observation was not in.
- **2.** At 775px the root clamp is in force, as it should be; the 96px bar and
  its two exceptions are phone-width rules, verified in the published
  stylesheet above and measured rendered by the CSS Beat suite.

Fixes 1, 5 and 6 each need a live state no observation can create without
playing for money - a Lightning pool seat, the player's own turn with the
slider open, and a finished heads-up match - so they are certified by the
published bytes above plus their law tests
(`tests/nothing-floats-over-the-open-bet-slider.law.test.ts`,
`tests/a-loser-is-never-told-they-won.law.test.tsx`,
`tests/unit/tournamentChampionCloseout.law.test.ts`,
`tests/lightning/lightning-leave-control.test.tsx`), not by a claim that
someone watched them.

### Item 4

Not in this release. It shipped separately; see
[`2026-11-09-the-hero-avatar-is-never-the-smallest.md`](./2026-11-09-the-hero-avatar-is-never-the-smallest.md).
