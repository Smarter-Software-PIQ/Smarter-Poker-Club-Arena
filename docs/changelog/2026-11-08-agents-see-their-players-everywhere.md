# Agents see their players on every lobby tab, and Rewards pins the hero (2026-11-08)

Dan, verbatim:

> WHEN A PLAYER CHECKS 'REWARDS' IT SHOULD DEFAULT THE HERO TO THE TOP, LIKE IT
> DOES WHEN YOU CLICK 'RANKING'.

> INSIDE OF TOURNAMENT LOBBIES WE HAVE THE FUNCTION WERE AGENTS CAN SEE THERE
> PLAYERS IN A TOURNAMENT, OR WHO'S STILL IN. IF THEY DON'T HAVE ANY PLAYERS LEFT
> OR REGISTERED. IT SHOULDN'T NOT SHOW. IT SHOULD ALWAYS SHOW SOMETHING EITHER
> 'NONE OF YOUR PLAYERS REGISTERED FOR THIS EVENT' OR NO PLAYERS ARE REMAINING
> AND SHOW WHICH PLAYERS ENTERED AND WHAT POSITION THE FINISHED. AND IT SHOULD
> SHOW UP ON THE DETAILS PAGE AND REWARDS. AND IF YOU CLICK ON THE 'TABLES'
> PAGE, IT SHOULD TELL YOU IF YOU HAVE A PLAYER ON THE TABLE AND WHO.

## What changed

- **One shared "your players" strip** (`MyPlayersCard`), fed by one hook
  (`useMyPlayers`) and one pure derivation (`deriveMyPlayers` in
  `myPlayersSummary.ts`). It resolves the club exactly as Ranking always did
  (route club, else `?club=`, else the entered club) and calls
  `useDownlineIds` once. It shows for anyone who carries a downline, and never
  while the read is loading or after it failed.
- **It is never silent any more.** States:
  - nobody entered: "None Of Your Players Registered For This Event";
  - before the start: "N Of Your Players Is/Are Registered";
  - running: the two lines Ranking already had ("X Of Y Of Your Players Is/Are
    Still In", "Best 20th - 5K Chips Between Them");
  - everyone out or event over: "None Of Your Players Are Remaining" with every
    entrant and the place they finished, best first (qualifiers say
    "Qualified"), open by default.
  - Otherwise the list sits behind a small Show Players / Hide Players toggle
    and scrolls inside itself.
- **Where it shows:** Details (under the event summary), Ranking (where the old
  strip was; Mine Only stays and appears only when there is someone to filter
  to), Rewards (top, under the new hero card) and Tables (top).
- **Tables:** a table with one of your players on it now says who
  ("Your Players: Danimal, Kingfish +2 More") and carries a "Yours" badge. A
  busted player's stale table never counts. The hero's own "Your Table" badge is
  unchanged.
- **Rewards hero pin:** the same card Ranking pins ("Your Current Position" while
  playing with the live chip rank Ranking prints, "Your Result" once finished),
  with Place Prize, Bounties (bounty events only) and Total. While running and a
  ladder exists, the place figure is the "If You Bust Now" prize the Payouts list
  already marks. The hero's row now leads "Bounty Winnings Outside The Place
  Payouts" and the satellite awards list. No money math changed; only order.

## Shared pieces

- The hero card CSS moved out of `RankingTab.css` into `HeroPin.css`, imported
  by both Ranking and Rewards, so the two pins are the same card.
- The old `.rk-legend` rules moved into `MyPlayersCard.css` unchanged. The
  surface scanner (`find-generic-surfaces.mjs`) carries a RULED entry for it with
  the reason: it is the existing lobby strip, inside the lobby Dan ruled off the
  console on 2026-10-04.
- Live ranks use `tournamentChipRanks` over the non-out, non-qualified field, the
  same rule as Ranking, so the numbers agree across tabs. Horses count like
  everyone else; nothing reads `is_horse`.

## Tests

- `tests/unit/agentsSeeTheirPlayersEverywhere.test.tsx`: every derivation state,
  the card's wording and toggle, the Tables row line and badge.
- `tests/unit/rewardsPinsTheHeroFirst.test.tsx`: the Rewards pin and hero-first
  bounty list on a bounty-only PKO like the one in Dan's screenshot.
- `tests/unit/tournamentDownlineIds.test.tsx`: the club-resolution pin now reads
  the shared hook, and asserts every tab reaches the downline only through it.
