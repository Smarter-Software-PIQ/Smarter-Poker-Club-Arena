#!/usr/bin/env bash
# Graphify bootstrap for Club Arena (advisory code knowledge graph).
#
# Installs the pinned Graphify CLI, builds a code-only graph with every LLM
# backend disabled, and stamps the source revision so a graph can be matched
# to the checkout it describes. Safe to re-run. See CLAUDE.md section 14.
#
# Usage (run from the repository root):
#   scripts/dev/graphify-bootstrap.sh            install if missing, build if missing or stale
#   scripts/dev/graphify-bootstrap.sh --check    report whether the graph matches HEAD (exit 0 = fresh, 1 = stale/missing)
#   scripts/dev/graphify-bootstrap.sh --refresh  incremental refresh after code changes
#   scripts/dev/graphify-bootstrap.sh --rebuild  full rebuild
#
# Environment:
#   GRAPHIFY_STORE  optional directory that holds the graph outside the checkout
#                   (the Mac uses the authorized SSD). graphify-out becomes a symlink.
set -euo pipefail

GRAPHIFY_VERSION="0.9.105"
MODE="${1:-ensure}"
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# Code-only, local extraction: never let an API key in the environment select an LLM backend.
export GRAPHIFY_BACKEND=none
export GRAPHIFY_QUERY_LOG_DISABLE=1
export PATH="$HOME/.local/bin:$PATH"

revision() {
  # HEAD plus a hash of uncommitted changes, so further edits make the graph stale.
  local sha dirty=""
  sha="$(git rev-parse HEAD)"
  if ! git diff --quiet HEAD -- . ':(exclude)graphify-out' 2>/dev/null; then
    dirty="+dirty-$(git diff HEAD -- . ':(exclude)graphify-out' | shasum -a 256 | cut -c1-12)"
  fi
  printf '%s%s\n' "$sha" "$dirty"
}

ensure_cli() {
  if command -v graphify >/dev/null 2>&1 && graphify --version 2>/dev/null | grep -q "$GRAPHIFY_VERSION"; then
    return 0
  fi
  if command -v uv >/dev/null 2>&1; then
    uv tool install --force "graphifyy==$GRAPHIFY_VERSION" >/dev/null
  elif command -v pipx >/dev/null 2>&1; then
    pipx install --force "graphifyy==$GRAPHIFY_VERSION" >/dev/null
  else
    python3 -m pip install --user --break-system-packages -q "graphifyy==$GRAPHIFY_VERSION" 2>/dev/null \
      || python3 -m pip install --user -q "graphifyy==$GRAPHIFY_VERSION"
  fi
  graphify --version | grep -q "$GRAPHIFY_VERSION" || { echo "graphify $GRAPHIFY_VERSION install failed" >&2; exit 1; }
}

link_store() {
  [ -n "${GRAPHIFY_STORE:-}" ] || return 0
  local key target
  key="$(basename "$ROOT")-$(printf '%s' "$ROOT" | shasum -a 256 | cut -c1-12)"
  target="$GRAPHIFY_STORE/$key/graphify-out"
  mkdir -p "$target"
  if [ -L graphify-out ]; then
    [ "$(readlink graphify-out)" = "$target" ] || ln -sfn "$target" graphify-out
  elif [ -e graphify-out ]; then
    cp -R graphify-out/. "$target/" && rm -rf graphify-out && ln -s "$target" graphify-out
  else
    ln -s "$target" graphify-out
  fi
}

stamp() { revision > graphify-out/SOURCE_REVISION; }

fresh() {
  [ -f graphify-out/graph.json ] && [ -f graphify-out/SOURCE_REVISION ] \
    && [ "$(cat graphify-out/SOURCE_REVISION)" = "$(revision)" ]
}

build() {
  graphify extract . --code-only --no-viz
  stamp
}

case "$MODE" in
  --check)
    if fresh; then echo "graphify: graph matches $(revision)"; exit 0; fi
    if [ -f graphify-out/SOURCE_REVISION ]; then
      echo "graphify: graph is for $(cat graphify-out/SOURCE_REVISION), checkout is $(revision); run --refresh"
    else
      echo "graphify: no graph for this checkout; run scripts/dev/graphify-bootstrap.sh"
    fi
    exit 1 ;;
  --refresh)
    ensure_cli; link_store
    if [ -f graphify-out/graph.json ]; then graphify update . --force; stamp; else build; fi ;;
  --rebuild)
    ensure_cli; link_store; rm -rf graphify-out/graph.json graphify-out/manifest.json graphify-out/cache; build ;;
  ensure)
    ensure_cli; link_store
    fresh || { if [ -f graphify-out/graph.json ]; then graphify update . --force; stamp; else build; fi; } ;;
  *) echo "unknown option: $MODE" >&2; exit 2 ;;
esac
echo "graphify: ready at $(cat graphify-out/SOURCE_REVISION)"
