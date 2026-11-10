---
name: graphify
description: >
  Locate Club Arena code fast with the local Graphify code graph: set it up,
  query it, keep it matched to the checkout. Use for "where is X", "what calls
  Y", "how does A reach B" architecture questions before grepping. Advisory
  only; source code stays authoritative.
version: 1.0.0
---

# Graphify code graph

## What it is

Graphify turns the production code into a local knowledge graph (about 40,000
symbols and 108,000 links). One query returns the files, functions and lines
that matter, so you read a few cited lines instead of grepping the repo. In the
November 9, 2026 evaluation it cut question-specific tokens by about a third
with accurate citations.

- **Local and free:** tree-sitter only, no LLM, no API key, no network after install.
- **Advisory:** Grep, Glob, Read and shell search stay fully available. Hooks only suggest the graph; they never block.
- **Not in the graph:** SQL, migrations, tests, scripts and docs. Search those directly.

Full reference: `CLAUDE.md` section 14.

## How to use it

1. **Set up or refresh** (once per checkout or session; about 2 min on the Mac, 4 min in cloud):

   ```bash
   scripts/dev/graphify-bootstrap.sh
   ```

2. **Confirm the graph matches your code** before relying on it:

   ```bash
   scripts/dev/graphify-bootstrap.sh --check     # stale? run --refresh
   ```

3. **Ask the graph**, then read only the cited lines:

   ```bash
   graphify query "where is the daily maintenance break triggered"
   graphify explain "MaintenanceBreak"
   graphify path "scheduleHorseAction" "performAction"
   ```

4. **After you edit or pull code:** `scripts/dev/graphify-bootstrap.sh --refresh`.

## Rules

- Verify every claim against the source lines before stating it.
- If a name is ambiguous (several `decide()` nodes) or the answer runs through SQL or client-to-RPC calls, fall back to grep.
- Never run `graphify extract` without `--code-only`, and never set a backend: an API key in the environment would send code to a model. The bootstrap script pins this.
- Never install with `--strict`. To silence the nudges: `export GRAPHIFY_HOOKS=off`.
- If `graphify` is not found: run the bootstrap, or `export PATH="$HOME/.local/bin:$PATH"`.
