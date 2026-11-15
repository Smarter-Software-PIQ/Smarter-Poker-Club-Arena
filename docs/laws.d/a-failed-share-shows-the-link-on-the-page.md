# tests/a-failed-share-shows-the-link-on-the-page.law.test.tsx

When every way to share or copy a link was refused, the player is owed the link itself so it can be copied by hand. An error toast cannot carry it (the Toast layer sanitises a URL away, measured on production 2026-11-15), so no error toast may hold a link for copying; Tournament Details and the Referral Dashboard render `ShareLinkFallback`, which shows the link selected.
