# tests/server-dockerfile-smoke-ci.law.test.ts

Every server-touching pull request builds `server/Dockerfile` with BuildKit layer caching in `.github/workflows/ci.yml` (`server_dockerfile_smoke`) and runs an offline (`--network=none`) smoke probe (`scripts/ci/server-dockerfile-smoke.sh`) proving compiled ESM output, `public_hist215_wtl.node` (`exactRootWTL`), and `legacy-census.node` load cleanly inside the production container image, gated fail-closed under `Server Engine (typecheck + tests)`.
