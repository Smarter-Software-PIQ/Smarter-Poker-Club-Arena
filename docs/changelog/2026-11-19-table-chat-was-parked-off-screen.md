# Table Chat Was Parked Off Screen

Reported by player nevin on 2026-11-19: he could not chat at a live table.

## What players saw

Tapping Chat opened nothing usable. The sheet was rendered, open and enabled, but its
computed transform was `translateX(350px)`: the whole panel sat one panel-width past the
right edge of the screen, so there was no input to type into. Measured live on
2026-11-19 at 21:35 Chicago (`.table-chat` rect left = viewport width,
`animation-name: chatSlideUp`, `transform: matrix(1,0,0,1,350,0)`).

## Evidence

- `table_chat` rows with `message_type = 'player'`: 8 from humans on Nov 16 (UTC), then
  zero on Nov 17, 18, 19 and 20, while horses (engine inserts) wrote 2,392.
- Edge logs: browser POSTs to `/rest/v1/table_chat` returned 201 until
  2026-11-16 04:21:41 UTC (22:21 Chicago Nov 15). After that, not one browser POST.
  Browsers kept calling `fn_table_chat_is_silenced`, so the hook mounted; the send was
  simply never reachable.
- Not a mute, ban or restriction: nevin has no `table_chat_mutes`, no
  `ca_player_restrictions`, and every table he sat at has `ban_chat = false`.

## Root cause

Two stylesheets styled the same element. `src/pages/TablePage.css` kept an April 2026
side-panel rule for `.table-chat` whose resting state was `transform: translateX(100%)`,
brought on screen only by `animation: slideInChat 0.3s forwards`.
`src/components/table/TableChat.css` (the component's own sheet, August 27) declares
`animation: chatSlideUp` on the same selector at the same specificity. The winner was
whichever file the bundle emitted last. #11049 (merged 22:39 Chicago, Nov 15) added
`import '../../pages/TablePage.css'` to `SharedTableStage`, which moved TablePage.css
ahead of TableChat.css. chatSlideUp won, `forwards` was gone, and the resting
`translateX(100%)` applied.

## Fix

The April rule and its `slideInChat` keyframes are deleted. TableChat.css is the single
owner of the sheet: the bottom sheet its own tests already specify (75dvh, grab handle,
backdrop tap to close), on screen at rest with or without its animation.

## So it cannot come back

`tests/table-chat-has-one-stylesheet.law.test.ts`:

1. fails if any stylesheet other than TableChat.css targets `.table-chat` (the popup
   chassis may paint it inside its zero-specificity `:where()`, never position or move it);
2. fails if any `.table-chat` rule translates the sheet at rest or depends on
   `animation-fill-mode`, and if its entry keyframes do not end in place.

Verified the first pin fails against the pre-fix TablePage.css.
