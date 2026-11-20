#!/usr/bin/env bash
# Builds the harness bin directory: every host tool the rolling block calls
# resolves to fakeworld.py or a no-op shim.
set -euo pipefail
bin="$1"; here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$bin"
for tool in docker curl seal engine-up systemctl caddy dbproof; do ln -sf "$here/fakeworld.py" "$bin/$tool"; done
printf '#!/usr/bin/env bash\nwhile [ "${1:-}" != "" ] && { [ "${1#-}" != "$1" ] || [[ "$1" =~ ^[0-9]+s?$ ]]; }; do shift; done\nexec "$@"\n' > "$bin/timeout"
printf '#!/usr/bin/env bash\nexit 0\n' > "$bin/flock"
printf '#!/usr/bin/env bash\nexit 0\n' > "$bin/sleep"
chmod +x "$bin/timeout" "$bin/flock" "$bin/sleep"
