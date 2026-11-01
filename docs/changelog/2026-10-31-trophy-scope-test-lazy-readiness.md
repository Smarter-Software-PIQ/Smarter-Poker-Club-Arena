# Trophy scope test waits for its real lazy section

Publication run 41266771022 failed because the scope-mismatch assertion reached its DOM deadline while TrophiesTab was still loading. The expected scope rejection was logged; the section remained behind Suspense. The previous successful publisher used the same stats source and test.

The data-refusal test now awaits importing the real TrophiesTab before rendering. This separates cold module transformation from its DOM assertion deadline without mocking the section, extending arbitrary waits, or changing assertions or production behavior.
