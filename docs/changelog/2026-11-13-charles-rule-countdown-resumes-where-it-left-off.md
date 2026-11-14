# The Charles Rule countdown resumes where it left off

Owner direction, 2026-11-13 23:04 America/Chicago: "IF YOU GO INTO PROFIT, AND
YOUR 10 HANDS STARTS... THEN YOU FALL BELOW PROFIT AT LETS SAY THE 7 HANDS LEFT
MARK... BUT THEN GO BACK INTO PROFIT. IT NEEDS TO PICK BACK UP WHERE YOU LEFT
OFF AT THE 7 HANDS, NOT RESTART THE 10 BACK OVER."

This supersedes the 2026-11-06 line "coming back into profit starts the
ten-hand clock again".

## The cause

`fn_cash_session_evaluate` advances the count once per dealt hand. On a hand
that ended at or below the session baseline it reset the whole countdown
(`hr_hands_required`, `hr_hands_played`, `hr_doubles` to 0), so the next hand in
profit started a fresh ten.

## The fix

Migration `20261114050737_charles_rule_countdown_resumes_where_it_left_off.sql`
changes that one branch (function image only, md5-guarded against the image
production held, whose body was confirmed byte-identical to
`20261111174148`):

- Losing the profit pauses the countdown. The hands played and the hands added
  by doubles are kept; a NULL `hr_reference_stack` marks the pause.
- Out of profit nothing is owed and the player may leave at any point, as
  before. Hands played out of profit never count.
- Back in profit the count picks up where it stopped. The hand that returns
  the player to profit is not counted (the same as the hand that first starts
  a countdown), so 7 left comes back as 7 left.
- The reference stack for the next double is the stack at the return to
  profit; `hr_started_at` is re-stamped there, so a leave asked for while out
  of profit is still honoured.
- A completed count, the club's switch, the +250 BB obligation, the
  house-take double test and bank-the-win state are unchanged.

No engine or client change: the engine's mirror (`ChipContinuity.ts`) and the
seat count already read required minus played only while in profit, and the
"You Are In Profit. Play 10 Hands" toast only fires when the owed count equals
the total, so a resumed count is shown without a second announcement.

Sessions open at install: a countdown the old branch had already cleared
starts normally at its next hand in profit. Nothing is back-filled; no money
moves.

Pinned by `tests/unit/charlesRuleBigWin.pg.test.ts` ("the countdown resumes
where it left off"), which installs both migrations on real PostgreSQL: pause
at seven and return to seven, doubles kept across the pause, repeated pauses,
and a leave asked for while out of profit.
