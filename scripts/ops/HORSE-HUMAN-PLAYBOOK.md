# Horse playbook for decisions against humans

The study cutoff is **07:20 UTC on November 7, 2026**. Five private volumes contain 42,099 retained histories, 36,312 eligible hands and 311,025 Horse decisions. A hand qualifies through eligible human participation. For advice about a human opponent, check that a human still had a stake or could respond at the decision. Original Horse cards remain missing on 9,157 decisions. Those decisions can establish public action, price and legality. Their hand strength remains unknown.

## Omaha coverage

Counts are Horse decisions. Lightning counts are part of the cash column.

| Variant | Cash | Of which Lightning | Tournament |
| --- | ---: | ---: | ---: |
| PLO4 | 31,391 | 8,689 | 4,453 |
| PLO5 | 58,985 | 7,187 | 1,117 |
| PLO6 | 6,080 | 660 | 1,704 |
| PLO8 | 679 | 0 | 3,293 |
| FLO8 | 906 | 0 | 0 |

Keep the hole-card count, betting structure, board count, ante payer and speed format in the decision key. In Omaha exactly two hole cards and three board cards make each hand. For split pots evaluate high and qualifying low separately, including scoops, ties and quartered pots. In FLO8 use the legal fixed bet sizes and raise caps. The retained high-low river analysis enumerated opposing holdings on 408 single-board decisions and one double-board decision. Shared cards constrain the two boards. These exact physical comparisons do not establish an opponent's betting range.

## Decisions to change or preserve

| Situation | Action and evidence |
| --- | --- |
| Checked-to river, middle or top full house | In high-only single-board play with a human able to respond, Horses checked 22 of 104 opportunities. Regular PLO5 cash supplied 16 checks in 57 opportunities. Route legal value bets through the final wager rules. Identify bottom full and trip-board under-full separately. Preserve the opening-check distinction and require a legal bet. [Checked-to correction](https://github.com/Smarter-Poker/Smarter-Poker-Club-Arena/pull/9766) |
| Facing a pot-sized or bigger opening river bet | Among 25 beatable non-bottom boats on non-trip boards, Horses called nine times, folded once, raised six times and shoved beyond the call price nine times. Take the legal stack-capped call for the qualifying hand. Preserve separate rules for unbeatable hands and trip-board under-fulls. [Large-wager correction](https://github.com/Smarter-Poker/Smarter-Poker-Club-Arena/pull/9772) |
| Near-nut flush checked to on the river | A PLO5 check with only one superior legal opposing hole pair reproduced in the chooser. The correction selects a value bet in that fixture and preserves the existing pot bets in two controls. Its protected merge followed the corpus cutoff. [Near-nut flush correction](https://github.com/Smarter-Poker/Smarter-Poker-Club-Arena/pull/9826) |
| Turn after a human called the flop | In 46 qualifying spots, Horses bet 42 times, shoved twice and checked twice. Both checks were top full houses in Lightning cash with a BB ante. One was the current nuts in PLO4. Assess turn bets with a river still to come. Record redraws and the same caller’s ability to continue. |
| Lightning and BB ante | Reconstruct the ante contribution, live blind, pot, effective stacks and legal minimum and maximum before comparing sizes. Track Lightning and BB ante independently. Use a matched domain when estimating calls, raises or folds. The two turn checks above are evidence for a specific value correction; they cannot set a universal Lightning aggression multiplier. |
| River bluff with a nut blocker | In 15 opportunities with one pair or less, a lone nut-flush blocker and a human able to wager, Horses opened with two bets and two jams. Eleven checked. For each legal size compare fold gains and called outcomes to checking, allowing for showdown share, higher hands removed, worse hands blocked, effective stacks and costs. Bound uncertain response frequencies. The 15 actions establish actual bluff candidates, not a profitable target frequency. |

## Tournament pressure

Across 35 one-paid events, surviving-entry and payout evidence confirmed two players remained. For 38 terminal call-versus-fold comparisons the chip-proportional heads-up regular-prize model gives the pot-odds threshold. In one PLO4 flop spot the human’s final 10 went into a 430-chip pot. Against every legal human holding the Horse retained at least 6.22% pot share, above the 2.27% price. Calling is supported even without estimating how often that human bluffs.

The study also identified 771 multi-place MTT bubble decisions. For a reconstructed 13-player event with 11 paid places, a 22.70% chip threshold became an estimated 32.98%–36.69% outright-win threshold for regular prizes under the field-stack and concurrent-pot bounds. Model ties as split outcomes. The opposing bettor was another Horse after the humans folded. Mystery-bounty continuation was unknown. Use field-wide stacks, actual payouts, position relative to the bubble, and any bounty or satellite terms before assigning tournament utility.

## Loading and verifying a correction

1. Build the private study using the documented report command. The report emits the machine-readable implementation playbook. Inspect individual records privately using the multi-database query. Select a rule by domain, street, legal alternatives, inputs and evidence gaps. [Study commands and source-owner table](HORSE-HUMAN-STUDY.md)
2. Change the owning engine rule using qualified evidence for its supported domain. Run the original decision through the normal chooser and worker, check the final legal wager, and retain the relevant controls. Use the existing corrective issuer and its signature, selection and holdout requirements where its contract supports the correction.
3. Route shared memory through the domain-scoped public-profile consumer. Admit prior public observations with age and sample support. A private study record cannot supply a live read. Keep ownership of schema installation, consumer deployment and observability explicit. [Consumer delivery record](https://github.com/Smarter-Poker/Smarter-Poker-Club-Arena/pull/9693)
4. Verify the serving revision, installed schema contract, natural populated read and policy execution on the same eligible decision. For wager changes bind the selected and accepted action and amount to the original decision. Reconcile receipts against each distinct Horse on the roster, with explicit counts for Horses awaiting an eligible opportunity. A protected merge, backup certificate or fleet-wide aggregate alone cannot establish individual adoption.

The aggregate edition contains no loadable production authority. The private study supplies candidate evidence. Runtime selection and fleet acceptance depend on the owning engine release and its original receipts.
