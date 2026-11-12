# Private historical Horse study

This is an explicit offline acquisition and review tool. It never writes to
production, chooses a live action, issues strategy qualification or activates a
policy. A reviewed record is not a solved hand. Every decision carries its
evidence gaps, legal alternatives and explicit unqualified status.

[Read the aggregate playbook and implementation guide](HORSE-HUMAN-PLAYBOOK.md).

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

Repeat `--database` to search disjoint volumes together. The existing hand and
candidate commands return JSON with a single global ordering and limit. Use
`--sql` for read-only TSV over `hands`, `included_hands`, `decisions` and
`candidates`. The `source` column is the one-based input position. The query
refuses overlapping hand or decision IDs before emitting rows.

```sh
python3 -B scripts/ops/horse-study-query.py --database "$BASE/study.sqlite" --database "$DELTA/study.sqlite" --sql "SELECT source, domain, count(*) FROM included_hands GROUP BY source, domain"
```

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
board. Short-deck uses its 36-card deck, flush-over-full-house ordering and
A6789 low straight. Pineapple post-discard ranking requires the retained pair
and an earlier own discard; preflop requires all three original cards. A final
two-card pair must never stand in for the preflop hand. Missing original cards
may be recovered from the named actor's validated history mapping, with provenance;
other players' private cards and future boards never supply that recovery.

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

For an explicitly declared heads-up PLO4/5/6 cash river range and size-specific
fold/call responses, [the private conditional comparison CLI](horse-river-conditional.md)
compares check-through with legal bets using exact rational arithmetic. It
refuses unsupported costs, contexts and unpriced raises. These assumptions are
not inferred from revealed opponent cards or treated as qualified historical EV.

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

### Frozen census and fleet evidence reconciliation

The maintained reporter also reproduces the retained November 10 census:

```sh
python3 -B scripts/ops/horse-study-report.py --census-audit --source "$FROZEN_STUDY" --predecessor "$ORIGINAL_STUDY" --subject-config "$PRIVATE_SUBJECTS" --output "$NEW_PRIVATE_CENSUS"
python3 -B scripts/ops/horse-study-report.py --fleet-acceptance --source "$FROZEN_STUDY" --subject-config "$PRIVATE_SUBJECTS" --journal "$ORIGINAL_JOURNAL" --health-evidence "$HEALTH_CAPTURE" --output "$NEW_PRIVATE_FLEET"
```

`PRIVATE_SUBJECTS` is an explicit private JSON file with `excludedSubjectIds`
(an array of canonical account UUIDs) and `comparisonSubjectId` (the comparison
account's canonical UUID; WooWoo in this frozen cohort). No private identities are embedded in the reporter.
The census requires the frozen manifest's cutoff, cohort counts, exclusions and
SQLite digest to match its supported November 10 corpus. Its descriptive notes
are specific to that corpus; this mode is not a new live database acquisition.
The input files and code are hashed in the output. Frozen inputs are never edited.

Conservation can support an inferred **group** return when individual Horse
returns are unavailable. It cannot supply individual returns or an independent
residual. The report preserves the group means and aggregate cluster estimates,
but leaves individual-seat IID variance, ICC and associated design effects
unknown in cells containing missing individual returns. Primary-human clustering
is a sensitivity calculation; tournament accounting can include tariff estimates;
EV fields with realized-return substitution are mixed estimates. None certifies
payments, historical strategic EV or complete retained history.

Tournament cost is gross recorded funding, or a tariff estimate where receipts
are absent, unless `--refund-evidence PRIVATE_JSON` is supplied. An unregistered
registration keeps its entry receipt and is refunded separately, so gross cost
overstates what was paid. The evidence (`horse-census-refund-evidence-v2`) is a
private read-only, row-level acquisition for the cached tournaments before the
cutoff. `refunds` has one row per `tournament_refund_tranches` row, joined
through its unique entitlement to the funding receipt it reverses, the wallet
credit and the unregistration receipt; `unregistrations` has one row per
`tournament_unregistration_receipts` row. A refund is netted only when ledger
entry, registration, participant, tournament and currency all match, the credit
equals the refund, and each registration's bound refunds equal its receipt. A
repeated entitlement or registration, an unbound row, a ticket return, a refund
above its receipt, a refund against a tariff estimate and any other refund
source on a completed tournament refuse. Partial refunds and refunded rebuys
and add-ons net against their own receipts. Gross cost, refunds and net cost
stay separate, and `tournamentPayoutRoi.refundCoverage` names the evidence
digest or states `UNVERIFIED_no_refund_evidence`. Entry counts are not
adjusted, cancelled tournaments stay outside ROI, and none of this certifies a
wallet payment.

Tournament currency comes from recorded funding receipts only. `is_xmtt` marks
a union event and never selects a currency; a tournament without receipts is
`unrecorded`, mixed currencies refuse, and recorded funding that is not gross
entry, rebuy and add-on charges refuses.

Return on cost is reported per entry cohort, never pooled. Each currency block
keeps the pooled cost and return totals with `roi_pct` null, then
`by_entry_cohort.paid_entry` and `by_entry_cohort.free_buy`. A free-buy event
has no entry cost, so its rebuys and add-ons are not an ROI denominator and its
`roi_pct` is null (`not_defined_zero_entry_cost`); its winnings are promotional
prize money. A tournament without a boolean `free_buy` flag refuses. The fleet
enters every one of these events against other Horses as well as people, so a
Horse return on cost is mostly Horse-versus-Horse redistribution less fees and
is not a result against human players. A cash cell with fewer than two
clusters has no clustered error, and with two clusters only the t interval is
shown as a description, not an estimate of precision.

Fleet JSON and TSV retain one row per roster Horse and feature. `null`/`unknown`
never means zero, disabled or failed. Source inclusion, worker health, effective
configuration, exact eligibility, evaluation, eligible invocation, local rule
application and accepted action are separate observations. Original journal
envelopes and request/read-frame/execution/accepted-action bindings must validate
before attribution. V87 `deepDive` v1 records credit only their named rule;
generic telemetry and broad domain activity cannot prove a pillar. A local input
change is not proof of a final causal action change. A true cell means at least
one bound witness, not universal coverage of the Horse's decisions. Health
remains a separately timestamped system observation. Pillar 2 exclusion and R7/R8
qualification status are separate from observed runtime evidence.

The original reconciliation review must bind its version, scope, record count
and sorted-record manifest to the exact supplied records. A stale or missing
binding refuses attribution. Pooled public-read credit also requires the owning
reviewer's public-read provenance verdict; a reconciled action join alone does
not qualify a public read. Original acceptance-time authority withdrawals and
wager normalization remain governed by that reviewer.

A Lightning accepted terminal carries no accepted actor roster. Its actor
classes come from the original decision-time player lists of the same hand,
recorded as `rosterSource: lightning_decision_snapshots`. Conflicting or
non-boolean classes refuse. Eligible-human presence is true only for a
positively identified, non-excluded human, false only when every settled
participant was classified, and otherwise unknown. Any other terminal without
its accepted roster refuses. Lightning accepts simultaneous fast-fold decisions
made on the same public state, so several decisions share one prior-action
count: a Lightning decision binds to the one accepted action equal to its
executed record, and no accepted action binds twice. A capture with no journal
records is the omission `no_journal_records_for_key`: unknown, never evidence
of no Horse activity.

`capturedCoverage` separates the twelve expected variant/mode/speed cells:
ordinary and Lightning NLH/PLO4/PLO5/PLO6 cash, and the four tournament variants.
Original public-memory speed is retained on each witness; missing speed remains
unknown. Counts describe captured hands, decisions, human participation, ability
to respond and per-feature evidence. Zero captured decisions never proves zero
natural opportunities or complete domain coverage.

Repeat `--journal` for disjoint original JSON/JSONL captures. Duplicate events
refuse. Captures outside the declared serving revision or half-open windows
are retained as omissions. `--observation-epoch PRIVATE_JSON` supplies a new
explicit `servingReleaseSha`, `windows` array (`startUtc`, `endUtc`), and `design`
(`retrospective` or `prospective_declared`). A prospective declaration also needs
`selectedAtUtc` before every window starts; retain the original declaration and
its provenance separately. Legacy activity keeps its original epoch. The default
historical Window C was retrospectively selected and is not prospective evidence.
Snapshot binding uses Node's JSON number serialization to match the original
JavaScript producer; Node must be available when consuming `deepDive` receipts.

Publish maintained source through the normal protected PR. Reproduce the private
reports from the merged source and verify their hashes and counts. Never upload
raw reports, journals, individual identities or outcomes to this public repository
or Actions artifacts. Report publication does not require an engine replacement;
new journal instrumentation and live-use acceptance require their own containing
engine release and fresh original receipts.

`python3 -B -m unittest discover -s scripts/ops -p 'test_*.py'` exercises known
card answers, exclusions, street/card isolation, prior-only actions, bubble
classification, conditional bluff arithmetic, storage and query integrity.
`tests/unit/horseHumanStudy.test.ts` executes that suite in the repository's
maintained Vitest route. Raw histories and generated artifacts are private
and must never be committed to this public repository or CI artifacts.
