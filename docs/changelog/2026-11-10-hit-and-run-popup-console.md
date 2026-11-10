# Hit And Run Leave Confirmation Moves Onto The Console

Owner, 2026-11-10, with a screenshot of the "Your Hand Count Is Not Completed"
popup: "upgrade this pop up notification to look like the others, its blocking
the whole screen, and is not smarter.poker look and feel."

## What changed

- `src/components/table/HitRunLeaveConfirm.tsx` renders on the riveted console
  (`SpadeConsole family="riveted"`), the family the Time Bank popup uses. The
  owner's sentence is engraved in the header well, the hands still owed print
  in red ink on the glass with their words beneath, and the two answers are the
  painted plates: Leave in red ink on the steel plate, Stay And Play on the blue
  glass. Nothing is drawn.
- The backdrop was an opaque gradient over the whole screen. It is now a 62%
  black scrim, so the table stays in view behind the question.
- Copy, Title Case, the alertdialog role, the portal to `<body>`, Escape to
  stay, focus on Stay And Play, and the single-flight Leave guard are
  unchanged. `tests/hit-and-run-leave-confirm.law.test.tsx` now pins the
  translucent scrim and the console in place of "fully opaque".

## Renders, 393px

`docs/changelog/2026-11-10-hit-and-run-popup-console/`: `before-6-393.jpg`,
`after-6-393.jpg`, `after-1-393.jpg` (singular), `after-30-leave-393.jpg`
(two-digit count, Leave pressed and in flight). Measured in the render: the
title fills its zone without crossing it, both plate labels fit their faces,
Stay And Play takes focus.
