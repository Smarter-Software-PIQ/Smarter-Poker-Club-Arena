# tests/chicago-cash-windows-are-purely-additive.law.test.ts

Pins the newest SQL definitions of `public.ca_member_record_chicago_facts`, `public.ca_club_member_chicago_today_cash`, `public.ca_club_member_chicago_cash`, and `public.ca_club_members_cash_window` so none of them can revert to subtracting raw `ca_hand_facts` edge slices from UTC daily rollups (`member_record_daily_facts` / `ca_stats_member_record_daily_facts`), preventing negative hand counts and phantom inverted win/loss under post-commit club attribution lag.
