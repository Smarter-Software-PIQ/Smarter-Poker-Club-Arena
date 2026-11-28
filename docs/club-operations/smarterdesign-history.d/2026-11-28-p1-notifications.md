## Batch P1: Notifications (player pages)

| #   | Surface       | File                              | What changed                                                                                                                                                                                                                                                                                                                 |
| --- | ------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Notifications | `src/pages/NotificationsPage.tsx` | Arena workspace root and mast (the page's own heading and description); filter and action keys on chrome switches with Mark All Read lit; day headings as section titles; every signal a chrome row; Push banner dressed in a scoped sheet. Words and counts pinned (`tests/components/notificationsPageIsPinned.test.tsx`). |

Rakeback, Session History and Transaction History were skipped: #12313 touches the first two, and `tests/unit/cinematicRouteFamilies.test.ts` binds all three to the Rewards Circuit / Play & Review masters.
