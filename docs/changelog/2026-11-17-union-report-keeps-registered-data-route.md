# Union Report Keeps Its Registered Data Route

Opening Report from a union house club's Data page passed through UUID URL normalization, which redirected the advanced report into an unregistered union route. Keep that report on the existing guarded Club Data route and canonicalize its club slug there, preserving the selected dates and fragment. Other union navigation retains its existing behavior.

The existing SlugEnforcer component tests cover plural and legacy singular club URLs, date and fragment preservation, and a house club without a slug. The three new cases failed before the source correction.
