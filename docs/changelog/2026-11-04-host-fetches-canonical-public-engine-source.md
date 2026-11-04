# Host releases fetch the canonical public repository

The receiver passed host SSH admission but its source fetch failed with GitHub public-key refusal before staging or activation. The repository is public; fetching its protected main does not require a host deployment key.

All three host fetch sites now use the fixed canonical HTTPS repository, with unchanged source locks, timeouts, main refspec and target/control ancestry checks. The stored origin and credential configuration are not changed. Fetches suppress inherited Git credential/configuration injection, require verified HTTPS without redirects, and refuse local URL rewrites, includes or HTTP overrides. Runner-authenticated Git operations remain unchanged.

An isolated real-Git fixture executes the actual three maintained commands, verifies exact main and unrelated-history refusal, preserves the original SSH origin/configuration, ignores hostile global rewrites, refuses local rewrites/headers/includes before transport, and proves a failed source does not advance main. Production staging and installation remain separate verification requirements.
