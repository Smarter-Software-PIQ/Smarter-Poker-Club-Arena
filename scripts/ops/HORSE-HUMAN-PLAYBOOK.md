# Horse playbook for decisions against humans

The six-volume baseline cutoff is **12:35 UTC on November 7, 2026**. Six private volumes contain 42,444 retained histories, 36,657 eligible hands and 313,562 Horse decisions. A hand qualifies through eligible human participation. For advice about a human opponent, check that a human still had a stake or could respond at the decision. Original Horse cards remain missing on 10,077 decisions. Those decisions can establish public action, price and legality. Their hand strength remains unknown.

The final frozen cohort closes at **00:00 UTC on November 8, 2026**. Across nine indexes, 42,938 histories include 37,065 eligible hands, 5,865 exclusions and eight histories with unresolved identity. The eligible hands contain 316,741 distinct Horse decisions. The earlier six-volume counts below retain their original denominators.

Across the final cohort, 10,561 decisions still lack indexed original Horse cards and 3,444 lack an original legal menu. The two counts can overlap. Of 25,070 decisions originally missing tournament stage, 1,439 have a recovered stage, leaving 23,631. Full payout, field-stack and bounty context remains unbound for 167,619 decisions. All 316,741 lack a qualified strategic reference bound to the full decision. Use the narrower conditional comparisons below where their assumptions hold. Eight unresolved histories and unknown lifetime retention limit the historical coverage claim.

## Omaha coverage

Counts are Horse decisions. Lightning counts are part of the cash column.

| Variant |   Cash | Of which Lightning | Tournament |
| ------- | -----: | -----------------: | ---------: |
| PLO4    | 31,691 |              8,989 |      4,453 |
| PLO5    | 58,985 |              7,187 |      1,117 |
| PLO6    |  6,080 |                660 |      1,704 |
| PLO8    |    679 |                  0 |      3,293 |
| FLO8    |    906 |                  0 |          0 |

Keep the hole-card count, betting structure, board count, ante payer and speed format in the decision key. In Omaha exactly two hole cards and three board cards make each hand. For split pots evaluate high and qualifying low separately, including scoops, ties and quartered pots. In FLO8 use the legal fixed bet sizes and raise caps. The retained high-low river analysis enumerated opposing holdings on 408 single-board decisions and one double-board decision. Shared cards constrain the two boards. These exact physical comparisons do not establish an opponent's betting range.

## Decisions to change or preserve

| Situation                                      | Action and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Checked-to river, middle or top full house     | In high-only single-board play with a human able to respond, Horses checked 22 of 104 opportunities. Regular PLO5 cash supplied 16 checks in 57 opportunities. Route legal value bets through the final wager rules. Include trip boards when an opposing lower full house is possible. Preserve the opening-check distinction and require a legal bet. [Checked-to correction](https://github.com/Smarter-Poker/Smarter-Poker-Club-Arena/pull/9766)            |
| Facing a pot-sized or bigger opening river bet | Among 25 beatable non-bottom boats on non-trip boards, Horses called nine times, folded once, raised six times and shoved beyond the call price nine times. Take the legal stack-capped call for the qualifying hand. Preserve separate rules for unbeatable hands and trip-board under-fulls. [Large-wager correction](https://github.com/Smarter-Poker/Smarter-Poker-Club-Arena/pull/9772)                                                                    |
| Near-nut flush checked to on the river         | A PLO5 check with only one superior legal opposing hole pair reproduced in the chooser. The correction selects a value bet in that fixture and preserves the existing pot bets in two controls. [Near-nut flush correction](https://github.com/Smarter-Poker/Smarter-Poker-Club-Arena/pull/9826)                                                                                                                                                                |
| Turn after a human called the flop             | In 46 qualifying spots, Horses bet 42 times, shoved twice and checked twice. Both checks were top full houses in Lightning cash with a BB ante. One was the current nuts in PLO4. Assess turn bets with a river still to come. Record redraws and the same caller’s ability to continue.                                                                                                                                                                        |
| Lightning and BB ante                          | Reconstruct the ante contribution, live blind, pot, effective stacks and legal minimum and maximum before comparing sizes. Track Lightning and BB ante independently. Use a matched domain when estimating calls, raises or folds. The two turn checks above are evidence for a specific value correction; they cannot set a universal Lightning aggression multiplier.                                                                                         |
| River bluff with a nut blocker                 | In 15 opportunities with one pair or less, a lone nut-flush blocker and a human able to wager, Horses opened with two bets and two jams. Eleven checked. For each legal size compare fold gains and called outcomes to checking, allowing for showdown share, higher hands removed, worse hands blocked, effective stacks and costs. Bound uncertain response frequencies. The 15 actions establish actual bluff candidates, not a profitable target frequency. |

## High-only value betting and river sizing

**PLO5 and PLO6.** Of 84 checked-to middle or top full houses across 81 hands, Horses bet 62 times, went all-in twice and checked 20 times. Eighty decisions were in cash and four in tournaments. Every check left at least one opponent to act. Fifteen checked through, an eligible human opened twice, and another Horse opened three times. Open for value in this high-only spot. For a check, compare a half-pot opening within the original legal bounds. Only four of the 20 checks had an earlier pool comparison matching the rules, position, opponents' roles and size band, with at most two earlier hands each. None had an exact-size comparison involving the same set of human opponents. A missed opening is observable. Chips a human would have paid remain uncertain.

**Sizing top full with an aggressor behind in PLO6 cash.** In one regular cash hand with a big-blind ante, the Horse held aces full of sevens. Only quad sevens could beat it. A human checked and the Horse who bet the turn was still to act. The pot was 21.32 chips, legal bets ranged from 0.25 to 21.32, both opponents covered a pot bet, and the rake was already capped. Checking left an opportunity to induce a bet.

Compare each legal bet with checking through, then allow for what checking actually earns from later action. Suppose at most one opponent calls, nobody raises and quads always continues. Let **N** be the probability that exactly one worse hand calls minus the probability that exactly one better hand calls, measured across all responses to that size. This holding cannot tie. The value gained over checking through is the bet times N. If inducing after a check earns one additional chip on average, a 5.33-chip bet needs N above 18.76%, a 10.66-chip bet needs more than 9.38%, and a 21.32-chip bet needs more than 4.69% (rounded). If inducing earns only 0.25 chip, the thresholds fall to 4.69%, 2.35% and 1.17%. These are hypothetical induction values. The actual calling and raising frequencies are unknown.

When two opponents match the bet in the same pot, the break-even showdown share on that branch is one third, provided fees stay capped. Weight their joint responses, including raises and the Horse's continuation. Record the value opportunity separately from any estimate of the cost of checking. In the original four-volume checked-to boat inventory, 177 of 313 decisions met the policy eligibility criteria and 29 of those were checks.

**Facing a human bet with the absolute nuts.** The six-volume PLO4/5/6 cash study screened 8,752 river decisions. In 882 single-board spots, an eligible human set the outstanding price, raising was legal and a human could match additional chips. The Horse held the absolute nuts in 29 of them. It raised 20 times, went all-in for more eight times and called once. Four nut hands were untieable and 25 could tie. The 84 checked-to decisions above concern opening for value. These 29 concern raising an outstanding wager.

In the lone flat call, a PLO5 Horse held the nut straight heads-up after a third player folded. Calling contested 219 chips, with rake capped at 5 and a fixed jackpot fee of 0.50. Legal raises to 100–269 exposed 50–219 more chips the bettor could match. Raising and continuing against a reraise weakly dominates calling under these conditions. A worse hand folding gives the Horse the same net chips as a call-through, while a worse hand calling pays the extra amount. A tying hand that calls preserves the split, while one that folds gives the Horse an additional 106.75. No earlier size-and-position comparison supported an optimal size or a realized loss estimate. Check remaining matching capacity and marginal fees before applying this result elsewhere. Multiway side pots and split-pot games need their own payoff comparison.

**PLO4 Lightning cash with a big-blind ante.** The sixth volume adds 38 hands and 300 decisions. Original cards were available for all 103 postflop decisions and missing on 105 of 197 preflop decisions. For the 87 flop and turn decisions the analysis checked all 3,880 possible next-card cases. A made-hand improvement still needs an opponent redraw assessment. Only four of 16 river decisions involved a human able to respond. The Horses checked three times and bet once. None of the four involved a near-nut hand, full house or response to a human river wager.

**PLO4 Lightning preflop folds.** A separate review of 187 zero-investment folds across 68 hands recovered the original hand structure and matched every fold to its accepted action. The two cohorts contributed 95 and 92 folds. At the 94 on-turn decisions, the original pot, call price and legal menu matched the accepted action record. The other 93 decisions were early looks. In 43 of them, both the pot and call price changed before the fold landed. The legal menu matched in all 187 cases. Evaluate an early fold using the quote the Horse saw and retain the later price separately.

Five folds had four distinct ranks within a five-rank straight window. Eleven others were double-suited. Review calls and legal raises for these 16 holdings at the original price, accounting for position, effective stack, suit dominance and the opponents still to act. The structural counts alone establish neither a profitable continuation nor a folding mistake.

A two-pair lead of 4.40 into 19.68 illustrates the sizing decision. The Horse blocked four of 16 board-nut pairs. Before that hand, the public histories contained zero comparable first-to-act leads of quarter-pot or smaller. Across all sizes in the same position the pool folded nine times, called eight times and raised twice. A separate fold-or-call sensitivity used the captured rake and jackpot fees, half of worse hands calling, 10% of better hands folding and tied hands always calling. Relative to a check-through the bet gained 0.03 chips under a hypothetical 49% weaker, 2% tied and 49% stronger range. It lost 1.02 chips at 25% weaker, 2% tied and 73% stronger. In the second range the bet needed better hands to fold more than 16.2% of the time. A human could also bet after a check or raise the lead. Price those branches separately. Observed overall folds cannot identify the fraction of better hands that fold.

### What the 29 observed boat checks can support

The frozen denominator contains 29 policy-eligible checks with a middle or top full house on a single high-only board. A human could respond in 22. Five legal bet sizes per decision produced 145 decision–size pairs. For 141 pairs the available fee schedules agreed on the marginal cost for at least one matched-caller branch. The four unresolved sizes came from regular PLO5 cash.

| Format          | Checks | Sizes with a price | Priced caller-count branches |
| --------------- | -----: | -----------------: | ---------------------------: |
| PLO4 cash       |      3 |              15/15 |                        35/35 |
| PLO5 Lightning  |      1 |                5/5 |                        10/10 |
| PLO5 cash       |     19 |              91/95 |                      262/271 |
| PLO6 cash       |      5 |              25/25 |                        80/80 |
| PLO4 tournament |      1 |                5/5 |                        10/10 |

With one matched caller, the required conditional showdown share ranged from 50.00% to 55.56%. With `m` equal callers each matching a bet of `B` and a marginal deduction of `D`, the threshold is `B / ((m + 1) × B − D)`. Use this price on a common pot when comparing a matched bet with the same showdown after checking through. Weight raises, unequal contributions, induced bets and side pots separately. All 397 priced branches use chip values, including the tournament branch. For nine other branches, plausible fee schedules disagreed. Split pots and trip boards require separate evidence.

### How much fold equity can a river bluff assume?

A chronological development sample examined actual cash PLO4/5/6 opening river bets on a single board with one identifiable human responder. A model trained on 447 earlier bets could price 218 of 224 later bets by matching the domain and bet-size bucket. For the 59 later bets of half pot or less, the model predicted 58.7% folds and observed 39.0%. Its average squared probability error was 0.2346 versus 0.2417 using domain alone. Size improved that score by 0.0163 in one week and worsened it by 0.0100 in the next. Some training groups contained a single bet.

Keep the size-based estimate out of live bluff selection. A fold observed against an actual bet does not identify the response to a hypothetical bet from a checked node. Opponent selection, multiway play, the Horse's hand and tournament utility can change the decision.

### Checked-to boats and near-nut hands through the final cutoff

All 268 Omaha river decisions in the five later volumes matched the original state. Eight added checked-to full houses. Six met the original single-board, high-only rule for non-bottom boats on non-trip boards, and the Horses bet all six. The other two actions were on a trip board. Across all nine volumes the rule therefore covered 183 opportunities: 139 bets, 15 all-ins and 29 checks. A human could still wager in 108 (82 bets, four all-ins, 22 checks). A human made the last check in 74 (62 bets, three all-ins, nine checks). The 29 priced checks cover every recorded check under this rule, including spots where only Horses could continue.

Trip boards have their own denominator. Among 37 ordinary high-only Omaha cash decisions with a checked-to boat on a trip board, 36 allowed a priced bet with a lower boat still physically reachable. The Horses bet 16 and checked 20. In seven, an opposing prior aggressor had chips and had yet to act on the river. All seven were PLO5 cash checks. A human could respond in six. These historical checks establish the behavior under review. To verify a release, require a new accepted value bet from the serving revision with that prior aggressor still able to act.

Across those seven holdings, a one-opponent model required 47.69%–100.61% of weaker holdings to call to break even against checking through. Divide the number of stronger holdings by the number of weaker holdings after removing the board and the Horse's cards. The result assumes all holdings reach the river uniformly, every stronger hand calls, ties contribute no incremental value, nobody raises and fees stay fixed. In the 100.61% case even every weaker hand calling falls short. The original decisions had a pending aggressor, sometimes additional opponents, and an opportunity to induce. Their seven checks missed the requested policy action, while chip costs remain unknown.

In a separate PLO4/5/6 river census, 78 human-facing decisions allowed exactly one unseen two-card combination that could beat the Horse. The Horse was first to act in 31, faced a wager in 19 and followed a check in 28. It bet 20 times, went all-in twice and checked six times in those 28. With uniform holdings, the probability that one of `m` opponents receives both beating cards is `m × k × (k − 1) / (N × (N − 1))`, where each opponent receives `k` of `N` unseen cards. The opponents cannot share that exact pair. The resulting physical baseline ranged from 0.66% to 7.32%. Prior actions may concentrate the beating pair. Ties, worse calls, raises, pricing and induced bets matter when evaluating those six checks.

### Plan future streets when holding a full house

Among 296 flop decisions across 237 distinct PLO4/5/6 card states, the number of unbeatable river cards depended on the turn card in 266 decisions. In one PLO6 cash hand a quads-making turn left no superior high possible on any of 42 rivers. Another legal turn left only one of 42 rivers on which the Horse's high was unbeatable. Evaluate the turn that arrives before deciding how to respond to its bets.

Across 612 turn full-house decisions, 584 had at least one river improving the Horse's own rank. In 447, at least one such improvement still allowed an opponent to make a higher hand. Of 2,626 improving decision–river combinations, 1,815 retained that risk. A single card can count at several decisions. Use card counts as physical possibilities. Price calls and raises from the range likely to continue and the common or split pot actually available.

### Using another human's history to estimate river folds

A second development check removed every earlier observation from the human facing each later bet. Of 224 later decisions, 154 across 16 humans retained a matching size and rule group. The other 70 had too little support for a forecast. For supported bets, mean squared probability error was 0.2642 with size and 0.2648 using domain alone. Giving each human equal weight reversed the comparison, with sizing increasing error by approximately 0.0060. On 44 supported small bets, predicted folds averaged 58.8% and observed folds were 38.6%. Shared history from other humans does not establish a reliable pooled trigger for bluffing here. These observations concern actual opening bets against one human. The response to betting instead of a historical check remains unknown.

### Facing a river bet with a non-bottom full house

In the 34 reviewed large-wager cases across high-only PLO4/5/6 cash and PLO6 tournaments, Horses made 15 effective calls, six raises, ten all-ins beyond the call price and three folds. These 34 are part of a 308-decision facing-bet appendix. Keep the populations distinct when counting mistakes. The 34 original menus supplied 66 legal decision/raise-size comparisons. The stack-capped gross call thresholds ranged from 24.76% to 33.33%. For a common pot fully available at showdown, divide the call by the sum of current pot and call. To price a raise, subtract the actual call investment from the new commitment, then value worse calls, stronger continuations and reraises. A gross call threshold alone cannot settle whether to raise.

Across the larger 308-decision appendix, effective actions were 227 calls, 30 raises, 42 all-ins beyond the call price and nine folds. There were 748 decision/raise-size comparisons. One accepted raise had ambiguous extra investment. The appendix covers selected facing-bet decisions. Tournament prize and bounty effects, fees, side pots and actual response ranges remain relevant to each comparison.

### Preflop folds with suit-supported aces

A four-volume screen found 60 folds with at least two aces, suit support, a priced raise and a human able to respond. Thirty-nine holdings had three aces, one had four, and 20 had exactly two. Sixteen of the 20 exact-two-ace folds faced a reraise. All 60 original decision records supplied the call price and legal raise endpoints.

Among the 20 exact-two-ace hands, call divided by pot plus call ranged from 22.22% to 41.03%. The four Lightning examples all faced reraises and ranged from 33.33% to 39.47%. The single PLO6 tournament example had a 30.77% chip threshold. Compare future equity realization, players left to act, fees, and tournament utility before treating a fold as a mistake. One PLO5 opponent was already all-in, so an isolation raise could never win the entire pot through folds.

### A PLO5 trip board with four opponents still able to respond

On a board of three eights, a four and a five, a PLO5 Horse checked eights full of nines after a human checked. Removing the Horse's five cards and the board leaves 850,668 legal holdings for a single opponent. Of those, 548,943 are weaker, 8,279 tie and 293,446 are stronger. Four opponents were able to respond, and their holdings compete for the same cards.

A sensitivity model dealt all 20 opposing cards without replacement in 200,000 uniform joint deals. At least one opponent beat the Horse in 85.16% of deals. The Horse's average share including ties was 14.43%, with a simulation standard error of 0.08 percentage points. If all four always fully match a bet, nobody raises, fees stay fixed and checking gives a free showdown, each additional chip bet changes expected gross value by approximately −0.278 chip. Prior betting changes range weights. Folds, selective calls, raises and induced bets can change the preferred play. Apply this example to pricing a multiway wager, while keeping the live trip-board policy and its own qualifying action receipt distinct.

## Pot-limit Omaha eight-or-better

Across 302 PLO8 river decisions, 106 still had a human able to wager, two had only an all-in eligible human, and 194 followed all eligible humans folding. Of 35 checked-to opportunities, nine were cash. The 26 tournament records included 20 pre-money, three in the money and three with unknown stage. Horses checked 31 times, bet three times and went all-in once. Twenty-one checks closed the action. Of ten that left action behind, nine checked through and one drew a human bet.

Evaluate both halves with the same opposing four-card holding. In these 35 cases every Horse could be scooped by at least one legal holding and 18 could receive exactly one quarter. None held an unbeatable high or low. For a fully matched heads-up bet compared with checking through, winning one quarter costs half the additional bet before fees. Winning half breaks even on the added chips, while a scoop gains the entire matched bet. Evaluate which weaker high or low hands will actually call. For a double board remove every exposed card from the common deck. For the 15 multiway opportunities use a joint opponent range. More players can share the low, and pairwise shares cannot price that pot.

### When a quarter of the pot is enough to call in FLO8

The nine frozen volumes supplied 107 fixed-limit Omaha eight-or-better river decisions. A one-quarter share was possible against one legal holding in 58, including 27 of the 44 decisions with a human able to respond. Of 34 decisions facing a positive price, Horses called 20 times, folded eight times and raised six times. Only ten of the 34 had a human able to respond. Six faced a prior river raise and none of those six had a human able to respond.

Nine heads-up facing decisions could leave the Horse quartered while still making a call profitable before deductions. In the two direct human opportunities, a 0.50 call returned 0.275 or 0.40 more than folding if the Horse received a quarter. Raising to 1.00 and getting one matching call while still quartered cost another 0.25 versus calling in either case. Apply the fixed raise cap, rake and odd-chip rules before using that price. The calculation establishes what a quarter is worth, while the opponent's holding and continuation frequency remain unknown.

### Calling-range sensitivity in PLO8

Nineteen single-board river decisions allowed a closing check with one eligible human able to respond. The original legal minimum and maximum supplied 38 decision–size comparisons. At a hypothetical 50% call frequency, changing which holdings called could reverse the gross-chip ranking in 17 of 38 comparisons, including three of six cash comparisons and 14 of 32 tournament comparisons. The other 21 favored betting under every allocation of call mass considered.

The bounds assume uniform reach among legal holdings before the river response, one contested pot, one fully matching caller, zero fees and zero raises. A fold wins the share of the existing pot the Horse would otherwise lose. A call adds chips in proportion to the Horse's high/low share, including ties and quarters. Actual pre-river actions can change the range. Tournament chip gains require a separate payout and bounty calculation before selecting a wager.

## No-limit hold'em Lightning cash

The sixth volume adds 307 hands and 2,237 decisions, including 125 river decisions. Eight river decisions faced an eligible human wager. Seven were heads-up, and each had both profitable and unprofitable calls relative to folding among the 990 legal human holdings. Three calls matched the recorded fees and four Horses folded. The eighth decision was multiway. The observed price and range composition determine whether a call is justified.

On one flop the Horse's all-in with pocket aces was an effective call for 12.15. The human's unmatched 1.64 returned. The enumerated call gained over folding against 1,072 of 1,081 legal human holdings and lost against nine, averaging all 990 legal turn-river runouts for each holding. Use the actual matched amount and captured fees. How often the human raised each holding remains unknown.

## Decisions observed after the six-volume baseline

By 23:20 UTC on November 7 the private index contained 42,938 retained histories, 37,065 eligible hands and 316,741 Horse decisions. The earlier tables retain their original denominators. The following decisions came from human-facing cash play with a big-blind ante.

**PLO5 and PLO6 card comparisons.** For 22,020 human-facing postflop decisions we compared the Horse with every legal holding of one opponent using exactly two hole cards and three board cards. The sample contains 11,665 flop, 6,818 turn and 3,537 river decisions. For the flop and turn decisions, 804,252 possible next cards were classified by the Horse’s resulting made hand. A stronger made hand can still be drawing thin. Use the next-card distribution alongside the remaining stacks, players and price.

| Mode           | PLO5 decisions | PLO6 decisions |
| -------------- | -------------: | -------------: |
| Ordinary cash  |         17,351 |          2,088 |
| Lightning cash |          1,678 |             93 |
| Tournament     |            331 |            479 |

The comparison required a confirmed single board and ordinary pot-limit pot. Each count concerns one opponent at a time. Multiway decision EV also depends on overlapping card removal, action order and side pots. For tournaments the payout calculation remains separate.

**Double-board PLO5 bomb pots.** The other 3,566 human-facing PLO5/PLO6 postflop decisions in this census came from cash bomb pots with two boards. Each opponent holds the same five cards on both boards. Removing the Horse’s cards and every exposed card on both boards, the study counted each legal opposing holding once and recorded the joint result. The cohort comprised 1,911 flop, 1,072 turn and 583 river decisions. Across the flop and turn there were 240,318 possible next-card outcomes counted separately by board. Evaluate scooping, splitting and being scooped before applying a single-board value rule. The single-board and double-board counts together cover all 25,586 human-facing PLO5/PLO6 postflop decisions identified in the processed volumes through this cutoff.

**PLO4, including Lightning.** The same exact comparison covered 10,150 single-board decisions. They include 2,552 Lightning cash decisions, 7,046 ordinary cash decisions and 552 tournament decisions. Earlier streets supplied 377,815 next-card cases. A further 305 double-board PLO4 cash decisions used joint opposing holdings across both boards and supplied 21,048 next-card cases counted by board. Use the Lightning-specific records when evaluating how the fast-fold pool responds to a wager.

**PLO8 before the river.** Exact current high/low comparisons covered 500 additional human-facing flop and turn decisions, 366 in tournaments and 134 in cash games. At 107 decisions the Horse could take exactly one quarter against at least one legal four-card holding. At 473 it could lose the whole pot to at least one holding. Neither statistic measures a human’s range or the frequency of a terminal outcome. Before raising for value, price what the Horse can win on each half, how often it shares the low, and whether it can improve on 22,595 next-card cases across these decisions. In tournaments, apply the resulting chip outcomes to the actual payout structure.

**PLO6 river value.** After a human and a Horse checked, a Horse bet 13 into 33 with fours full of sevens. Against one player's 4,496,388 possible six-card holdings, 3,670,896 lost to the Horse, 101,680 tied and 723,812 won. In another hand a human checked and a Horse bet 23 into 23 with nines full of eights. It beat 4,266,507 possible holdings and lost to 229,881. Both actions satisfy the checked-to non-bottom full-house rule. To compare sizes, estimate which worse holdings pay each size and which better holdings raise. Uniform holding counts alone cannot supply those response frequencies.

**PLO4 Lightning against an all-in raise.** A Horse led 24.43 into 24.43 with a full house. The human raised all-in to 70.86. The Horse's recorded raise to 204.87 returned 134.01 uncalled, with nobody else able to respond. The Horse contested exactly 46.43 more chips, the price of calling. Use matched contributions and the amount returned when grading value raises, or this hand incorrectly rewards aggression that collected no additional chips.

**PLO4 Lightning river bluff candidate.** After a human checked, a Horse bet 15.75 into 15.75 with one pair on a board where it blocked eight of the 16 two-card combinations that made the nut straight. The execution receipt confirmed the chosen bet and a live read of prior human history. It did not record bluff intent. A zero-equity pot-sized bluff breaks even at 50% folds before deductions. With showdown value, compare the bet with checking and count the better hands that fold. The human's eventual call cannot establish whether the bet was profitable.

## Tournament pressure

Across 35 one-paid events, surviving-entry and payout evidence confirmed two players remained. For 38 terminal call-versus-fold comparisons the chip-proportional heads-up regular-prize model gives the pot-odds threshold. In one PLO4 flop spot the human’s final 10 went into a 430-chip pot. Against every legal human holding the Horse retained at least 6.22% pot share, above the 2.27% price. Calling is supported even without estimating how often that human bluffs.

The study also identified 771 multi-place MTT bubble decisions. For a reconstructed 13-player event with 11 paid places, a 22.70% chip threshold became an estimated 32.98%–36.69% outright-win threshold for regular prizes under the field-stack and concurrent-pot bounds. Model ties as split outcomes. The opposing bettor was another Horse after the humans folded. Mystery-bounty continuation was unknown. Use field-wide stacks, actual payouts, position relative to the bubble, and any bounty or satellite terms before assigning tournament utility.

### Which Omaha bubble decisions involved a human?

Of 10,567 PLO4/5/6/8 tournament decisions, 231 had a bubble stage in the original records. Independent reconstruction identified 117 more PLO4 one-paid heads-up sit-and-go stone-bubble decisions. Of those 348, a human had chips available to act in 311, was all-in in five, and had already folded in 32. The 311 came from 145 hands in 13 tournaments. They break down into 79 multi-place MTT near-bubble decisions, 19 multi-place MTT stone-bubble decisions, 169 one-paid heads-up sit-and-go decisions and 44 one-paid Spin decisions. Original records established the stage in 196 of the 311 and retrospective evidence supplied it in 115. Across the PLO tournament corpus, 1,953 decisions still have an unresolved stage.

All 213 one-paid heads-up decisions had two retained stacks, one regular prize, no bounty and no deal. Under equal-skill heads-up ICM, expected regular-prize share is linear in chip share. Eleven calls would have closed betting, with the amount matched and any uncalled excess priced separately. Of the 98 multi-place MTT decisions, 82 were PLO5 mystery-bounty, four PLO8 progressive-bounty and 12 non-bounty. None met the same heads-up terminal-call conditions. Use the actual payout steps, field stacks and available bounty values there. All four PLO8 decisions were preflop in one hand with seven remaining and six paid. At the short stack's call, five players still had claims on the pot. Include high, low, quartering, future betting and side-pot eligibility before pricing that call.

### PLO8 short stack at seven left and six paid

All seven final-table stacks were present in the four decisions from this progressive-knockout hand. The regular prize ladder paid 156.69, 90, 65.05, 51.68, 43.25 and 37.33. A short Horse faced a 7,000 raise with 9,420 chips and a 10,000 pot. Another Horse opened. A human remained able to act.

Suppose the players behind fold, and a flat call checks through to showdown. Compare that 17,000 pot with folding or shoving the remaining stack and receiving a call for a 21,840 pot. Conditioning only on the short Horse’s original cards and the specified opener range gave the following regular-prize results.

| Opener range                | Call chip change | Call regular-prize change | Called shove chip change | Called shove regular-prize change |
| --------------------------- | ---------------: | ------------------------: | -----------------------: | --------------------------------: |
| Uniform four-card holdings  |           +2,864 |                    +2.713 |                   +3,253 |                            +1.590 |
| Contains an ace and a deuce |           +1,609 |                    +0.325 |                   +1,640 |                            −1.641 |
| Contains at least two aces  |             −479 |                    −3.714 |                   −1,042 |                            −7.146 |

Changes are relative to folding. With ace-deuce in the opener's hand, adding chips increased the short Horse’s expected chip count while reducing its expected regular prize compared with folding. Each range used 32,768 reproducible samples. The simultaneous 95% simulation half-widths were at most 0.299 regular-prize units for the call and 0.406 for the called shove. The opener covered the Horse, so the Horse could not win an immediate bounty in this heads-up branch. Other callers, future betting, opener folds and future bounty value can change the ranking.

### When the Horse lacked a recorded bubble stage

Five legal decisions by one Horse across two hands in an NLH bounty MTT had no stage in the original public decision records. Frozen payouts, registration and elimination evidence later established that 25 remained and 24 places paid. Four decisions involved a human still able to act. On the fifth, the human had already folded and the Horse faced another Horse. Preserve this distinction when diagnosing play against humans.

On a turn call costing 20,000 to contest 100,000, the checkdown chip threshold was 20%. Three field-stack scenarios gave no-tie regular-prize thresholds of 20.36%–20.40%. At the later checked-to river, a comparison of a minimum bluff against checking required 16.67% folds among better hands in chips and 17.05%–17.09% in those scenarios, assuming worse hands fold and ties call. The true field stacks, bounty utility and human ranges remain unresolved. The figures describe the stated scenarios only. Preserve the historically missing input in the study, and verify stage consumption on the actual decision before attributing an action to bubble awareness.

### A PLO5 bubble with 13 left and 11 places paid

The Horse faced a terminal matched call of 29,561 into 100,687 and had 52,966 behind. The opponent was all-in. The accepted action label indicated all-in, but a losing call left the Horse 23,405. Winning probability needed to break even in chips was 22.696% with no ties.

The other table held 4,500 chips in blind escrow. Using the retained 11-place ladder and regular-prize ICM, allocating those chips among the seven remote players gave a no-tie threshold of 34.864%–34.914%. The 133 evaluated scenarios include a single winner and equal splits with every possible odd-chip recipient. They conserve the same 4,500 chips across fold, call-win and call-loss. A hypothetical 30% winning chance would favor calling for chips and folding for regular prizes. Actual opponent equity, mystery-bounty value, remote side pots and subsequent betting remain unresolved. Seven other multi-place cases lacked verified remote stacks at the decision. Keep their prize thresholds open.

### PLO4 Lightning closes with a big-blind ante

Across the nine frozen volumes, 598 PLO4 Lightning river decisions came from 388 hands. In 126 the Horse closed the river after the only remaining opponent checked. The scorer priced all 126 decisions across 2,124 terminal branches, accounting for matched chips, uncalled returns, rake and jackpot fees. The Horses checked 72 times, bet 48 times and went all-in six times. A legal 64.51-chip wager against a 51.28-chip stack illustrates why cent precision matters: when called, 13.23 returns uncalled.

The remaining player was an eligible human in 82 closing decisions, 54 with a 2.00 big blind and matching ante and 28 with a 0.50 big blind and matching ante. The Horses checked back 49 times. The 33 actual wagers drew 24 folds, eight calls and one raise. To compare sizes, require a prior result with the same blinds, ante, number dealt, closing position and bet-to-pot ratio, published before the new hand started. Only 12 of the 33 wagers had such an earlier pool observation, and nine had one for the same human. Across 262 legal decision/size comparisons, 196 had no matching pool observation and 217 had none for the same human. A terminal branch price and an observed fold at a different node cannot identify what a human would have paid after one of the 49 checks.

### Compare the whole line and attribute the decision

A controlled PLO4 development fixture changed the historical position, number of opponents, stacks and pot. With tens full of deuces and 40 BB behind, the sealed-source chooser bet 20 BB into 20 BB and matched the final 20 BB when raised to 40. Both branches conserved the 100 BB in play. Ten paired fixture arms reproduced all 35 accepted action entries after normalizing seat labels. Five local worker submissions varying stack, position or caller deadline returned legal 20-BB bets without fallback. These fixtures exercise sizing and response to aggression. They give no production latency distribution or human response rate.

For a prespecified modeled opponent folding 2%, calling 8% and raising 90%, switching only between folding and calling the raise changed the modeled payoff by 69.67 BB per opportunity under uniform reach and independence between responses and strength. Compare bet/call, bet/fold and check at the same node before attributing gains to opening aggression.

Decision origins across the frozen cohort were 313,774 policy, 23 fallback, 45 pre-action and 2,899 unknown. Of the 23 fallback decisions, 21 were folds facing a price and two were checks. Sixteen pre-action folds gave up a free check. A later successful exit was recorded for all 16, but no original arming request established that exit caused the fold. The origin and nominal pot alone cannot establish the lost chip value.

In 30,941 frozen decisions the same Horse had already acted on the same street of the same hand: 11,242 preflop, 10,976 flop, 5,666 turn and 3,057 river. Recorded origins were 30,528 policy decisions, 396 unknown, eight pre-actions and nine fallbacks. Repeating an action does not necessarily reopen raising rights. Check the legal menu and accepted decision receipt before attributing a repeated decision to a particular policy.

### What shared memory and style comparisons establish

In 1,317 retained ordinary PLO5 cash hands replayed from empty public memory, 33 observer histories recorded 55 river-call opportunities. Multiple Horses could observe the same action. None of these histories produced a high river-call signal. In a known-style warm-path control, switching from neutral to high stabilized after 29 new river opportunities, and switching back stabilized after 18. Ten opportunities in a sparse 120-hand high phase never stabilized. Use the eligible opportunity count and the original action attribution before acting on a read.

Across 1,059 historical Omaha spots where a Horse could check to close after the same human had called the flop, matching the human, rules, street and closing position left 943 decisions across 280 Horses. Requiring the same effective stack and pot left two. Matching hand rank and board transition eliminated the last comparison. In a separate controlled 576-deal PLO6 development comparison, Grinder and Tricky first differed in size on 61 deals and action on 25. On all 11 first river divergences both bet, with Grinder betting smaller. A style contrast alone cannot rank Horse strength.

### One-paid heads-up range sensitivity

Three terminal PLO4 preflop spots across two Spins and one heads-up SNG had no available additional matched raise. Under the one-paid regular-prize chip-share model, the sign of the chip comparison is preserved when scaled to regular prizes. In one Spin the Horse folded a call of 225 into 465; even a losing call would have retained 210 chips. Four prespecified range models all favored calling there, while two legal individual opponent holdings put the call on opposite sides of break-even. Preserve that uncertainty when extending the result to an actual human.

In 13 separate heads-up one-paid hold'em decisions, ten calls gained chips under uniform holdings and three lost chips. Limiting each compatible holding to twice its uniform weight left only five calls positive under every permitted range. At five times uniform one remained and at ten times none remained strictly positive under every allowed allocation. These ranges and one-paid models cannot establish a multi-place bubble verdict.

## Reviewing the alternatives across all 48 entries

The nine frozen volumes contain 554 candidate flags across 495 distinct decisions. A decision can appear in both a hand-strength review and a full-house rule review. The three comparisons below use the original legal menus and chips still available to match. The action someone eventually took cannot price an alternative.

**Could a call have earned more by raising?** Eleven entries contain 105 river calls, including 68 in high-only PLO4/5/6. Across the 105 menus there were 193 distinct legal raise endpoints indexed by decision. For an intermediate permitted size, subtract the Horse's prior street contribution and call price from the raise-to amount to get the extra investment. At each other seat, cap additional matched chips at that player's remaining contribution capacity over the current price. Chips beyond the largest opposing capacity must return uncalled.

In eight cases a larger wager was legal but no opponent could match another chip. In the remaining 97, 95 high-only holdings could lose to at least one legal opposing hand, and two FLO8 holdings required separate high and low shares. In 37 of the 105 cases an eligible human could match extra chips. Against a single fully matched caller with unchanged fees, each additional chip gains one when ahead and loses one when behind. A raise also changes which hands continue and whether they reraise. The audit establishes no missed absolute-nut value raise in these 105 calls. The independently established nut-straight flat call belongs to a separate screen.

**Was a check a checkback, and what price did a fold decline?** Across another 24 entries, all 242 position-and-inducement checks left a player to act. All 28 checkbacks closed the river. Each of these 270 decisions had a legal bet size. Checking through is a valid showdown baseline for the closing group. In the other group, include the pending players' bets and the Horse's response. All 22 strong folds had a gross call-price comparison, including 16 with a normal raise available. In two short-stack PLO6 pots, reconstructing the contestable amounts gave thresholds of 10.66/84.10 (12.68%) and 13.04/45.89 (28.42%) before rake. A price alone cannot identify the opponent range or establish that a fold lost chips.

**Would the sealed full-house rule have changed the recorded action?** In the remaining 13 entries, the source predicate for checked-to non-bottom boats passed on all 49 original checked hands. Among 108 historical decisions facing a wager, applying the isolated call rule from the sealed revision changes 18 original actions to calls: nine all-ins, seven raises and two folds. The other 90 actions pass through this component. These are offline comparisons against the original decision state. A production behavior claim requires its own accepted action, and a strategic EV verdict requires a priced response range.

### How concentrated can the river bettor's range be before a call loses value?

Across the 18 historical decisions changed to calls by the sealed large-wager component, exact enumeration covered 27,713,130 compatible single-opponent holdings summed across boards. Under uniform holdings, the Horse's heads-up showdown share ranged from 77.43% to 99.34%. A stronger hand was possible at every node, and two decisions actually had multiple opponents. A high share against uniformly dealt cards leaves open how strong the range is after a river bet.

Ten of those 18 were cash hands with one remaining opponent, equal final contributions after a call, and no folded seat with a higher contribution. In these ten, assign the worst possible range for the Horse while limiting each holding's probability relative to uniform. With a conservative upper bound on fees, calling beats folding in all ten at a 2× limit, nine at 5× and six at 10×. A 5× limit means any specific holding may carry at most five times its uniform probability and all probabilities still sum to one. The other eight lacked this exact comparison geometry. To rank a raise, also price how much the opponent can match and which holdings call or reraise.

The two short-stack PLO6 river fold examples illustrate how this changes an individual decision. Each has one live opponent and 4,496,388 compatible six-card holdings after card removal, counting ties. With the captured BBJ disabled and rake caps of 0.31 or 0.62 chips, the fee-adjusted thresholds and shares were:

| Horse's full house   | Share required to call | Share against uniform holdings | Share against full houses or better |
| -------------------- | ---------------------: | -----------------------------: | ----------------------------------: |
| Tens full of queens  |          12.72%–12.77% |                         67.52% |                              55.98% |
| Queens full of fours |          28.61%–28.80% |                         37.31% |                              15.71% |

For tens full of queens, conditioning on opponents who tie or beat it reduces its share to 2.23%. For queens full of fours, moving from uniform holdings to full houses or better moves the call from a gain of 3.85–3.97 chips to a loss of 5.88–5.93 chips relative to folding. The opponent's actual betting range remains unmeasured. These comparisons support different actions under different ranges and do not assign a realized loss to either historical fold.

## Loading and verifying a correction

The [machine-readable entry directory](./HORSE-HUMAN-PLAYBOOK-ENTRIES.json) lists each situation, its candidate counts, owner, required evidence and source qualification routes. The core entries account for 538 flags. Later frozen volumes add 16 flags to those same entries. A decision can carry multiple flags. The frozen manifest maps 48 distinct entries across 14 game, format and speed combinations to their qualification paths. The candidate counts overlap. Each entry still needs its own decision inputs, policy artifact and receipt. None of the 48 entries carries a qualified artifact in the frozen manifest. To assess a later release, use its exact revision and the accepted receipt from the Horse that consumed it.

1. Build the private study using the documented report command. The report emits the machine-readable implementation playbook. Inspect individual records privately using the multi-database query. Select a rule by domain, street, legal alternatives, inputs and evidence gaps. [Study commands and source-owner table](HORSE-HUMAN-STUDY.md)
2. Change the owning engine rule using qualified evidence for its supported domain. Run the original decision through the normal chooser and worker, check the final legal wager, and retain the relevant controls. Use the existing corrective issuer and its signature, selection and holdout requirements where its contract supports the correction.
3. Route shared memory through the domain-scoped public-profile consumer. Admit prior public observations with age and sample support. A private study record cannot supply a live read. Keep ownership of schema installation, consumer deployment and observability explicit. [Consumer delivery record](https://github.com/Smarter-Poker/Smarter-Poker-Club-Arena/pull/9693)
4. Verify the serving revision, installed schema contract, natural populated read and policy execution on the same eligible decision. For wager changes bind the selected and accepted action and amount to the original decision. Reconcile receipts against each distinct Horse on the roster, with explicit counts for Horses awaiting an eligible opportunity. A protected merge, backup certificate or fleet-wide aggregate alone cannot establish individual adoption.

The aggregate edition contains no loadable production authority. The private study supplies candidate evidence. Runtime selection and fleet acceptance depend on the owning engine release and its original receipts.
