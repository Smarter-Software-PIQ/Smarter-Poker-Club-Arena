# server/src/engine/AV78CommittingBluffRaiseIsPriced.law.test.ts

`v78NoCommittingBluffRaiseIsPriced` (dark, default OFF, `OPTION_SWITCH_REFUSED`, zero SQL migrations) replaces the blanket 40%-of-stack V78 bluff-raise veto in single-board 2-card NLH with deterministic public-info EV pricing over `holdemEmpiricalPriors.ts` and `heroBubbleFactor`; OFF / unset / false is byte-identical, and Omaha, Short Deck, Fixed Limit, multi-board, and bomb pots remain untouched even when ON.
