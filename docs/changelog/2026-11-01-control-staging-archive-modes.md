# Produce protected control staging helpers without group write

The owning 0045 receiver accepted durable intake and then refused the incoming
quarantine helper before execution. Its unchanged guard failed its regular-file,
UID0, nonwritable metadata assertion; historical host metadata was not captured.
The actual producer archives this helper as UID0/mode0664 and extracts it as root,
which independently reproduces the group-write mismatch against that guard.

Set `tar.umask=0022` only on the existing protected producer's `git archive`
command. Archive content and root ownership are preserved; helper files arrive
mode0644 and executable scripts retain mode0755. Repository/global configuration
and shared working files are untouched. The installer, strict generation
validator, trust-before-execution checks and qualified quarantine are unchanged.
There is no new execution snapshot, cleanup mechanism or release operation.

An isolated native fixture commits the actual maintained installer/helper bytes,
executes the producer archive command and native tar extraction, and checks the
unchanged verifier. The old archive reproduces refusal; the corrected producer
passes. Tampered, symlinked, writable and oversized helpers still refuse without
rewriting them; private repository configuration cannot change the command mask.
Mac qualification uses its fixture owner and explicit tar permission preservation
to model root extraction. Required Linux qualification runs the actual UID0 guard
and exact root extraction flags in one disposable runner process; no skips or
production paths are accepted. Local checks do not certify live installation.
