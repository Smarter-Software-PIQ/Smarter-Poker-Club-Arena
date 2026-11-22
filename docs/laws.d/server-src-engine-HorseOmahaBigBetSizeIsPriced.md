# server/src/engine/HorseOmahaBigBetSizeIsPriced.law.test.ts

`omahaBigBetSizeIsPriced` (default OFF, PLO4/PLO5 cash only) replaces `#18` (`omahaBigBetIsPotShare`) with continuous pot-share + lifetime public HUD aggressor strength (no 20 BB chip cliff or 0.70 pot-share step) and EV-priced limped-pot bet sizing (resizing upward only when `EV(target) > EV(current) + 0.02 * pot`), with zero person-vs-Horse key, zero unshown-card access, and byte-identical behavior when OFF or in PLO6/PLO8/hold'em/tournaments/multi-board/bomb pots/fixed-limit.
