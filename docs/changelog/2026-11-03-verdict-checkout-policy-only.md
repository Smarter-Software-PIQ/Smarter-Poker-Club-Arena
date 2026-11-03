# CI verdict checks out only its policy reader

The informational verdict exhausted its unchanged two-minute budget during a full checkout twice on PR 9460; neither report executed. Its checkout now selects only docs/agent-policy with non-cone sparse checkout. The report imports Node built-ins and uses the supplied revision and needs results; all its source and policy-manifest inputs remain selected. Other jobs, deadline, revision expression and failure assertions are unchanged.

The required runner contract asserts the exact checkout and retains the previous whole-job fingerprint after removing only this reviewed checkout configuration. The baseline fails that new assertion. Local qualification also runs the actual report from a policy-only directory. Hosted completion remains a separate delivery proof.
