#!/usr/bin/env bash
# SHIFT-LEFT SERVER DOCKERFILE BUILD & NATIVE ADDON (hist215) SMOKE CHECK.
#
# Builds the exact production `server/Dockerfile` with BuildKit layer caching
# on pull requests touching `server/`, then runs an offline (`--network=none`)
# smoke probe inside the built container proving:
#   1. Compiled ESM JS (`dist/index.js` + `dist/engine/GtoPublicHist215Features.js`)
#      exists and loads cleanly inside the production Node 22 slim image.
#   2. Native `public_hist215_wtl.node` addon loads and executes a deterministic
#      `exactRootWTL` calculation with exact W/T/L conservation.
#   3. Native `legacy-census.node` addon loads cleanly inside the image.
#   4. Baked `GIT_COMMIT_SHA` and `/app/release-evidence` are present.
set -euo pipefail

SHA="${1:-}"
CACHE_DIR="${2:-}"
IMAGE_TAG="club-arena-engine:pr-smoke"
BUILDER="ca-server-pr-smoke"

if [ -z "$SHA" ]; then
  echo "FATAL: commit SHA argument is required" >&2
  exit 1
fi
if [ -z "$CACHE_DIR" ]; then
  echo "FATAL: BuildKit cache directory argument is required" >&2
  exit 1
fi

cleanup() {
  docker image rm "$IMAGE_TAG" >/dev/null 2>&1 || true
  if [ -n "${CACHE_NEW:-}" ] && [ -d "${CACHE_NEW:-}" ]; then
    rm -rf -- "$CACHE_NEW"
  fi
}
trap cleanup EXIT

if ! docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
  docker buildx create --name "$BUILDER" --driver docker-container >/dev/null
fi
docker buildx inspect "$BUILDER" --bootstrap >/dev/null

CACHE_NEW="${CACHE_DIR}.new.$$"
mkdir -p "$CACHE_DIR" "$CACHE_NEW"

BUILD_ARGS=(
  buildx build
  --builder "$BUILDER"
  --load
  --progress plain
  --build-arg "GIT_COMMIT_SHA=$SHA"
  --cache-to "type=local,dest=$CACHE_NEW,mode=max"
  -f server/Dockerfile
  -t "$IMAGE_TAG"
)

if [ -f "$CACHE_DIR/index.json" ]; then
  BUILD_ARGS+=(--cache-from "type=local,src=$CACHE_DIR")
fi

BUILD_ARGS+=(server)

docker "${BUILD_ARGS[@]}"

# Rotate BuildKit local cache atomically so actions/cache persists the fresh layers.
rm -rf -- "$CACHE_DIR"
mv "$CACHE_NEW" "$CACHE_DIR"

# Run fast offline container smoke probe against the exact production image.
docker run --rm --network=none -e "EXPECTED_SHA=$SHA" "$IMAGE_TAG" \
  node --input-type=module -e '
import fs from "node:fs";
import { createRequire } from "node:module";

const expectedSha = process.env.EXPECTED_SHA;
if (process.env.GIT_COMMIT_SHA !== expectedSha) {
  throw new Error(`GIT_COMMIT_SHA mismatch: got ${process.env.GIT_COMMIT_SHA}, expected ${expectedSha}`);
}

const indexStat = fs.statSync("/app/dist/index.js");
if (!indexStat.isFile() || indexStat.size <= 0) {
  throw new Error("/app/dist/index.js missing or empty");
}
if (!fs.existsSync("/app/release-evidence/README.md")) {
  throw new Error("/app/release-evidence/README.md missing");
}

// Verify compiled ESM engine module loads cleanly in the production container.
const histMod = await import("/app/dist/engine/GtoPublicHist215Features.js");
if (typeof histMod.encodePublic215Features !== "function") {
  throw new Error("encodePublic215Features export missing from compiled ESM output");
}

// Verify native public_hist215_wtl.node loads and executes exactRootWTL cleanly.
const req = createRequire("/app/package.json");
const histNative = req("./native/build/public_hist215_wtl.node");
if (typeof histNative?.exactRootWTL !== "function") {
  throw new Error("public_hist215_wtl.node missing exactRootWTL export");
}
const weights = Array(1326).fill(0n);
weights[100] = 1000n;
weights[200] = 2000n;
const res = histNative.exactRootWTL([0, 1], [2, 3, 4, 5, 6], weights);
const cur = res.current.map(BigInt);
const term = res.terminal.map(BigInt);
if (cur[0] + cur[1] + cur[2] !== cur[3] || cur[3] !== 3000n) {
  throw new Error(`public_hist215_wtl current conservation failed: ${JSON.stringify(res)}`);
}
if (term[0] + term[1] + term[2] !== term[3] || term[3] !== 3000n) {
  throw new Error(`public_hist215_wtl terminal conservation failed: ${JSON.stringify(res)}`);
}
if (res.terminalRunouts !== 1 || res.opponentCompatibleCombos !== 2) {
  throw new Error(`unexpected exactRootWTL counts: ${JSON.stringify(res)}`);
}

// Verify native legacy-census.node loads cleanly inside the production container.
const legacyNative = req("./native/legacy-census/legacy-census.node");
if (!legacyNative || typeof legacyNative !== "object") {
  throw new Error("legacy-census.node failed to load");
}

console.log(JSON.stringify({
  ok: true,
  sha: expectedSha,
  distIndexBytes: indexStat.size,
  hist215Native: { terminalRunouts: res.terminalRunouts, opponentCompatibleCombos: res.opponentCompatibleCombos },
  legacyCensusExports: Object.keys(legacyNative).sort(),
}));
'
