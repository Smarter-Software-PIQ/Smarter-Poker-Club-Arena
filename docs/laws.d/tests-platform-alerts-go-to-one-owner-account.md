# tests/platform-alerts-go-to-one-owner-account.law.test.ts

Platform operational alerts (`public.fn_is_platform_alert_recipient` and `public.fn_guard_platform_alert_recipient`) route exclusively to the owner's operational account (`47965354-0e56-43ef-931c-ddaab82af765`, `daniel@bekavactrading.com`) and reject all secondary or role-matched accounts (`3bb71bfe-f723-427c-aac7-a853ba04a014`, `2d1cd6c3-5700-4af9-a271-d4863fdab20d`, `9b027798-9532-403f-a5c1-15554ce2959c`), while preserving ordinary personal, security, and gameplay notifications for every account.
