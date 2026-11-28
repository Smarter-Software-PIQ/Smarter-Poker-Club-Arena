# tests/the-apply-run-reports-its-own-refusal.law.test.ts

The Apply Merged Migration workflow carries one job that needs the apply job, runs only when that job concluded failure (never for a dry run), holds no environment and no secret, has issues and pull-requests write and nothing wider, and runs the refusal alert script from the default branch on its own run id, so a refused install is posted on its pull request and on #11599 by the run itself instead of waiting on a workflow_run event GitHub never raises for a run the job token started (run 46054847104, 2026-11-27).
