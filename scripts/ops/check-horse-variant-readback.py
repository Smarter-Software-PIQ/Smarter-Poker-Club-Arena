"""Check the fixed November 10 four-domain study fixture after CLI readback."""
import hashlib
from pathlib import Path
import sys

expected = '2132b8389cb3d8d3516b33d1e505c9d1706ed68981ce81376da3c55e675f6a4d'
if hashlib.sha256(Path(sys.argv[1]).read_bytes()).hexdigest() != expected:
    raise SystemExit('fixed-input variant readback differs')
