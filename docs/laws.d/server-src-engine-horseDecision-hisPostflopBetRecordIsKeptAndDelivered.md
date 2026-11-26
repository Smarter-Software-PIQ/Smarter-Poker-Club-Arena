# server/src/engine/horseDecision/hisPostflopBetRecordIsKeptAndDelivered.law.test.ts

How an NLH opponent answers a postflop bet (raise share facing a bet, by street) and what his called, shown turn and river bets were (air share by size; only cards shown at showdown, never a mucked or folded hand) is kept durably in horse_exact_profiles.postflop_bets and reaches the decision on the path live decisions take, carried in read frame v22. No record, a null record or a malformed one reads null and leaves the frame byte for byte as before; a non-NLH decision never carries it.
