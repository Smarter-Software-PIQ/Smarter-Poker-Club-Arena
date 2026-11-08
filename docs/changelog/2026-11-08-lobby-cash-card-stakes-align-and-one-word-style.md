# 2026-11-08: Cash lobby card - Stakes lines up with Players, one-word styles fill the bay, Lightning rules move under the title

Dan's three rulings on the cash lobby card (screenshots of the live lobby):

1. "STAKES SHOULD BE AT THE SAME HEIGHT AS 'PLAYERS' NEXT TO IT AND BOTH THE
   LETTERS AND NUMBERS SHOULD BE LINED UP THE SAME."
2. "IF ITS JUST 'CLASSIC' CLASSIC SHOULD FIT IN THAT WHOLE SPACE. THE CURRENT
   FONT IS TOO SMALL."
3. "FOR 'LIGHTNING GAMES' PUT JUST 'LIGHTNING' (LIKE CLASSIC IS) BUT THEN PUT
   UNDER THE TITLE ... THE SECOND LINE SHOULD SAY 'BIG BLIND ANTE - 40% MIN
   VPIP'."

## Causes

1. The Stakes cell carried its own `padding-bottom: 1cqw` while Players kept
   the bay's 2.2cqw, so the whole Stakes stack sat lower. A fitted stake
   ("0.25/0.50") also shrank its line box, which moved the label again.
2. A one-line style printed at the 2.6cqw multi-line size.
3. The style bay printed the template label "Lightning Games" plus both rule
   lines.

## Changes

- `PremiumMttRows.css`: Stakes uses the same padding as Players; the stakes
  zone keeps the full-size value line box and centres the fitted value in it.
  A single-line style (`premium-cash-style--single`) prints at the value size
  (4.6cqw) and the existing fitter shrinks it only to the glass width.
- `LobbyTable.tsx`: a Lightning card's style bay prints "Lightning"; its rules
  print as the second title line ("Big Blind Ante - 40% Min VPIP") in the
  existing heading format slot. The menu label "Lightning Games" is unchanged.

## Proof

Headless render at 393px and 533px: Stakes and Players label tops and value
midlines are identical on every row (were 2.3-4.6px apart). "Classic" went from
13.9px to 24.5px at 533px. Unit tests, the lobby browser spec (164) and the
type check pass. Pinned by
`tests/unit/lobbyCashCardStakesAlignAndOneWordStyle.test.ts` and
`tests/unit/actionAndMadnessSayWhatTheyChange.test.tsx`.
