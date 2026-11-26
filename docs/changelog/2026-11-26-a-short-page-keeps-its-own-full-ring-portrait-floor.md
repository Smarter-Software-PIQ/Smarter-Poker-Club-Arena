# 2026-11-26: A Short Page Keeps Its Own Full-Ring Portrait Floor

## What Was Red

`post-deploy-e2e.yml`, job "Live-table and engine verification", failed after
most engine seals from about 2026-11-20 with:

```
below the approved size: 1:132.1<140.0 2:132.1<140.0 ... 8:132.1<140.0
```

It failed in one test only, "an already-running table stays live and recovers
one owner after a network loss", and only when the running table it found was
a full ring. When it found a six-max table the job passed (runs 45625671821,
45679382609, 45696756863).

## Root Cause

Nothing shrank the portraits. The check asked a short page for a size that
was measured on a taller one.

1. A full-ring portrait is a fixed share of the felt. The chair slot is
   `--seat-avatar-full: clamp(50px, calc(var(--table-w) * 0.158), 124px)`
   (`SeatSlot.css`), and the phone rail bust is 1.7 times the slot
   (`NINE_SEAT_PHONE_RAIL_BUST`).
2. The full-ring phone felt is `width: min(88%, calc(var(--sp-table-h) * 0.725))`
   (`TablePage.css`, the `[data-seats='9'] .table-scaler` rule). It is 528
   layout px wide only where the page leaves it 728 layout px of height. On a
   shorter page the felt follows the height, and everything on it is smaller by
   the same share.
3. `PHONE_AVATAR_MIN_HEIGHT_PX.nineSeatOpponent = 140` was measured on the
   320x568 phone, which is 1065 layout px tall at the 600px phone layout.
4. The failing test does not run on one of the four physical phone sizes. It
   keeps the Playwright `iPhone 13` profile of the `webkit-live-table-realtime`
   project, whose viewport is 390x664 with the browser bars showing. That is
   1021 layout px tall, shorter than the phone the floor was measured on.

Measured on production by the job itself (WebKit, layout px; chairs with no
limit of their own, which is every chair whose art is not too wide for the rail):

| Page Height (Layout Px) | Device                     | Full-Ring Opponent |
| ----------------------- | -------------------------- | ------------------ |
| 1021                    | iPhone 13 profile, 390x664 | 132.1              |
| 1065                    | 320x568                    | 140.0              |
| 1188                    | 430x852                    | 141.8              |
| 1300                    | 393x852                    | 141.8              |
| 1363                    | 375x852                    | 141.8              |

The same pages paint a watched six-max table at 176.6, 187.0 and 191.9, which
is the case `SPECTATOR_PHONE_MIN_LAYOUT_HEIGHT_PX` settled on 2026-11-19.

Reproduced in the real-component fixture with Chrome (2026-11-26). The fixture
carries less page chrome than production, so the felt binds at a lower page
height there:

| Fixture Page Height | Felt Width | Full-Ring Opponent | Rail Bust | Chairs With Their Own Limit |
| ------------------- | ---------- | ------------------ | --------- | --------------------------- |
| 1065                | 528.0      | 141.8              | 1.7       | 0                           |
| 972                 | 523.3      | 140.5              | 1.7       | 0                           |
| 932                 | 495.9      | 133.2              | 1.7       | 0                           |

The portrait height divided by the felt width is 0.2686 in every row. The
rail bust stayed 1.7, no chair carried `--sp-seat-rail-bust`, and
`--sp-mobile-art-scale` stayed 1. None of the four mechanisms of 2026-11-18 is
involved: no stored size, no ring-wide value, no input from a moment of play,
no relative test.

## The Fix

The same shape as the watched six-max precedent, and no portrait is smaller
anywhere.

- `src/components/table/mobileAvatarSize.ts`: new
  `NINE_SEAT_PHONE_MIN_LAYOUT_HEIGHT_PX = 1060` and
  `PHONE_AVATAR_MIN_HEIGHT_PX.nineSeatOpponentHeightBound = 132`. The existing
  numbers are unchanged: 140 for the 320x568 phone and every taller one, 187
  for the hero, 1.7 for the rail bust.
- `tests/e2e/support/mobileLiveTableLayout.ts`: a full-ring opponent on a page
  shorter than 1060 layout px is held to 132. Every other portrait is held to
  the floor it had.
- `tests/e2e/support/mobileAvatarSizingCases.ts` and
  `observerAvatarSizingCases.ts`: a new fixture case mounts a watched full
  ring on a height-bound felt and asserts that the felt is height-bound, the
  rail bust is 1.7 on every chair, no chair is limited, the portraits reach
  132, and the portrait is the same share of the felt as on a tall phone. It
  then runs every containment and locked-size check the other cases run.
- `SeatSlot.css` and `TablePage.css` are not changed. No size on screen moves.

The hero floor has no height-bound value. The live proof never seats a hero,
so there is no production measurement of a seated full-ring hero below 1065
layout px, and this change does not invent one.

## What Stops It Returning

`tests/a-short-phone-keeps-an-absolute-avatar-floor.law.test.ts` now pins:

- the felt rule and the slot rule that make a portrait a share of the felt;
- that the witness project still uses the `iPhone 13` profile, that its
  viewport is in the height-bound class, and that the four physical phone
  sizes are not;
- that 140, 132 and 187 are never lowered
  (`tests/mobile-avatars-never-ratchet-smaller.law.test.ts` pins 132 too);
- the exact branch in the live proof, and that the height-bound floor is used
  in one place only;
- that the fixture keeps its height-bound case.

If the witness moves to another device, or the felt rule changes, the law
fails and names which one.

## What Was Verified, And What Was Not

Verified here: the five full-ring and five six-max fixed-artwork fixture cases
in Chrome (all pass, the new case included; before the change the new case
fails with `133.2<140.0` on all nine chairs), the two avatar laws, the law
registry, the three unit files that read the touched helpers, `tsc --noEmit`
and Prettier.

Not verified here: the live proof itself. It needs production, WebKit and the
spectator account, and runs only after an engine seal. The 132.1 it will meet
is taken from its own logs, not from a run of this branch.
