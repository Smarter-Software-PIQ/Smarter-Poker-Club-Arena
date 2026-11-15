# 2026-11-15: the menu switches read the gates, and the rest of the menu list

Third delivery on the table menu, after
`2026-11-14-a-menu-switch-answers-the-press.md` and
`2026-11-14-the-table-has-one-menu.md`. Dan: "GO AHEAD AND FULLY BUILD, FIX AND
ENHANCE ALL OF THESE". Nine improvements were listed; all nine are here, plus a
regression the first delivery caused in a post-deploy certificate.

## A regression of #10924, found while writing the browser proof

`tests/e2e/support/mobileLiveTableLayout.ts` (run after every publish, at a
real table) pressed the hamburger again after each Seat Change press, because
every row used to close the menu. With switches leaving the menu open, that
second press closed it and the read of the switch found nothing. It now reads
the switch in the open menu, where the player sees it.

## The nine

1. **A spectator is offered no seat-only row.** TablePage reports
   `heroSeated`; `false` drops Sit Out, Stand Up Next Big Blind, Straddle, Top
   Up / Rebuy, Add-On, Auto Top Up and Leave Table Next Hand. Absent keeps
   them. Leave Table stays.
2. **One source of truth for Sounds and Vibrations.** New
   `src/hooks/useSoundSwitches.ts`: `useSoundSwitch` / `useVibrationSwitch`
   subscribe to the two gates and return what they hold. `useTableSound` keeps
   no state of its own any more, and the tab bar's badges read the same hooks.
   `soundGate` now fires `ca:sound-preference` when written, as the vibration
   gate already did.
3. **Nothing at the table reads the Settings page cache.** TablePage's
   `SETTINGS_UPDATED` listener is deleted. The Settings page reaches the table
   through `useTableSettings` in both directions.
4. **Session Stats is not offered at a tournament.** It opens the cash session
   ledger. The unrendered menu withheld it there; the rule was lost with it.
5. **Straddle waits while a change is in flight** (`straddleBusy`, reported).
6. **Every switch is announced as a checkbox with its state**
   (`menuitemcheckbox` + `aria-checked`), not only Auto Time Bank and Seat
   Change.
7. **The deleted lobby button's styles are gone**, six rules in
   `TablePage.css`, and `e2e-live/multitable-walk.mjs` no longer looks for it.
8. **The pre-push hook runs the two censuses of the test tree** (the law
   registry and the source-window rule) when a test changes. Both failed first
   in hosted CI on the two earlier deliveries.
9. **One subscription answers the menu.** TablePage had two
   `TABLE_MENU_ACTION` subscriptions 9,000 lines apart with different guards.

## Browser proof

The post-deploy live-table certificate now also flips Sounds on and back in the
open menu and opens and closes Game Rules from it, at a real table, on every
publish.

Client only. No engine, schema or financial path is touched.
