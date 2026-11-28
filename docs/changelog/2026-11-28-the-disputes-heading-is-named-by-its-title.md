# The disputes docket heading is named by its title alone

Post-deploy client verification (run 46128787571, financial-admin-deep) could
not find the "Club Disputes" heading. The #SmarterDesign rebuild put the status
pill (`Clear` / `N Open`) inside the h2, so the heading's accessible name became
"Club Disputes Clear", a name that changed with the open count.

The h2 and the docket region are now both labelled by a span holding only the
title; the pill stays visible content after it. Pinned in
`tests/components/dispute-management-authority.test.tsx`.
