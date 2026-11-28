# The Financials console check names the page title

Post-deploy run 46145685859 (financial-admin-deep) looked for a heading "Financials" on `/clubs/:club/financials`. The page mast prints "Club Financials" as its h1. The spec loop stops at its first failing console, so this entry first ran once the Disputes heading was fixed (#12353). The spec now names "Club Financials".
