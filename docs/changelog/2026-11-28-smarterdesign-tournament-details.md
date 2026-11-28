# 2026-11-28 - The routed tournament page wears the #SmarterDesign mast (batch T1)

Dan, 2026-11-27: every page, sub page and button gets the #SmarterDesign
upgrade. The tournament lobby's bands already wore the workspace art
(`2026-11-27-tournament-lobby-smarterdesign.md`); the inventory still graded
`/tournaments/:id` as partial: no workspace mast, and the club join step was
the painted spade console.

## What changed

- `TournamentDetails.tsx`: on the route only (never the in-game popup or the
  lobby tab, which keep the event band alone under Dan's 2026-10-04 ruling),
  the states with no event band open on `ArenaWorkspaceHeader` ("Tournament
  Lobby", the chrome "?"): loading, a failed read, Tournament Not Found and
  the club join step. It is one slim 56px row there, hidden at 760px tall or
  less.
- The ready lobby carries no mast (lead review of the renders): its event band
  already heads the page, a mast there said it twice, added a second h1 and
  took about 66px from the tab panel, the band #12341 had to win back. With
  it gone the Details panel is back to its old height: 373px at 393x852 and
  249px at 1280x900 (harness, measured before and after).
- Tournament Not Found and loading are one chrome case (`arena-case
arena-ops-case`) with an `arena-section-title`; Back To Clubs is a lit
  chrome key.
- `TournamentClubJoinGate`: the painted `SpadeConsole` became a chrome case:
  the eyebrow, the title with the Invite note, the copy, Back To Clubs and the
  lit Join Club & Open Tournament. Same words, same order, same handlers.
- The two recovery notices (a failed read, a game that is gone) are chrome
  ledger rows with their action a chrome key.
- Dress in `src/pages/tournament/TournamentDetailsArena.css` and
  `TournamentClubJoinGate.css`, every rule under the page root. No hover, no
  new art, colour or radius.
- Render harness: tournament fixtures (registering, late registration,
  finished, not found) and `.eq()` on the tournament tables.

## Pins

`tests/components/tournamentDetailsPageIsPinned.test.tsx` was recorded on
main 9c60702dc before any change and is unchanged: every figure, word, named
region and control in the registering, registered, late registration,
seated, eliminated, finished, not found, join step, failed, loading and popup
states. `tests/unit/tournamentDetailsArenaDressIsScoped.test.ts` holds the
mast, the scoping and the short-screen rule.
