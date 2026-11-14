# tests/cutover-spectator.law.test.ts

Requires an authenticated spectator witness to match the original sealed receiver, runtime instance, freeze, thaw and committed hand. Keeps observation and fixture cleanup independent of release authority. Admits a spectator that attaches during the predecessor's announced last hand, names one that arrives after the freeze began NOT OBSERVED (late), and uploads a sealed-spectator artifact only for a matched witness.
