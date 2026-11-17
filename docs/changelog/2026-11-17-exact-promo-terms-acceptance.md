# Club Arena requires the exact reviewed terms revision

The pre-play gate requires revision `2026-11-16-87a8e57589a09136` and a valid persisted acceptance timestamp. A timestamp for older terms does not count as renewed acceptance. The public acceptance request sends this revision and opens play only after the endpoint confirms the same persisted revision and timestamp; unknown reads and failed acknowledgements retain the existing refusal flow.

The existing isolated browser journey verifies the actual acceptance response against a fresh canonical profile read and retains only a sanitized revision/timestamp receipt. Unit regressions cover legacy acknowledgements, wrong revisions, invalid timestamps and the exact successful request/response.

Publication prerequisite: the revision column and service-only acceptance RPC must be installed, and the World Hub exact-revision writer must be live before this client merges. This draft does not activate Promo Play Through or promote historical acceptance.
