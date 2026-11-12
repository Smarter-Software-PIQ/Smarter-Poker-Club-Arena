# The V87 validation test drives the real time bank

The V87 Hold'em validation test failed now and then in CI with "expected 'raise'
to be 'call'" on its third step, the tournament time-bank tank. The test was at
fault, not the engine.

What was wrong. The step wrote the Horse's hole cards (QQ) onto a copy of the
hand state, so the hand kept whatever cards had been dealt. The Horse's
scripted answer was a call. When the deal happened to give it QQ, KK, AA or AK
(about 1 hand in 40), the engine's last check before acting, the rule that
premium hands never just call preflop, correctly turned the call into a 4-bet.
That is the raise CI saw. It was random luck of the deal, not the order the
tests ran in or how busy the machine was. The step also called a time-bank
method that does not exist, so it never entered a time bank: the Horse simply
acted on an ordinary clock that the test never started.

What the test now proves. The step pins JJ on the hand itself and enters the
turn the way a real turn starts, which starts the 8 second clock and asks the
Horse for its decision. The Horse plans a long tank. The clock runs out, the
engine spends a real time bank on the same turn, and the Horse's pending
decision survives that hand-over. It then acts inside the 20 second bank. The
test checks there was exactly one decision request for that seat, that the
action taken was that request's own call, and that it landed after the clock
ran out and before the bank ended. The scripted answer now only answers that
seat's request, so a stray request elsewhere can no longer use it up.

If the engine ever cancels the pending decision when the bank takes over (the
bug fixed earlier as F06), this test now fails.

The stale-turn step now puts its cards on the hand itself and always checks
that the late seat 5 answer is refused at the response fence (seat moved),
retired as turn abandoned, and that seat 5's only recorded action is its fold.

A new test, ALateFastAnswerAfterItsSecondLookIsRetired, drives one real Horse
turn through a second look and proves only one answer acts: a deep answer that
flips the call retires the fast answer as second look replaced, and a deep
answer with a stale fence, or one that arrives after the turn already acted, is
retired without acting.

This reproduces the observed qualification failure as a fixture defect; it does
not show that every production timing race is impossible.

Test-only change. No engine code changed.
