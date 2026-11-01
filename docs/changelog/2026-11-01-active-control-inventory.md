# Read the failed control installation without changing its generation

The failed intake 41316608416-1 reported an invalid active deterministic control
manifest/filesystem. The protected integrity-audit observation transport now
accepts one closed request for that intake and b194c1db64dd9de66e123245f960598dac150625.
It reads the canonical active generation, returning bounded manifest predicates,
entry names/types/modes and digests compared with its protected Git source. It
executes no generation code, opens no Inspector, reads no environment file and
changes no host state. Unknown/raced/oversized observations remain refused.
The strict installation guard remains unchanged.

The withdrawal helper's authoritative own_thaw import now disables bytecode
writes and restores the original Python flag on success or failure. A local
real-filesystem regression demonstrates the old dynamic import creates an extra
**pycache** directory and the corrected import preserves the original entries.
This is source-qualified prevention, not a claim that bytecode caused the host
failure. The actual closed host inventory remains necessary to identify it.

The isolated Git fixture and fixed-repository inventory Git reads discard inherited
Git routing/configuration variables. A private poisoned sentinel verifies that
its refs, index, configuration, objects and working files remain unchanged.
