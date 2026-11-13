# A default-off Horse flag has a league card (HU-AUDIT-002 Phase 2)

Date: 2026-11-13

`commitUnderPot` shipped default OFF on 2026-11-07, and no league card dealt
it. A default-off flag is switched on only after the nightly league confirms
it, so that flag could never be switched on. #10688 gave it cards; this law
stops the next one.

`server/src/benchmark/ADefaultOffFlagHasALeagueCard.law.test.ts` reads every
ledger flag whose note says "default OFF" and requires an arm of some card in
`LEAGUE_MATCHUPS` to set it. Fifteen flags were undealt when the law was
written (`v16Ratio`, `omahaPreflopCallWithActionBehind`,
`vpipFloorDeepStackOff`, seven `style*` flags, `readScopedShrink`,
`nashPushFoldIcm`, `comboDrawPressure`, `riverBluffCheckRaise`,
`riverPositionDefense`). They belong to other lanes, so they are listed rather
than given cards here. The list may only shrink: a listed flag that gains a
card, or stops being default OFF, fails the law until it is removed.

A new default-off flag now needs its card in the same pull request.
