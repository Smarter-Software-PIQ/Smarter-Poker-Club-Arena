# 2026-11-14: a table menu switch answers the press

Dan, with a screenshot of the multi-table hamburger showing Sounds OFF:
"THE SOUNDS BUTTON AND ANY OTHER BUTTONS YOU CLICK, SILENTLY FAIL, IT JUST
BRINGS YOU BACK TO THE PLAYING PAGE."

The press was not lost. It reached the table and changed the setting. Nothing
the player could see said so, and in two cases the change was then undone.

## What was wrong

1. **Two badges read fields nobody wrote.** `TableTabBar` took the Sounds and
   Vibrations badges from `soundEnabled` / `vibrationsEnabled` on the active
   tab. `TabInfo` declared both; no table page ever reported either, and
   `MultiTablePage` never carried them. Both badges said OFF forever. Stand Up
   Next Big Blind read a third unreported field, `standUpNextBB`, so its badge
   never appeared.
2. **Every row closed the menu.** `handleActionClick` called `onClose()` after
   every action, switches included. Press Sounds, land on the felt, reopen the
   menu, read OFF.
3. **A cached copy could mute the table again.** TablePage's `SETTINGS_UPDATED`
   listener muted on any payload carrying `soundEnabled: false`. The account
   sync and the theme mirror both send the Settings page's cached copy under
   that event, and that copy is only refreshed when the Settings page is open.
   A player who once muted in Settings and later turned Sounds on at the table
   was muted again by the next sync.
4. **A second window pressed the switch again.** `TABLE_MENU_ACTION` was
   broadcast to other windows. One holding the same table flipped the setting
   from its own reading and wrote the shared sound keys back.
5. **A repeated press could be dropped.** The bus drops an event whose payload
   repeats inside 500ms, and a menu press has the same payload every time.

## What changed

- Sounds and Vibrations badges read `useTableSettings`, the store the two
  toggles commit to. Sound and haptics are one account setting, so there is
  nothing for a tab to report; the dead `TabInfo` fields are removed.
- TablePage reports `standUpNextBB` the way it reports `isAutoRebuyEnabled`,
  and `MultiTablePage` carries it to the tab.
- `MenuAction.keepOpen` marks an ON/OFF row. Those rows leave the menu open so
  the badge changes in front of the player: Stand Up Next Big Blind, Auto Top
  Up, Sounds, Vibrations, Multi Table Profit Tracking, Social Name, Auto Time
  Bank, Seat Change. Rows that open something still close the menu. Stand Up
  Next Big Blind and Auto Top Up now say OFF when off.
- Only the Settings page's own save (`source: 'settings-page'`) may mute a
  table through `SETTINGS_UPDATED`.
- `TABLE_MENU_ACTION` is never deduplicated and never replayed in another
  window.

## Regression cover

`tests/unit/tableMenuSwitchesAnswer.test.tsx` renders the real tab bar and
menu; `tests/unit/tableMenuPressIsATap.test.ts` runs the real bus. Eleven of
their fifteen cases fail on the previous source.
`tests/unit/aStaleSettingsSyncNeverUnmutes.test.ts` is narrowed to the new
condition.

Client only. No engine, schema or financial path is touched.
