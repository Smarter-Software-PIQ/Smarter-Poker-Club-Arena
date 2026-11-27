# Player Management cards: portrait in the upper left corner, double size

Dan, 2026-11-27: "THE PROFILE IMAGE OR AVATAR SHOULD ALWAYS BE IN THE UPPER LEFT
HAND CORNER, AND IT SHOULD BE DOUBLE THE SIZE, WITH THE NAME AND OTHER INFO
BELOW IT, NOT IN THE MIDDLE WITH THIS WEIRD GAPS."

## Cause

`ArenaWorkspace.css` placed the portrait as its own vertically centred grid
column beside the text, then four width-specific rules (720px, 480px, 400px
and an unconditional selection rule) re-placed the parts again. Above 400px the
portrait floated to the middle of a 180px card with the name centred above an
empty band and the checkbox parked at the bottom left; at 400px and below a
different arrangement took over. Same card, two layouts, both with gaps.

## Fix

One block places every part of a card at every width: the left column stacks
the portrait (pinned top left, `clamp(64px, 12vw, 92px)`, double the old
`clamp(32px, 6vw, 46px)`), then name and upline, then role, PlayerID and
status. The figures keep the right column, the chevron the far edge, and the
selection box sits beside the portrait in the top band. The old per-width
placement rules are deleted, not overridden. Narrow phones (400px and below,
340px and below) only narrow the figures column and the name type so long
names stay on one line.

## Pinned

`tests/e2e/css/club-members-containment.spec.ts`: every row at 320-1440px, both
stylesheet orders, now asserts the name sits below the portrait, the portrait
is in the upper left corner, and it is at least 64px square (it previously
asserted the portrait sat to the LEFT of the name, the layout Dan rejected).

## The saved avatar, exactly

Dan, the same day: "MAKE SURE IT IS USING THE ACTUAL USERS SAVED AVATAR OR
IMAGE EXACTLY." The card read the right column (`ca_club_roster_rows` returns
`arena_avatar_url`, then `avatar_url`), but drew it through
`sizedStorageUrl(url, 64)`: an upload came back as a 128px crop, blurred at the
new 92px portrait, and library art skipped the art revision the table seat
asks for, so a cached older drawing could show. The card now resolves the
saved avatar through `getAvatarWithFallback`, the resolver the table seat
uses, sized to the portrait (`MEMBER_PORTRAIT_PX = 92`, fetched at 2x). With
nothing saved it draws the same generated portrait the seat draws.
`tests/unit/aPlayerCardShowsTheSavedAvatar.test.ts` pins it.

Measured in production while checking: 48 profiles hold a generated initials
SVG as their saved Club Arena avatar. It is what Complete Profile saves when a
player enters without choosing one, and the card shows it because it IS their
saved avatar. It is left as saved: clearing it would put those players back in
front of the Complete Profile gate.
