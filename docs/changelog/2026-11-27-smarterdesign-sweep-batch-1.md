# #SmarterDesign sweep, batch 1: Applicants, Club Rules, Announcements

Dan, 2026-11-27: the painted console frames are "the old style"; pages use
#SmarterDesign, the arena workspace language Player Management, the Cashier
and Club Operations already wear.

- `docs/club-operations/SMARTERDESIGN-INVENTORY.md`: every routed page still
  on the old flat look or on the painted console, ranked by traffic and how
  cheaply it converts, with batch 2 recommended.
- Applicants (`ClubApplicantsPage`): plain cyan text links on black became the
  chrome mast (title and help summary unchanged), Back To Players and Refresh
  Applicants as chrome keys, the queue in a chrome case, each applicant a
  chrome ledger row with Decline / Approve keys, Approve lit.
- Club Rules (`ClubRulesPage`) and Announcements (`ClubAnnouncementsPage`): the
  painted spade console became the thin chrome case through `ClubPageSection`
  with `arena` (the route #12262 took for Reports and Hand Review). Copy /
  Edit Rules, Cancel / Save Rules, Refresh / New Post and Cancel / Post are one
  chrome switch with the primary lit; each post is a chrome row and Pin /
  Delete are chrome keys; the editor and composer fields are dark wells.

Markup and CSS only. Every handler, guard, string, role and aria label is
unchanged; the `/* THE CONSOLE` marker that
`tests/unit/clubOperationsReadAndSaveFailures.test.ts` reads is kept.
Renders: before and after at 393px and 1440px, plus the editor, composer,
member and empty states.
