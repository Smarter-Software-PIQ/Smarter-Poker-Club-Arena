# tests/the-format-card-prints-the-template-floor.law.test.ts

The Classic and Lightning Games format cards in the New Cash Game flow print
the VPIP floor that `fn_cash_template_defaults` answers, never a number typed
by hand.

On 2026-11-19 the Classic card still promised "50% Minimum VPIP" for PLO5 and
PLO6, two days after the owner lowered that floor to 40 (2026-11-17, migration
`20261118004324`). The card sentences now print `CLASSIC_PLO5_PLO6_VPIP_FLOOR`
and `LIGHTNING_VPIP_FLOOR`, and the selected card prints the floor the database
answered for that template and variant once it has loaded.

The law reads the newest definition of `fn_cash_template_defaults` in any
migration, works each template's floor out of its SQL `CASE` arm by arm, and
requires both client constants and every card sentence to equal it: Classic
PLO5 and PLO6 at the constant, every other Classic game at 0 (the card says
"No Minimum VPIP"), every Lightning variant (nlh, plo4, plo5, plo6) at the
Lightning constant. A migration that moves a floor without the card fails here.
It also pins that a loaded answer for another template or variant never leaks
onto a card and that `cashGames.ts` types no `N% Minimum VPIP` literal.
