# The Help Center and the legal documents wear #SmarterDesign

2026-11-28, #SmarterDesign player pages batch P2.

## What changed

- **Help Center** (`/help`, `src/pages/HelpPage.tsx`, `HelpPage.module.css`):
  the page root carries `arena-workspace`. The illustrated mast (`area="reports"`)
  carries the title as the page's h1 and the chrome "?", with the existing
  summary behind it; the page bar under it holds only the two support actions,
  now chrome keys with Send Support Request lit. The live platform check sits
  in a chrome case (SystemStatus keeps its own sheet; the page dresses it only
  inside its status case). The four common destinations and the three policy
  links are chrome keys. Frequently Asked Questions is a case with its title
  over the hairline, the search field in the dark well, and one ledger row per
  question; answers read at a 68ch measure.
- **Help Center prerender** (`src/prerender/HelpPrerender.tsx`): prints the
  same mast and the same classes, so a reader without JavaScript gets the same
  page.
- **Terms Of Service, Privacy Policy, Fair Gaming Policy, Promotion Rules**
  (`/legal/*`): all four print through `src/components/legal/LegalDocumentLayout.tsx`,
  so one change dresses all four. The breadcrumb back to the Legal Center sits
  above the mast (`area="handreview"`, the public dossier scene); the section
  index is a chrome case of ledger rows (a scrolling row of chips on a phone,
  sticky on a desk); the document is one chrome case with each section under
  an arena section title; the prose is set at 16px (15px on a phone), a 70ch
  measure and the body ink (the app's global `p` grey no longer dims it); the
  four documents are chrome keys with the open one lit by its `aria-current`.

## What did not change

CSS and markup only. No word of legal text, no handler, guard, hook, role,
aria attribute, href or data hook. The hidden page-bar h1 became the mast's
h1 with the same text and id. Pinned first, against the old pages on main
`a3873e77f`: `tests/components/helpAndLegalPagesArePinned.test.tsx` records
every heading, printed word, named region, control and link of the five pages,
in the app and as prerendered, and is unchanged by the pass.
`tests/unit/supportTrustWorkspace.test.tsx` now finds the h1 in the mast and
exactly one "Page Help" control.

`tests/unit/helpAndLegalArenaDressIsScoped.test.ts` keeps the arena roots and
the shared mast, keeps the SystemStatus dress inside the Help page's status
case, keeps the legal layout to the four documents, and walks the import graph
from each prerendered page to prove it never reaches the Supabase client, the
auth hook or the club workspace context.

## Not done

The Legal Center (`/legal`) has no page module of its own:
`LegalWorkspacePage` lives in `src/pages/workspaces/ArenaWorkspacePages.tsx`
with Play, Rewards and Community, and `ArenaWorkspaceHeader` has no legal area.
It was left for a later batch.
