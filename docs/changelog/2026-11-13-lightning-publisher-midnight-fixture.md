# Stats pulse tests own their clock

Publication 43530805403 failed two unchanged Stats pulse tests at midnight UTC. Their fake clock inherited the real runner time at 23:59:xx, so advancing one or two poll intervals also crossed the real calendar boundary. The hook correctly emitted a midnight refresh, contradicting assertions intended to isolate pulse changes and polling errors.

Set the ordinary cases to a fixed local noon in the existing beforeEach. The explicit visible and hidden midnight cases still set 23:59:59 and retain their full assertions. Both reported failures reproduce with the inherited fixture clock fixed to 23:59:59; the complete hook suite passes with noon. No product code, timing rule, assertion or release gate changes. This is the demonstrated publication blocker of the Lightning browser verification delivery.
