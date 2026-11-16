# holdemPersonaPostflop (branch holdem/next-n6-persona-completion-20261115; pull request number at push)

This option is DEFAULT OFF (`opts.holdemPersonaPostflop === true`). This file is the evidence gathered so far and what is still owed.

## Mechanism

In two-card no-limit hold'em three existing V87 postflop mixes read the Horse's persona (HorseHoldemPersonaPostflop): the out-of-position flop check-trap and the flop check-raise into a stabber use the persona's trapFrequency over its model mean in place of the fleet 0.42 (at most 0.72); the turn takeaway, a stab at a range that checked twice, is scaled by archetype (Nit Hunter 1.30, LAG 1.00, TAG 0.9375, Tricky 0.90); the heads-up in-position dry-flop range continuation bet is scaled by archetype (LAG 1.12, TAG 1.00, Tricky 0.94, Nit Hunter 0.88). This is persona promise P17 (the check-raise trap reads the persona) and the stab half of P21 (the Nit Hunter stabs capped checked ranges).

## Input fidelity

Reads only the Horse's own id (the persona is a hash of it) and, for the tight guard, the existing style read of the opponents asked without style accounting. No new draw: every site compares its own per-spot unit as before, so fast look, deep look, retry and replay agree by construction.

## Value

Not measured. Owed: a declared paired evaluation and a live read against people.

## Continuation

No new line: each site's existing continuation plan (check-raise, barrel plan after the takeaway, the range bet's sizing) is unchanged.

## Reach

The four sites named above, flop and turn only. League card `cash6_holdem_persona_postflop` (not yet run).

## Scope

`gameVariant === 'nlh'`, two cards, V87 on. Never Omaha, short deck, fixed limit, hi-lo or All-In-Or-Fold. Cash and tournaments alike. The two bluffing scales (range bet, stab) are held at 1 or below against an opponent the style read classifies as tight.

## Visibility

Ledger flag `holdemPersonaPostflop`; receipts `holdem_persona_postflop_trap_seen`, `holdem_persona_postflop_stab_seen`, `holdem_persona_postflop_cbet_seen` and `holdem_persona_postflop_check_raise_seen` (one per site the scales act at).

## Limits

Fixed archetype points, not solved. The fleet average is preserved under the id model (share-weighted mean 1), not per table. Off is byte-identical: nothing is read unless the option is true.

## Owner-ordered activation (2026-11-15)

Owner, 12:10 Chicago (verbatim, recorded in plo-handoff-review-01a1cbbd/river-raise-59401453/OWNER-TEXT-20261115-1000-PLO-CHAT-VERBATIM.md): "NO YOU NEED TO LAUNCH EVERYTHING EVERY SINGLE THING WE IMPROVED AND BUILT AND TALKED ABOUT... GET IT ALL LAUNCHED AS SOON AS POSSIBLE FOR PLO AND HOLDEM, EVEN IF IT TAKES A COUPLE MORE HOURS TO GET IT DONE, IT HAS TO BE ALL TOGETHER, ACTIVATED, THEN WE CAN DO REAL TIME TESTING AGAINST HUMANS AND INSIDE YOUR TEST ARENA". 12:14: "IT DOESN'T NEED TO BE TESTED BY YOUR SIMULATION. JUST FULLY BUILT AND READY TO BE TESTED AGAINST HUMANS AND YOUR SIMULATION AFTER ITS LAUNCHED, ACTIVATED AND TURNED ON".

Status: OWNER-FORCED. Evidence rows above that say "not measured" are NOT MET; a live read against people is owed after activation. The source default stays OFF. The option is switched ON by a live switch row (fn_ca_horse_option_switch_set) once the build carrying it serves, and switched OFF in about 30 seconds by its owner (Hold'em Strategy) if harm is established; clearing the row returns it to the source default.
