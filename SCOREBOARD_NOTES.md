# Need4Space scoreboard

The global scoreboard is live at https://vengeful180-dot.github.io/Need4Space/. The game source is in `D:\codex racer test\Need4Space-live`, branch `scoreboard-local`, published to GitHub `main`. The feature starts from commit `5ee31ace35f39ed008397b612750f02e366e73d8`; the release commit is `ebf5039b282577479823f15723e7f3d9f1f9d798`, build `b385edd`. `D:\new opus test` is not edited.

Choose **Scoreboard** from the main menu, Pause or race results. For an isolated local mock preview, temporarily set the endpoint in `scoreboard-config.json` to `./api/scoreboard`, run `python serve.py 8805`, then open http://localhost:8805/?map=space. The ignored local dataset contains sample racing names; those entries are not uploaded to the global boards.

- Separate global top ten for Space, Forest, Ice and Desert, on Easy, Normal, Hard and Brutal.
- Ranked by the total time of a completed three-lap race. Best lap is from that recorded race; points use the existing race score.
- Enter a racing name in the results and choose **Save time**. The fastest race for that name is retained on that map/difficulty. An unsuccessful submission remains available locally for retry.
- No accounts or verified identity. Another name can take another place, including from the same browser. Matching names are grouped without regard to letter case. Anyone who uses the same name can improve its time. Clearing cookies/local storage does not delete server records.
- **Refresh** reads the shared service again. It also refreshes every 15 seconds while the scoreboard is open and the tab is visible. It stops polling when closed; the racing frame loop has no scoreboard work.
- Records outside the top ten are retained. The name chosen when saving a finished race is remembered, so its best time and rank can be shown without a name-entry field on the browsing screen. The personal summary stays hidden when there is no saved time for that name on the selected board.
- A race that changes difficulty mid-race can still be played normally, but is not submitted under a single difficulty.

The local server stores scores in `.local/scoreboard.json`, which is ignored by Git. Separate browser sessions using this server see the same scores. Names are rendered as text, not HTML. No physics, AI, track, ship, rendering options or frame-rate limits were changed.

## Storage configuration

GitHub Pages serves static files; it cannot accept score writes by itself. The included Python score service can store scores in GitHub using a credential held only by the service. No token belongs in browser JavaScript, `scoreboard-config.json`, or a public file.

For an online deployment, host this service behind HTTPS, configure the following environment variables on that host, and set the public `scoreboard-config.json` endpoint to the service's `/api/scoreboard` URL:

| Server variable | Value |
|---|---|
| `NEED4SPACE_SCOREBOARD_REPO` | `vengeful180-dot/Need4Space` |
| `NEED4SPACE_SCOREBOARD_TOKEN` | A server-side, repository-scoped token with Contents read/write |
| `NEED4SPACE_SCOREBOARD_BRANCH` | `scores` |
| `NEED4SPACE_SCOREBOARD_PATH` | `leaderboard` |
| `NEED4SPACE_ALLOWED_ORIGINS` | `https://vengeful180-dot.github.io` |
| `NEED4SPACE_HOST` | `0.0.0.0` when required by the host |

GitHub storage creates the dedicated `scores` branch when the first time is submitted. Each map/difficulty has its own JSON file, such as `leaderboard/space-normal.json`. Updates use the current file SHA and retry conflicting writes, retaining both players' submissions. Scores do not alter the game release branch. The local preview uses local storage on the Python server, and has made no GitHub score writes.

Source changes: `src/scoreboard.js` provides the screen and submission flow; `menu.js` adds entry points, keyboard/gamepad navigation and text-input handling; `hud.js` adds the results shortcut; `main.js` emits a read-only race-reset notification; `ui.css` styles the new screen. `scoreboard.py`, `serve.py` and `scoreboard-config.json` supply shared persistence and the storage adapter. Source edits are followed by `python tools/stamp.py`.

## Validation

`python tools/test_scoreboard.py` checks best-time retention, distinct aliases, all sixteen categories, restart persistence, concurrent saves, invalid/incomplete races and GitHub write-conflict recovery. It uses a temporary local file and a simulated GitHub API; it never writes to GitHub.

`python tools/scoreboard_preview.py` seeds ten sample aliases per board. It refuses to seed a service reporting GitHub storage. The seeded data is ignored by Git and will not be included in a published release.

The seven storage tests passed. Browser checks passed for all sixteen boards, keyboard activation, touch Back, literal-text names, manual Refresh and automatic refresh. A score saved from a separate browser session appeared on the board. Same-name saves from a fresh session retained the existing best time. All four maps were exercised with completed three-lap race submissions and console checks; their times, lap splits and points were saved to the correct board. The local preview also includes four named test runs from those completed races.

Initial UI verification build: `83196ef`. The current source and protected-reference audit is [recorded here](<D:/codex racer test/profiling/scoreboard/audit.json>). The JavaScript race/save checks are in [the local race records](<D:/codex racer test/profiling/scoreboard-final>), and the UI/refresh checks are in [flow.json](<D:/codex racer test/profiling/scoreboard/flow.json>). [Initial desktop screenshot](<D:/codex racer test/profiling/scoreboard/scoreboard-desktop.png>) · [Touch screenshot](<D:/codex racer test/profiling/scoreboard/scoreboard-touch.png>).

The Python GitHub adapter was initially tested against a simulated API. The hosted JavaScript adapter and real online storage were subsequently verified as recorded below.

## Browsing screen correction — 14 October 2026

Build `b385edd` removes the unbound racing-name input from the scoreboard. Name entry belongs to the Save time form for an actual completed race. The remembered name can still highlight its record; the personal summary is hidden when the selected board has no time for that name.

The browser loaded Forest and opened Forest / Normal without console errors. It showed ten rows and no unbound name field or empty personal summary; Refresh and Back worked, and the completed-race submission form retained its name input. [Check record](<D:/codex racer test/profiling/scoreboard/name-field-check.json>) · [Updated screenshot](<D:/codex racer test/profiling/scoreboard/scoreboard-without-name-field.png>).

References: [GitHub Pages hosting](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), [repository content writes](https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents).

## Online publication — 14 October 2026

The hosted score API is `https://need4space-scores.leeloy.chatgpt.site/api/scoreboard`, built from the source in `D:\codex racer test\Need4Space-score-service`. Its Sites project is `appgprj_6ace9ed4b1808191b21530fb203e47a3`. The game remains at `https://vengeful180-dot.github.io/Need4Space/`. `scoreboard-config.json` now points to that HTTPS service. The service writes JSON records to the dedicated `scores` branch of `vengeful180-dot/Need4Space`, under `leaderboard/`. Its credential is an encrypted server environment secret and is absent from the game, source and deployment archive. The service accepts the game origin, validates complete three-lap times, and retries conflicting GitHub writes.

The ten sample entries and local test races remain in the ignored local preview data. They are not uploaded to the online boards. The browsing name field remains removed; name entry appears only with a finished-race Save time form.

The hosted JavaScript storage tests passed for all sixteen boards, top-ten ranking, aliases, completed races, Unicode, GitHub conflicts, CORS and bounded requests. Hosted checks passed for all sixteen boards, CORS preflight, invalid-race rejection, simultaneous real GitHub saves, same-name best-time retention and a fresh-session read. The persisted GitHub JSON was verified independently. The live browser passed all sixteen map/difficulty selections without console errors. The actual Save time form saved the three-lap result with the correct total, best lap and points; a separate fresh browser session read it back. Manual and automatic refresh, Back and removal of the unbound browsing name field also passed. Temporary release-check entries were then removed by matching their exact names, times and recording timestamps; the player record submitted during verification was preserved. All sixteen boards were checked again after cleanup.

Release evidence is in `D:\codex racer test\profiling\scoreboard`: `pages-deployment.json`, `service-deployment.json`, `hosted-api-check.json`, `hosted-save-check.json`, `live-browser-check.json`, `live-files.json`, `release-score-cleanup.json` and `clean-live-boards.json`. GitHub Pages deployment `7050457806` succeeded for the release. The hosted service source commit is `ab83f048d99dfa1544ea97bdbcf830dbe9143ed1`; deployment `appgdep_6acea0ec04ec8191b9710ad1449dab31` succeeded. The protected reference audit reported no changes.

## One submission per race and Global scoreboard label — 14 October 2026

The same finished race previously had separate Save forms in results and scoreboard; only the submitted form was disabled. The save lock now belongs to a stable race ID shared by all forms. Both name inputs and Save buttons lock during a request and after success. Reopening results reuses the completed result and its saved receipt, instead of recreating a pending submission. Receipts survive reloads. A failed request keeps the same race ID for retry.

The Python preview service and hosted JavaScript service store submission receipts separately from each nickname's best record. A repeated race ID returns its original saved nickname without creating another entry, including after a faster race replaces the best record and after a conflicting GitHub update. Published older clients and records without IDs are recognized by the exact total, three lap times and points. A different race can still use a different nickname, including when its millisecond times are identical. The button and screen name is now **Global scoreboard** in the main menu, Pause and results.

The eleven Python storage tests and JavaScript service tests passed. The browser regression exercised two forms for one result, a stale form, reopening results, a direct server replay under another name, a new race with the same times, reload persistence and a lost-response retry. All four maps loaded and opened the renamed screen without console errors; Back and the touch header passed. Evidence: `repeat-save-regression.json`, `fix-map-browser-check.json`, `global-scoreboard-fixed-desktop.png` and `global-scoreboard-fixed-touch.png` in the release evidence folder above.

At the user's request, only the duplicate **Vengeful** entry was removed from Space / Easy. **V3ngeful**, with total 263808 ms, remained. The removal is recorded in `duplicate-entry-removal.json`. No new test scores were uploaded to the public board for this fix.

## Results routing and immediate best-time display — 14 October 2026

Opening Global scoreboard from race results now selects the finished race's circuit and difficulty, even after browsing another board or changing the difficulty for a later race. Opening the board renders its latest cached save response immediately. Each refresh has a request generation; closing the board or successfully saving invalidates older requests so a delayed previous GET cannot replace the newly saved race. Successful saves update the visible row and refresh status immediately.

The real menu/HUD workflow was exercised in the browser using completed-result fixtures: start through the difficulty screen, save in results, open Global scoreboard, return to results, use Race again, save a faster result under the same nickname, and open the board again. Race again issued a new race ID through the actual reset callback. The faster result replaced the previous record, the correct circuit/difficulty opened automatically, and no second Save form remained. A deliberately delayed older GET was released after the faster save and did not restore the old time. There were no console errors. This test wrote only to the isolated local test file. Evidence: `menu-save-flow.json`.
