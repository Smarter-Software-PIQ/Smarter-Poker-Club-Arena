# Horses stop paying off a passive player's raise

**This is live on release.** Both changes sit behind switches that are ON in production (raise respect and the
fold-rate discount). They take effect for every Hold'em Horse at the release that carries this change. With the
switches off nothing changes.

## The hand

In a cash hand a Horse bet the turn with two pair on a board that had just brought four cards to a straight. A
passive regular check-raised the turn to four times the bet, leaving himself 0.13 of the pot behind. The Horse
called, then called the rest on the river, and was shown the top straight. A good player folds that turn or puts it
all in.

Rebuilt on the serving code, the Horse calls that turn on every run with every style option on. The options did not
reach the hand:

- Raise respect covers one pair and worse, and stands down when little is left behind. Two pair with a sliver behind
  was outside it twice over.
- The raise was priced like any bet. The Horse read its two pair as a 62 percent favourite. Against the hands a
  passive player raises that turn with, it wins between one time in fourteen and one time in five.
- The call was priced alone (31 percent). The river money was already part of the decision (35 percent).

## What changes: a passive player's turn or river raise is read as value

It applies in cash games, heads-up, on the turn and the river, when a Horse has bet, is raised, and holds two pair or
worse (with no real draw on the turn).

The opponent must be credibly passive on his own record:

- he bets and raises after the flop clearly less than the Horses do; a tight preflop record alone is not enough;
- he has had at least 20 chances to raise on the turn and river, and at least 8 on the street in question;
- the Horses' own raise rate on that street is known.

Then the Horse makes a second estimate of its hand against a value raise (two pair or better about nine times in
ten) and blends it with its usual estimate:

- by his raise rate: full weight while he raises that street no more often than the Horses do, falling to nothing at
  twice their rate;
- by the size of the raise: full weight from three times the bet, half for a minimum raise.

The blended estimate decides only when it falls below the price actually laid. Otherwise the decision is exactly
what it was.

## What changes: the whole commitment is priced

On the turn, when calling would leave the raiser a quarter of the pot or less, the river call is already part of the
decision. A hand whose blended estimate does not cover the whole commitment folds. A hand that continues puts the
rest in at once instead of calling.

That overrides two existing rules that would have flat-called: the plan to call once and never escalate, and the
rule that a raised weak made hand does not re-raise. Both exist to stop a hand building a pot against a deeper
stack. Here there is no deeper stack: what is left is the river call the hand has already accepted.

## What it does in practice

Against a made-up passive regular (24 runs each):

| Spot                                                                          | Before  | Now        |
| ----------------------------------------------------------------------------- | ------- | ---------- |
| The hand above: weak two pair, four-straight board, 4x raise, 0.13 pot behind | call 24 | fold 24    |
| Top two pair, same board and raise                                            | call 24 | rest in 24 |
| Top two pair, same raise, a real stack behind                                 | call 24 | call 24    |
| One pair, minimum raise at an 18 percent price, dry board                     | call 24 | call 24    |
| Bottom two pair, minimum raise, dry board                                     | call 24 | call 24    |
| Weak two pair, river check-raise to more than three times the bet             | call 24 | fold 24    |

## Where it never applies

- The flop.
- Tournaments. The value estimate is new and unproven, and tournament decisions are priced for survival, which it
  does not carry.
- Three of a kind or better.
- A player the Horses know nothing about, a player with too few raise chances on record, a balanced or aggressive
  player, a measured bluffer, and a player whose recent hands show him raising.
- It never makes a Horse continue with a hand it folds today.

## The discount on old fold figures now reaches every place that reads them

Cash profiles built before the showdown-memory repair recorded a player's folds without his calls, so they overstate
how often he folds. The fold-rate option holds back "bluff this player more" on such a profile until enough new
evidence is in. It did that in one place. Three others read the same kind of figure without it:

- The newer opponent read raises bluffing by 1.2 to 1.5 times against a player whose stored fold-to-bet is clearly
  high. It now holds that increase back under the same rule.
- The same read also value-bets such a player thinner. That cut is held back with it.
- The river bluff asks whether the opponent is a folder, and asked without the option, so a player with an old
  profile could still be bluffed on the river at the full rate. It now asks with it.

Bluffing less against a player who calls a lot is untouched.

## How to watch it

Two new counters: `style_value_raise_respect_seen` (the value estimate turned a call into a fold) and
`style_commitment_priced_seen` (the whole-commitment price turned a call into a fold or into the rest going in).

## Not yet known

- The value-raise shares come from one reviewed hand and a count of the hands that raise there. They have not been
  measured in a league or over live results.
- On the river the Horses' own raise rate is often measured on too few hands to count, so the river part will engage
  less often than the turn part.
- A raise in a pot with two or more opponents still in is not covered.
