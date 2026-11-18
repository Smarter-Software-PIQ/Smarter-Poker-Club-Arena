# 2026-11-18: phone avatars never shrink back again

Dan: "WHY DO ALL THE AVATARS KEEP SHRINKING AND REGRESSING ON MOBILE? ... I KEEP
FIXING IT AND MAKING IT SO THE AVATARS ARE AS LARGE AS THEY CAN BE WITHOUT
OVERLAPPING ANYTHING OR HIDING ANYTHING, AND THEN IT KEEPS REGRESSING BACK TO THE
SMALLER VERSIONS ... FOR BOTH 6 MAX AND FULL RING GAMES."

Between 2026-11-12 and 11-16 the phone portraits were enlarged and then shrunk
again more than a dozen times. No single change was the cause. Four separate
mechanisms each shrank the portraits, and none of the checks could see any of
them.

## Root causes, and how each one is closed

1. **A device size record that could only shrink.** Since #10718 every table
   wrote its fitted portrait height to `localStorage`
   (`sp-mobile-avatar-size-v1/v2/v3`). Every later table of that game type on
   that phone was capped at the stored height, and the value could only go
   down. One crowded fit (wagers on the felt, the puck beside a chair, a
   six-card fan, a photo hero) shrank that game type on that phone for good.
   No deploy could undo it; only bumping the key name could, which is what
   #10725 and #10769 did, and each time the record shrank again.
   _Fixed:_ nothing about portrait size is stored on the device. The retired
   keys are deleted on load, so a phone that had ratcheted down recovers on its
   next visit.

2. **The full-ring rail size could only be multiplied down.**
   `--sp-nine-rail-bust` (#10798) was one value for the whole ring. Every
   layout pass started from its own last value and multiplied it by a factor
   capped at 1. One portrait too wide for the rail beside the board shrank all
   nine chairs, and nothing ever grew them back until the table remounted.
   _Fixed:_ every chair takes the approved rail size. A too-wide portrait limits
   only its own chair (`--sp-seat-rail-bust`), computed from that portrait and
   the table geometry alone, and clears when that player leaves.

3. **The locked size was chosen from a moment of play.** The size is locked at
   the first fit (#10694, #10696). That fit read the wagers on the felt, the
   chair the puck happened to sit beside, and any hand tabled at showdown, so a
   table opened mid-hand stayed smaller for the whole session. #10718's own
   description shows one table settling at 1.45x on one visit and 1.2x on the
   next.
   _Fixed:_ wagers and the puck's current chair are not size inputs. The marker
   solver already keeps every wager clear of the portrait and in front of its
   own player. The dealer-button readability check now tests every chair's
   reserved button spot, and the first fit waits until no hand is tabled.

4. **Six-max tournaments were never enlarged.** `mobileProfileKey` gave them a
   key with no profile, an exclusion carried over from the first rollout
   (#10610). #11077 fixed it for full ring only.
   _Fixed:_ tournaments take the same phone profile as cash at both sizes.

## Why every shrink passed CI

- The browser checks asserted only "zoom times bust scale > 1". The CSS base
  alone (2.1, or 1.7 for full ring) is already above 1, so even a total loss of
  the enlargement passed.
- The browser checks cleared the device size record before every case, so the
  ratchet never ran in CI.
- No test read the CSS base sizes. #10796 lowered full ring from 2.1 to 1.7 as a
  side effect of a position fix, and nothing noticed.

_Fixed:_ `src/components/table/mobileAvatarSize.ts` holds the approved sizes:
the six-seat bust scale, the full-ring rail bust, and the minimum rendered
heights. `tests/mobile-avatars-never-ratchet-smaller.law.test.ts` pins five
things:

- SeatSlot.css draws exactly those values.
- None of them may be lowered.
- No portrait size is stored on the device.
- The rail cannot ratchet, and the locked size has no transient inputs.
- Tournaments are included.

The browser cases now assert absolute rendered heights instead of "bigger than
1x". If a future feature needs room, it has to make room around the portrait. It
can no longer shrink the portrait without failing CI.
