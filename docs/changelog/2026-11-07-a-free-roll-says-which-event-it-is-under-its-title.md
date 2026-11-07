# A Free Roll Says Which Event It Is, Under Its Title

Dan, 2026-11-07, with a screenshot of the Midday Free Buy card: "THE FREE
ROLLS STIL DO NOT SAY WHAT KIND OF FREE ROLL THEY ARE UNDERNEATH THEM. LIKE
THIS ONE SHOULD SAY, 'PROGRESSIVE KNOCKOUT' OTHER ONES SHOULD SAY, 'MYSTERY
BOUNTY' OR 'ALL IN OR FOLD' ETC. ADD THE SECONDARY TITLE UNDER THE MAIN TITLE
FOR THE NAME OF THE TOURNAMENT THE FREE ROLL IS RUNNING." It restates his
2026-11-06 ruling that every Free Buy card must say which Free Buy event it
is, for all freerolls every day.

## What changed

Every freeroll (Free Buy) heading card on the lobby board - the premium
chassis board and the compact board both render `TournamentHeadingRow` - now
prints a second title in house blue directly under the event name:

- Progressive Knockout, Mystery Bounty or Bounty, from the same recorded
  bounty flags that pick the card's format badge (most specific first, one
  member of the family);
- Satellite, when the event feeds another;
- All In Or Fold, from `tournaments.all_in_or_fold` (now declared on
  `LobbyTournamentRow`);
- the clock tier (Hyper / Turbo / Slow / Deepstack) from the recorded
  structure medallions;
- and a plain freeroll says "Rebuy & Add-On" rather than nothing, because by
  the Free Buy law (utils/freeBuy.ts) every freeroll sells 1-chip rebuys and
  add-ons.

Multiple facts join with a middle dot ("Progressive Knockout · All In Or
Fold"). A paid tournament prints no second title from this rule.

## Where

- `src/components/lobby/LobbyTable.tsx` - `freeBuyKindLabel(entry)` (exported)
  beside `tournamentSignals`, and the render in `TournamentHeadingRow` inside
  the name face, after the fitted title. The words come from the entry's own
  medallions/signals, so the line can never disagree with the format badge
  beside it, and it needs no extra query.
- `src/components/lobby/lobbyEntries.ts` - `all_in_or_fold` declared on
  `LobbyTournamentRow` (selected by TournamentService's tournament reads; the
  column has existed since migration 20260822100000).
- `src/components/lobby/PremiumMttRows.css` - the name face stacks the title
  over the line (`:has()` column flex); the title fitter still measures the
  same zone width, so fitting is unchanged.
- `src/components/lobby/LobbyTable.css` - the base (non-chassis) rule.

House blue `#45adff`, never gold (color ruling 2026-08-24), uppercase like
every label on the glass.

## Proof

- `tests/unit/aFreeRollSaysItsKindUnderItsTitle.test.tsx` pins the label
  derivation (PKO / Mystery / Bounty / AoF / plain fallback / paid prints
  nothing) and that both boards render the line inside the name face under
  the fitted title.
- Headless renders at 393px and 900px (chromium against the Vite dev server)
  show all four freeroll variants printing their line under the title with
  the plate and stat strip untouched, and the paid Nightly card unchanged.
