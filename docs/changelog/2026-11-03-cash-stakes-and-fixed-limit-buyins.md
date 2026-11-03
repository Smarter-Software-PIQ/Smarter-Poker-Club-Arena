# Cash Stakes And Fixed-Limit Buy-Ins

Owner November 3: horses may play NLH and PLO through 1/2 blinds; FLH/FLO8 may play through 5/10 blinds. The existing excluded variants, activity curve and tournament rules remain unchanged. Requested fixed-limit levels 1/2, 2/5 and 5/10 mean small/big blinds; the established displayed small-bet/big-bet convention remains.

Fixed-limit has a minimum buy-in and no maximum. The engine represents that ceiling as NULL, applies a finite requested top-up without a table cap, and passes NULL to the existing pending add-on and hand-settlement owners. No-limit and pot-limit retain their finite ceilings. Existing 1/2 horse refill behavior retains its finite voluntary entry/rebuy target (200BB or the configured minimum when higher), independently of the NULL table ceiling.

The migration changes the maintained template, ruleset projection, table opener, managed-game update owner, stake guard and horse admission helper. It sets active fixed-limit configuration to NULL maximum and creates the requested Classic levels through the existing game owner for hosts already operating fixed limit. Closed historical tables are preserved. Wallets, live seat stacks and settled hands are unchanged.

Regression coverage includes actual engine add-on behavior above 200BB, finite non-limit ceilings, exact horse eligibility boundaries and isolated SQL qualification. Database installation uses the protected-main applier. Engine activation uses the existing certified release transaction; merge or staging alone is not live verification.
