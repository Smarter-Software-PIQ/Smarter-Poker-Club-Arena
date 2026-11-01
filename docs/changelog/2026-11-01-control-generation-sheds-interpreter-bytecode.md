# 2026-11-01: the active control generation sheds undeclared interpreter bytecode

From 14:52 UTC every engine release died before staging:
`[install-engine-supervisor] FATAL: active deterministic control generation
manifest or filesystem is invalid` (runs 41316608416 and 41320820404). A Python
import of a pinned helper inside the installed generation had written
`<generation>/__pycache__`, so the directory no longer matched its own immutable
file manifest. #9163 stops the import from writing bytecode; it does no host
cleanup, so the polluted generation would have refused every later install.

`install-engine-supervisor.sh` now removes exactly that shape before the manifest
check: a real `__pycache__` directory at the generation root that the manifest
does not declare and that holds only regular `*.pyc` files. A symlink, a nested
directory, any other file name, or a declared `__pycache__` still refuses. Every
declared file is still compared byte-for-byte with the protected commit
afterwards. The fix reaches the host inside the next release request, because the
intake installs the control generation from the target's own tree.

Test: `tests/operations/engine-control-activation.py` refuses a `__pycache__`
holding a non-bytecode file or a subdirectory, then sheds pure bytecode and
activates the newer generation.
