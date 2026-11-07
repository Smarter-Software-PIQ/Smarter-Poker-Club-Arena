# Club Arena entry without an automatic page refresh

Owner report: entering the club lobby and other Club Arena pages visibly reloads the entire page. The service worker's 300ms HTML race could display a cached release first. The app then detected the deployed entry chunk and explicitly reloaded the document; route/focus/resume checks could trigger the same replacement during browsing.

Online document entry now reads current HTML before committing, with an 8s failed-read deadline and existing cached/offline fallback. Immutable JS/CSS and media caching remain. Deployed-shell observations no longer reload a rendered page or activate a waiting worker. An open tab retains its complete bundle and drafts; its next deliberate document entry selects the current release. Auth, access and transaction checks are unchanged. Client-only delivery has no new engine dependency.

Regression coverage runs the actual worker with a slow network, executes the app hook through deployment messages/navigation/resume, retains mission settlement protections, and uses two real builds in the existing stale-client browser harness. The existing production lobby-shell certificate also simulates a newer release only in its isolated browser and requires the lobby document to remain mounted. No additional pipeline or financial fixture was introduced.

Delivery evidence and operation ownership: `/Volumes/SmarterArchives/agent-evidence/extreme-archive/arena-navigation-refresh-01a1b6ba/checkpoint.md`. Local implementation is not production completion; final provider and live evidence are recorded there.
