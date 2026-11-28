# HANDOFF: Club Arena #SmarterDesign Programme, 2026-11-28 update

Written: 2026-11-28 morning, America/Chicago, by Claude session https://claude.ai/code/session_01Gw7aDpsyyn7bWmihKJxjB6.
It continues `docs/HANDOFF-2026-11-27-club-arena-smarterdesign.md`; read that one first for the standard, the rules and the delivery mechanics. This file records only what changed since.

Owner order (Dan, verbatim): "FINISH UP ANY AND ALL UNFINISHED WORK, AND THEN GO AHEAD AND FULLY BUILD, FIX AND ENHANCE ALL OF THESE AND MAKE SURE THEY ARE FULLY WIRED IN AND TESTED BEFORE CLAIMING SUCCESS. YOU DECIDE THE BUILD ORDER. LAUNCH A SWARM IF IT WILL HELP."

## 1. Merged this session

| PR     | Merge      | What                                                                                                                                                             |
| ------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #12317 | 595ccc1abb | Settlement weekly accounting body wears #SmarterDesign                                                                                                           |
| #12319 | 89d6148cbd | Agent Team Hierarchy and Payouts tab bodies                                                                                                                      |
| #12320 | 80ab016ced | Post-deploy e2e specs follow the console skin and the pinned tab bar                                                                                             |
| #12324 | 585373a717 | Agent commission prints as a percent (`formatAgentRate`), not the stored fraction                                                                                |
| #12327 | edeb2248a6 | `reportError` ignores the page's own cancelled reads                                                                                                             |
| #12332 | c8ab3a88dd | Title Case reaches state-setter copy (`check-title-case` STATE_COPY_SETTER, 90 strings fixed)                                                                    |
| #12334 | 53859caa9d | Prerendered landing wears the app's console skin                                                                                                                 |
| #12340 | 05284e0d5a | Notifications page (player pages P1)                                                                                                                             |
| #12341 | 246d60d761 | Tournament Lobby tab rail is one scrolling row so the panel keeps its height                                                                                     |
| #12342 | 1dd15ac3ba | Harness renders money pages and settles before the shot                                                                                                          |
| #12346 | 0cff7e34c6 | Converted pages pass axe (directory list items, audit filter contrast)                                                                                           |
| #12349 | a24c60eb37 | Player Statistics and Wallet (player pages P3)                                                                                                                   |
| #12351 | 2445e91bd5 | Two flaky unit tests wait for what they raced                                                                                                                    |
| #12353 | f25b5c975f | Disputes docket heading is named by its title alone (fixed the post-deploy financial-admin-deep failure, run 46128787571)                                        |
| #12357 | 2c9335f490 | Batch O1: seven partial operator pages (Welcome Message, Banner Displays, Bomb Settings, Cashier Statements, BBJ thresholds, Leaderboard card, Agent score card) |
| #12358 | aaeead9bb5 | Batch P4: Hand History and Transaction History                                                                                                                   |

Armed and in CI at writing: #12359 (batch S1, Settlement Center) and #12360 (batch T1, routed Tournament Details; the mast shows only where no event band exists, so the details panel keeps its full height).

## 2. Post-deploy client verification

- Run 46128787571 failed only on financial-admin-deep "Club Disputes" (fixed by #12353) and the known hero-celebration race (production advanced mid-run).
- Queued "Client browser verification" jobs are cancelled whenever a newer publish arrives (runner_id 0, by design), so on a busy day the first finished run on a containing SHA is the proof. Read failures with `gh api .../check-runs/<job>/annotations`; the artifact host is blocked from the cloud sandbox.
- The first full run on a SHA containing #12353 was in progress at writing (run 46145685859, SHA 2c9335f490). Check its result before reporting.

## 3. Inventory (generated, enforced)

`node scripts/smarterdesign-inventory.mjs` prints the inventory from the code (since 2026-11-28 it is never committed; `--write` puts the document in the gitignored `.smarterdesign/`). Converted pages are recorded one file per page in `docs/club-operations/smarterdesign.d/` (`--ratchet` adds them), and `tests/the-smarterdesign-inventory-matches-the-code.law.test.ts` fails CI when a recorded page regresses or a converted page is unrecorded; the batch history is one file per batch in `docs/club-operations/smarterdesign-history.d/`; `--claims` shows which pages another lane or open PR touches. At writing, before S1/T1 merge: 50 converted, 4 partial, 41 not converted.

Lanes in flight at writing: U1 (Unions, Union Detail, Union Dashboard, Union Games, Union Data, Create Union) and P5 (Settings, Profile, Friends, VIP, Daily Bonus, Search).

Remaining after those: Rakeback, Session History and Union Statements (wait for #12313), Game Management / TableConfig painted section, Agent Portal, Credit Admin, Rate Audit, Settlement History, Diamond Earn/Games, Marketplace, Invite Code, Report Player, Public Profile, Tournament Results, XMTT, Tournament Page, Lightning Entry, Flash Pool, Create Table, the share/replay pages, Club Advertise, Clubs, Home, Poker Arena landing; Club Home and Tournament Lobby last.

## 4. Decisions taken

- Painted console removal across the app: rejected (about 20 KB saved against 98 test files touched; popups and dialogs keep #ClubArenaConsole by the skill split table).
- Notifications light mode dropped under Dan's November 27 order.
- A routed page whose header art is an event band (Tournament Details) keeps the band and gets no second mast; the mast is for states with no band.

## 5. Not landed: release-recovery fixture patch (needs an IPv6-capable host)

`tests/operations/release-recovery-read.test.py` LinuxKernelOwnerTests intermittently reads "listener ambiguous" because a port free on 127.0.0.1 can be listening on ::1. The fix reserves the same port on `::` with a never-listening IPV6_V6ONLY socket. It could not be pushed from the cloud sandbox: the host has no IPv6, the test may not skip (`tests/a-release-recovery-observation-reads-only-its-run.law.test.ts`), and the pre-push hook runs it. Apply on the Mac with `git apply`, run the test there, then push normally.

```diff
diff --git a/tests/operations/release-recovery-read.test.py b/tests/operations/release-recovery-read.test.py
index 7597cc13f..8e1a085e2 100644
--- a/tests/operations/release-recovery-read.test.py
+++ b/tests/operations/release-recovery-read.test.py
@@ -2067,10 +2067,24 @@ class LinuxKernelOwnerTests(unittest.TestCase):
 import ctypes,json,os,signal,socket,sys
 role=sys.argv[1]
 opaque_comm=len(sys.argv)>2 and sys.argv[2]=='opaque'
-srv=None;child=None;control=None;ack=None;port=None
+srv=None;child=None;control=None;ack=None;port=None;guard=None
+def listen_v4():
+ # A port free on 127.0.0.1 can still be LISTENING on ::1 (another process,
+ # another test). The reader then sees two listeners for one port and rightly
+ # answers "listener ambiguous", which read as a random 'unknown' role. Hold
+ # the IPv6 side of the same port with a bound, never-listening v6-only socket
+ # for the fixture's whole life, so the only listener on the port is ours.
+ for _ in range(64):
+  s=socket.socket();s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);s.bind(('127.0.0.1',0));p=s.getsockname()[1]
+  g=socket.socket(socket.AF_INET6,socket.SOCK_STREAM);g.setsockopt(socket.IPPROTO_IPV6,socket.IPV6_V6ONLY,1)
+  try:g.bind(('::',p))
+  except OSError:
+   g.close();s.close();continue
+  s.listen();return s,g,p
+ raise RuntimeError('no port was free on both address families')
 try:
  if role in ('main','shared'):
-  srv=socket.socket();srv.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);srv.bind(('127.0.0.1',0));srv.listen();port=srv.getsockname()[1]
+  srv,guard,port=listen_v4()
  if role in ('other','shared'):
   read,write=os.pipe();ready_read,ready_write=os.pipe();child=os.fork()
   if child==0:
@@ -2087,7 +2101,7 @@ try:
      own_name=ctypes.create_string_buffer(b'own-\xc3\xb8-\xff')
      if prctl(15,own_name,0,0,0)!=0:raise RuntimeError('owned fixture comm change unavailable')
     if role=='other':
-     srv=socket.socket();srv.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);srv.bind(('127.0.0.1',0));srv.listen();port=srv.getsockname()[1]
+     srv,guard,port=listen_v4()
     os.write(ready_write,(str(port)+'\n').encode());os.close(ready_write)
     while True:
      command=os.read(read,1)
@@ -2117,6 +2131,7 @@ finally:
  if child:
   os.write(control,b'q');os.close(control);os.waitpid(child,0)
  if srv:srv.close()
+ if guard:guard.close()
 """

     @contextlib.contextmanager
@@ -2177,7 +2192,9 @@ finally:
                                        ('other','other_container_process',True)]:
             with self.subTest(role=fixture,opaque_comm=opaque),self.fixture(fixture,opaque) as (identity,_,__):
                 role,evidence=R.pending_socket_owner_details(identity,R.time.monotonic()+3)
-                self.assertEqual(role,expected)
+                # The evidence names the stage and reason, never a pid, so a
+                # failure says why the reader refused.
+                self.assertEqual(role,expected,json.dumps(evidence))
                 self.assertEqual(evidence,{'stage':'complete','code':'exclusive'})
                 self.assertNotIn(identity['hostPid'],json.dumps((role,evidence)))
                 self.assertNotIn('own-',json.dumps((role,evidence)))
```

## 6. Rules (unchanged)

Report to Dan in Central time, concisely, only when verified live. Never force push, stash, rebase main, `--no-verify` or bypass hooks; never type Dan's password; never print other processes' args or env. Renders are reviewed by the lead before auto-merge is armed and sent to Dan. Title Case, no em dashes, no `:hover`, horses never "bots". Root-cause fixes only. Pushed, merged, published and verified live are separate states.
