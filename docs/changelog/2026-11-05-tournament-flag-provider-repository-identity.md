# Tournament Flag Cards Read The Transferred Repository

The v53PloTourneyIcm card qualification route still compared the provider
against the pre-transfer repository name `Smarter-Poker/Smarter-Poker-Club-Arena`.
Inside the current repository, `GITHUB_REPOSITORY` is
`Smarter-Software-PIQ/Smarter-Poker-Club-Arena`, so every card cell would have
been refused with "Manual first-attempt provider admission required".

That refusal is not harmless. Each card's reserved held-out seeds are one-shot:
`tournamentFlagProvider` refuses any card that already has an earlier original
operation, so a first dispatch refused for the stale name would have consumed
the card's reservation permanently without dealing a single valid pair.

The provider now binds the current repository name and its immutable id
(1132369872) in the runner environment and in the provider's run record, and
reports the current name in every envelope. Nothing is dispatched by this
change; the plan stays `awaiting_protected_source_lock` and the flag stays off.
`server/src/benchmark/HorseTournamentFlagRepository.test.ts` pins the identity
and the refusals.
