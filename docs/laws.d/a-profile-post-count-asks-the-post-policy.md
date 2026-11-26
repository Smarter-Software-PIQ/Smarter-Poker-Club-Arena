# tests/a-profile-post-count-asks-the-post-policy.law.test.ts

A profile's Posts number is fn_social_profile_post_count: the same answer as counting social_posts through its SELECT policies for that viewer, computed set-wise so a heavy author (5,636 posts) answers in about 0.4 s instead of timing out at 7.9 s for signed-out visitors; it pins an md5 of the policies and the helpers it unfolds, refuses when they change, and any migration that changes them must restate it.
