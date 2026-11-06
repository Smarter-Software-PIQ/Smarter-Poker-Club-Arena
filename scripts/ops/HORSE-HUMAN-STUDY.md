# Private historical Horse study

This is an explicit offline acquisition and review tool. It never writes to
production, chooses a live action, issues strategy qualification or activates a
policy. A reviewed record is not a solved hand. Every decision carries its
evidence gaps, legal alternatives and explicit unqualified status.

## Acquisition

`horse-human-study.py MODE --output PRIVATE_SSD_DIRECTORY --cutoff UTC_INSTANT`
uses the existing authenticated native Supabase export connection. Modes are
`metadata`, `human-index`, `fact-index`, `lightning-index`, `flagged-history`,
`missing-history` and `enrich`. Use immutable acquisition directories and retain
the query, row count and SHA256 receipt. Cutoff is exclusive. Do not change a
query under an existing receipt name. Acquiring these sources alone does not
certify the historical population. Reconcile historical classifications,
deleted identities, raw accepted submissions, Lightning identity links,
archives, late commits and retention separately.

Put the explicitly selected excluded account UUIDs in a private `exclusions.json` array beside the raw sources. An explicit empty array means no exclusions; a missing file refuses the build. Its digest and identities are bound into the private summary, never public source. Stable account IDs implement the research exclusions. A mixed hand with an
eligible human is retained. Excluded participants' public actions remain part
of the hand. The exclusions never change production strategy.

## Build and query

```
python3 -B scripts/ops/horse-study-report.py --source PRIVATE_RAW_DIRECTORY --output NEW_PRIVATE_REPORT_DIRECTORY
python3 -B scripts/ops/horse-study-query.py --database PRIVATE_REPORT_DIRECTORY/study.sqlite --hand HAND_UUID
python3 -B scripts/ops/horse-study-query.py --database PRIVATE_REPORT_DIRECTORY/study.sqlite --candidate strong_hand_checkback --domain cash/plo5/table --limit 100
```

Paths must be absolute. The builder requires the authorized mounted external
volume and private directory ownership. The query requires an owner-private
database and its matching completed summary digest. It opens SQLite read-only.
The report contains hand and decision JSONL, an indexed SQLite artifact, and a compressed Markdown review of every included hand and every recorded Horse street. The Markdown labels uncomputed alternatives and unresolved strategy explicitly.
Source receipt hashes are checked before consuming each acquisition file;
duplicate history and decision identities refuse instead of inflating counts.
The summary is written last; interrupted output is not a finished report.

Every included Horse has explicit preflop/flop/turn/river entries. An absent
action is `no_recorded_decision`, not proof the street was never reached.
Each decision records its prior public line, original node, own cards when
retained, actual action/origin, legal menu and alternatives. Future actions,
final outcomes and opponent private cards are excluded from its information
hash. Cash/tournament, exact variant, betting structure, Lightning, ante type,
ante size, blind, multi-board/bomb-pot rules and historical tournament stage
remain separate in `ruleContext` and the summary's exact-context breakdown.

## Independent card reference

The standard high-hand and eight-or-better low reference uses exactly two hole
cards and three board cards for Omaha. PLO4, PLO5, PLO6 and four-card PLO8 are
different input domains; FLO8 retains fixed-limit context. NLH may play the
board. Short-deck and Pineapple are explicitly outside this independent
made-hand reference rather than silently evaluated as NLH.

For strong single-board Omaha river holdings, all unblocked opposing hole-card
pairs are enumerated to establish whether a better high is possible. This is
an exact high-hand ceiling, not opponent equity: multiple pairs coexist within
one four/five/six-card holding. The counts must never be normalized into a win
probability. A high certificate does not certify a high-low scoop.

Checking before another player can act is distinct from checking back last to
act. A strong-hand check or call is a counterfactual-review candidate, not an
automatic mistake. A full house below several boats or quads is not the nuts.
Origins such as pre-action, timeout and fallback must be traced separately from
the selected Horse policy.

River opportunity counts separate open-bet opportunities, actual actions and players able to respond. They never label every river bet a bluff or every check a missed bluff. Public turn aggression, short all-in calls, postflop raises and suited-card removal are recorded separately. Pure-bluff fold thresholds are illustrative conditional arithmetic, not legal sizing recommendations or tournament utility.

## Implementation and qualification route

Use evidence-supported findings to change the existing policy owner, not this
reporter's thresholds:

| Concern               | Existing source owner                                                               | Required comparison                                                                        |
| --------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Value bets and raises | `server/src/engine/HorseRiverNuts.ts`, `HorseNearNutRiverValue.ts`, `HorseLogic.ts` | Original legal sizes, worse-hand calls, better-hand/raise response, costs                  |
| PLO4                  | `server/src/engine/plo4/`                                                           | Variant-specific range and net action utility                                              |
| PLO5/PLO6/PLO8        | `server/src/engine/omaha/`                                                          | Exact card facts, sampled ranges, high-low shares and settlement economics                 |
| River bluff selection | V53/V54 paths in `HorseLogic.ts`                                                    | Eligible denominator, blockers, sizing, range response and actual execution                |
| Tournament bubble     | `HorsePublicTournamentStage.ts`, `HorseTournamentUtilityEvidence.ts`                | Historical payouts, complete field stacks, bounties, satellite utility                     |
| Public shared memory  | `server/src/engine/horseDecision/pooledPublicProfiles.ts`                           | Prior-only public observations, domain isolation, age and sample uncertainty               |
| Qualified corrections | `server/src/services/horseCorrectiveReview/`                                        | Original journal/source custody, independent reference, held-out gain, protected authority |

The existing corrective issuer's scope is narrower than all variants and all
streets. Do not relabel this report as its accepted input, bypass its signature
or original-runtime requirements, or route unsupported domains through a
qualified cash river kernel. Extend and qualify the actual owning contract
when evidence requires it.

For each correction retain: triggering decision IDs; exact domain and required
inputs; competing actions and sizes; reference assumptions and uncertainty;
original and candidate source/version; regression; untouched holdout; existing
qualification/selection identity; protected merge; deployed identity; natural
accepted-use proof. Source-tested, qualified, selected, deployed and live-used
are distinct statuses. No historical guess is an activatable playbook entry.

## Verification

`python3 -B -m unittest discover -s scripts/ops -p 'test_*.py'` exercises known
card answers, exclusions, street/card isolation, prior-only actions, bubble
classification, conditional bluff arithmetic, storage and query integrity.
`tests/unit/horseHumanStudy.test.ts` executes that suite in the repository's
maintained Vitest route. Raw histories and generated artifacts are private
and must never be committed to this public repository or CI artifacts.
