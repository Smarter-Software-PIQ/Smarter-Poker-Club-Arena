# Native build failure attribution

The private native qualifier now identifies failures using one closed command site:
batch compile, batch execution, D3 capability, runtime npm or runtime hydrate.
Existing stage, first failure, exit status, output counts and deadlines remain.
No argv, paths, stderr, SQL or identifiers are published. Unknown compiler causes
remain unknown; no compiler warnings are suppressed or presumed fixed.

A real child-process regression checks all allowed sites, first-failure retention,
invalid-site refusal and omission of private command/output bytes.
