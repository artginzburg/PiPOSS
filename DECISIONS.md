# DECISIONS.md — decisions made without the owner

Format: date, task, decision, reasoning. Written by the orchestrator as tasks are
accepted; executors hand decisions up in their reports. The owner reads this
afterwards — these are the points where an agent decided alone.

## 2026-07-27 · Phase 1 (design)

Decisions taken **with** the owner in conversation, recorded here because they
constrain every later task:

1. **Mac App Store: prepare, do not submit.** Owner's call. Consequence: the
   iOS/iPadOS target is dead code until submission happens, so it is deferred
   with an explicit unfreeze condition rather than dropped.
2. **The `commands` shortcut cannot be a bare `P`.** `suggested_key` requires a
   modifier and Safari does not implement `commands.update()`, so no code can
   set it. Resolution: our own configurable hotkey in the options page (default
   `P`) plus `_execute_action` at `⌘⇧P`, which is what fills Safari's currently
   empty *"Offers keyboard shortcuts"* field. Verified against MDN
   browser-compat-data, not from memory.
3. **`--no-quarantine` is removed with no replacement command.** Release 1.0.3
   was checked and is Developer ID signed, notarized and stapled, so neither the
   flag nor the "Ctrl+Click ▸ Open" tip in the README was ever necessary. Owner
   agreed not to add an `xattr` fallback: it would teach users to weaken
   Gatekeeper for no benefit.
4. **No telemetry, no scheduled metrics job, no committed CSV.** At 1–5 installs
   a month the signal is noise. Instead `docs/metrics.md` documents how to pull
   Homebrew analytics and GitHub release counts on demand, with the 2026-07-27
   baseline recorded.
5. **Nothing is renamed in v2.** Bundle ids, repository and cask stay; a
   researched naming shortlist is produced for the owner to decide on later.
6. **Auto-PiP on tab hide is in scope, off by default.** A feature the paid
   competitor lacks; defaulting it on would be the fastest route to uninstalls.
7. **Deviation from the methodology: no push.** The methodology's core rule 4 is
   "accepted task = commit **+ push**". The owner withheld push. Commits still
   land per task, so git remains the process memory; only the remote copy waits.
   This is the single deliberate divergence and belongs in the retro.

## 2026-07-27 · Phase 2 (launch setup)

12. **The smoke test runs on a real blocker instead of a dummy task.** Baseline
    verification of the inherited state found that `pnpm run build` exits 1 on
    the current pnpm (`ERR_PNPM_IGNORED_BUILDS` for esbuild) while the Xcode
    build phase swallows the failure and reports success — so a clean-checkout
    release would ship an extension with no content script at all. The
    methodology prefers a throwaway smoke subject to keep pipeline failure
    distinguishable from task failure; that distinction is still available from
    the executor and reviewer reports, and running the smoke on a small real
    blocker unblocks Wave 1 in the same cycle. Recorded as a deliberate
    deviation.
13. **`caffeinate -dims` is running** (pid confirmed) for the autonomous shift.
    Note for the owner: closing the lid defeats it — the methodology's pitfalls
    file records this as measured, not theoretical.

## 2026-07-27 · T00 The Xcode build silently ships a stale or empty content script

14. **The plan was wrong and the measurement won.** T00's criterion prescribed
    `pnpm.onlyBuiltDependencies` in `package.json`. Executor and reviewer
    independently measured all three candidate mechanisms on pnpm 11.17:
    `pnpm.onlyBuiltDependencies` in `package.json` → exit 1 plus an explicit
    *"the `pnpm` field in package.json is no longer read"* warning;
    `onlyBuiltDependencies` in `pnpm-workspace.yaml` → exit 1, **silently**
    ineffective, no warning at all; `allowBuilds: { esbuild: true }` in
    `pnpm-workspace.yaml` → exit 0. Confirmed not by exit code alone but by the
    installed binary size: 9351 bytes (the JS shim left when the postinstall is
    skipped) versus 9 867 346 bytes (the real native esbuild). Criterion
    amended in PLAN.md.
15. **The fallback `pnpm install --frozen-lockfile 2>/dev/null || pnpm install`
    was removed deliberately.** The `2>/dev/null` is precisely what hid this
    defect for the life of the project, and the `|| pnpm install` fallback would
    silently mutate a committed lockfile during a release build. A lockfile that
    genuinely disagrees with `package.json` is a human's problem, not something
    a build should paper over.
16. **`set -e` only, not `set -eu -o pipefail`.** `-u` would fire on unset Xcode
    environment variables for no benefit, and the phase contains no pipelines.
17. **CLAUDE.md wording fixed on the reviewer's observation.** The TDD rule said
    executors must quote "the failure text of the red test", which has no literal
    subject on an infrastructure task. It now says "red evidence" — the
    obligation to demonstrate the failure first is unchanged, the artefact that
    demonstrates it need not be a test file.

Tails with addressees:

18. **For T12 (XcodeGen) and T13 (CI):** `PiPOSS Extension/Resources/pnpm-workspace.yaml`
    is now a **required build input**. A checkout without it regresses to
    `ERR_PNPM_IGNORED_BUILDS` and exit 1. T12 must also add it to the phase's
    `inputPaths` (it is absent today) and should declare `dist/content.js` — and,
    after T03, `dist/background.js` — as explicit `outputPaths` instead of the
    `dist` directory, because directory outputs give Xcode weak dependency
    analysis.
19. **For T05 or T13:** nothing pins the pnpm version. `pnpm` here resolves via
    corepack to 11.17.0; a contributor or CI runner on pnpm 10 or earlier reads
    neither `allowBuilds` nor the removed `package.json` field and hits the same
    failure. Add `"packageManager": "pnpm@11.17.0"`.
20. **For T03:** `esbuild.config.js` ends with `.catch(() => process.exit(1))`,
    which swallows the exception text. The exit code is correct so the build
    still fails, but a non-esbuild config error would produce an empty
    diagnostic. Fix while touching that file.
21. **For a future task, low priority:** the build phase's `package.json`-absent
    branch is a designed silent success — if that file ever went missing the
    build would ship whatever `dist/` holds. Narrow (a moved directory is caught
    by `cd` under `set -e`, and `package.json` is a declared input path), but the
    file is not optional for this project, so the branch should become
    `error:` + `exit 1`.
22. **Scope note:** the delivery added one file that T00's `Files:` line did not
    list. The reviewer flagged it rather than letting it pass silently; the plan
    line was amended to match the delivery.

## 2026-07-27 · T01 Test harness and the platform-API protocol

23. **Parity was proved by a characterisation suite run against the old file.**
    `test/content.test.ts` drives only the public surface, so it can be run
    against `git show HEAD:.../src/content.ts` unchanged. Executor and reviewer
    each did the swap independently: 13/13 pass against the pre-extraction file.
    The reviewer strengthened it further with region hashes — the hotkey path and
    the whole YouTube path are **byte-identical** to HEAD, so nothing was
    "improved" in passing and T06's remit is untouched.
24. **The tests were mutation-tested rather than counted.** The reviewer mutated
    production code ten ways; eight were caught, including swapping the PIP and
    INLINE constants (12 failures), dropping the single-video rule, and moving
    the dataset write before the mode computation. 38 green tests are therefore
    evidence, not decoration.
25. **`togglePiP` lives in `core/presentation.ts`**, not `core/video.ts` —
    `video.ts` stays a pure DOM-query module.
26. **`getVideos(root = document)` was extracted too**, beyond T01's literal
    scope, because T04/T06/T10 all need it and the alternative was making them
    reach into the composition root.
27. **`lint:ts` now typechecks the tests via a second tsconfig.** The build
    config is ES2016 with `moduleResolution: node` and cannot resolve vitest's
    exports-only package; `tsconfig.test.json` overrides target/lib/resolution
    for `test/**` only, leaving the shipped code checked exactly as before.
28. **The `dataset` augmentation moved into `src/webkit.d.ts`.** `content.ts` is
    a module now, so its former file-local `interface HTMLVideoElement` would no
    longer merge with the global one. A separate `dataset.d.ts` was judged more
    ceremony than value.

Confirmed pre-existing bug, deliberately preserved:

29. **The PiP toggle can wedge.** `dataset.lastPresentationMode` stores the mode
    observed *before* the call and is written unconditionally, so leaving PiP
    stores `'picture-in-picture'`. If the user then re-enters PiP through
    Safari's own control, the next toggle computes "currently PiP ⇒ restore to
    the stored mode" and asks WebKit to enter the mode it is already in — the
    video does not leave PiP. The reviewer reproduced this against a verbatim
    copy of the **original** `togglePiPOnVideo` in a standalone script, so it is
    pre-existing, not introduced by the extraction. Pinned by a characterisation
    test named "today's quirk". **Fix candidate for a new task:** write the
    dataset only when *entering* PiP, and ignore a stored `'picture-in-picture'`.
    That is a behaviour change, so it was correctly kept out of an extraction
    task.

Tails with addressees:

30. **For T04:** the current green suite does *not* pin the absence of modifier
    suppression — adding a `metaKey || ctrlKey || altKey` guard leaves all 38
    tests passing. Do not read today's green as evidence about modifiers; RRR
    §4.2 wants that guard, so add it with its own test.
31. **For T06:** the AirPlay branch of the insertion-point choice is uncovered
    because the fixture has no `.ytp-remote-button`. T06's fixture **must**
    include one. (T06 replaces this code with `data-priority` ordering anyway.)
32. **For T07, with a live demonstration:** deleting the
    `dataset.pipossCustomButtonEnabled` guard makes vitest **hang forever**
    instead of failing — `insertBefore` is itself a childList mutation, so the
    unthrottled whole-document observer re-enters and starves the event loop, and
    no test timeout can fire. That is precisely the RRR §5.3 defect T07 exists to
    fix, now with a reproduction.
33. **For T10:** `FakePresentationController.supportsPiP` answers from one global
    flag, not per video. A page mixing supported and unsupported videos needs a
    per-video override — a small backward-compatible addition when needed.
34. **For T13 (CI):** the fake stays out of the shipped bundle only because
    esbuild tree-shakes it (`grep -c Fake dist/content.js` → 0, bundle 2111 B
    against a 12 KB budget). If a consumer ever imports the fake from a module
    the production entry reaches, it would be bundled silently — worth a size or
    grep gate. Also still missing: a `format:check` script, which RRR §9 lists
    as a static gate (prettier is installed and the tree is clean).
35. **DECISIONS 20 remains open** — `esbuild.config.js` was not touched, so its
    exception-swallowing `.catch()` is still there. Reassigned to T03.

## 2026-07-27 · T02 Settings module

36. **RRR §3 rule 1 is enforced by the type system, not by discipline.** A new
    `src/browser.d.ts` declares `BrowserStorage` with `local` and `onChanged` and
    nothing else, with the Safari-alias reason written at the declaration — so
    `browser.storage.sync` does not compile. The reviewer tested the claim rather
    than believing it: `error TS2339: Property 'sync' does not exist on type
    'BrowserStorage'`. The test fake additionally installs a `sync` area whose
    every method throws, which fires 24 test failures if anything reaches it.
    A future contributor cannot "improve" this into `sync` by accident.
37. **The write path is `{ ...merged, ...mergeOverDefaults(merged) }`** — raw
    stored object first so unknown keys are carried, canonical known keys last so
    wrong types are repaired. Order matters and is pinned; swapping it fails two
    tests. Survived the reviewer's attacks: ten cycles with a deeply nested
    unknown field, falsy unknown values, concurrent writes, and no leak of
    unknown fields into the typed `Settings` returned to callers.
38. **A failed read aborts the write.** The strongest of the failure-mode
    decisions: it is the only thing between a transient read failure and
    permanent loss of a future version's unknown fields.
39. **Reads never reject, writes do.** `settings.ts` is imported on every page
    including frames with no `browser` API; an unhandled rejection at module init
    would reproduce exactly the "extension installed, does nothing" failure T00
    just fixed. Confirmed against **twelve** hostile `browser` globals — every one
    resolves to the defaults. Writes reject because their only callers are
    options-page handlers on a user gesture, which have somewhere to put the error.
40. **Wrong-typed stored values degrade per field, never throw**, and the next
    write rewrites them canonically, so corruption self-heals without a migration.
41. **`hotkey` is lowercased in the storage layer**, making it a property of the
    layer rather than a hope about every writer. Length and printability are
    deliberately **not** validated here — see tail 43.
42. **Mutation-tested twice, independently.** The executor ran six mutations, the
    reviewer invented twenty more: 16 died, 4 survived, and all four survivors
    were judged immaterial with the production code correct in each case. The
    reviewer also named four tests that pass against a wrong implementation —
    honest reporting of its own suite's weak spots, now T02a's job.

Tails with addressees:

43. **Ownership assigned explicitly, because it was falling between two tasks:**
    hotkey *validation* belongs to **T09**'s capture field, not to the storage
    layer. RRR §3 says "single printable key", but `saveSettings({hotkey:'ABC def'})`
    currently stores `'abc def'`, and **T04**'s `matchesHotkey` would then never
    match — silently disabling the hotkey with no user-visible cause. T09 must
    reject or normalise at the boundary; T04 must not assume the stored value is
    a single character.
44. **For T04/T09/T10:** import the fake from `test/helpers/fake-browser` and call
    `uninstallFakeBrowser()` in `afterEach` — it installs a real global and leaks
    between files otherwise. Values seeded into it must be structured-cloneable.
    T09 also needs a `permissions` namespace added to both `src/browser.d.ts` and
    the fake; its shape was deliberately not guessed.
45. **For T04:** the settings module is not yet in the bundle
    (`grep -c settings dist/content.js` → 0, bundle still 2111 B of a 12 KB
    budget). The bundle-size impact of settings lands in your task.

## 2026-07-27 · T02a Harden the settings module and the shared test fake

46. **`saveSettings` writes are now serialized through a module-level promise
    queue.** The lost update was reproduced on the old module before the fix and
    attacked eight ways after it: a rejecting write does not wedge the ones behind
    it, a write whose *read* failed still writes nothing (DECISIONS 38 survives),
    ten overlapping writes compose, and `loadSettings` neither queues behind a
    slow write nor rejects. Serialization is **per realm** — the options page and
    the content script have separate queues and the cross-realm race is still
    live, which is stated at the declaration rather than papered over in a
    docstring.
47. **`loadSettings` is deliberately not queued.** A read that waited on a slow or
    failing write would inherit its latency, and reads must never reject.
48. **The fake now clones `onChanged` payloads per listener and isolates listener
    exceptions**, and a write performed *by* a listener is queued rather than
    recursing depth-first. Verified independently: three listeners get three
    distinct payloads and none can corrupt the store or each other; three throwing
    listeners are all recorded while the fourth still runs and the write still
    resolves.
49. **The `sync` tripwire counts property *reads*, not just calls**, and a
    companion test proves the tripwire itself is live — so it cannot silently
    stop working and read as a pass forever. Confirmed by mutation.
50. **Mutation-tested twice again**: eight by the executor, twenty independent
    ones by the reviewer, 14 dead. All six survivors were judged immaterial with
    the behaviour correct in each case — four of them survive only because a
    second layer of defence already covers them.

Tails with addressees — read these before writing tests against the fake:

51. **For T04, T09, T10 — the one way this fake can lie to you.** It dispatches
    `onChanged` **synchronously inside `set`** and drains the whole cascade before
    the `set` promise resolves. So `await saveSettings({hotkey:'m'})` followed by an
    assertion on listener-updated state (a content script's cached hotkey, a
    converged options UI) **passes against the fake while Safari, which dispatches
    asynchronously after the write settles, would be broken**. Do not treat
    `await saveSettings(...)` as a barrier for anything a listener computes. Assert
    on the value the listener received, or drive the listener explicitly.
52. **For T04, T09, T10 — await every write in tests.** An un-awaited
    `saveSettings` from one test lands in the *next* test's freshly installed fake;
    `uninstallFakeBrowser()` cannot drain the module-level write queue. Measured.
53. **For whoever next touches the fake** (none of these blocked T02a): only one of
    the three promised clones is pinned by a test — the incoming and outgoing
    clones are unpinned; `getFailure`/`setFailure` are truthiness-checked so a
    falsy rejection value cannot be simulated; `remove()` has no failure hook,
    which T09 will want; `getCalls` is not recorded when `get` fails; and a
    listener detached mid-dispatch still receives the in-flight change.

## 2026-07-27 · T03 Manifest V3 + background + toolbar button + command

54. **RETURNED once, and the return invalidated a requirement I had written.** RRR
    §4.1 originally claimed the toolbar button works without host permissions
    because "`activeTab` is granted by the click itself". That is false:
    `activeTab` grants *programmatic injection* and privileged tab properties, but
    a **declared** content script still does not run on an ungranted site, and
    Safari will not inject declared scripts until the user allows the site. Since
    every site is ungranted on a fresh install, the delivered button would have
    silently done nothing for every new user — a regression against the MV2 popup
    it replaces, which at least said "press P". Verified independently before
    returning: `scripting` and `scripting.executeScript` are Safari **15.4+**, the
    same floor MV3 requires, so the fix costs nothing in support range. RRR §4.1
    rewritten with the correct mechanism.
55. **The delivery path is now message → inject on failure → message once more.**
    Message first so a granted site is never re-injected; exactly one injection
    attempt, never a loop. Because the content script can now land on a page that
    already has it, its whole body sits behind `claimFrame()`, with the flag on the
    isolated world's global rather than a `data-` attribute — a DOM attribute would
    be visible to the page and would fire our own mutation observer.
56. **The test fake could not express the bug, which is why the first review's
    suite missed it.** `tabs.sendMessage` used to deliver whenever a listener
    existed in the realm. It now gates on a registry of which tabs actually run the
    content script, defaulting to **empty** — a fresh install — so every test must
    declare its world. The reviewer re-introduced the exact old blindness as a
    mutation and it died: a test registers a listener and still requires
    `sendMessage` to reject.
57. **The reviewer verified F1 against a browser double it wrote itself**, refusing
    to use the executor's fake to check a finding about that fake being blind. That
    is the right instinct and worth keeping as practice.
58. **A retry loop would have hung the suite rather than failed it.** The "inject
    until it works" mutation initially survived; modelling permanent delivery
    failure exposed why — a microtask-only loop starves the timer queue, so no test
    timeout can fire. `tabs.sendMessage` and `scripting.executeScript` therefore
    now cross a **macrotask** (also more faithful: they cross a realm in Safari),
    while `storage` stays synchronous because the T02a suite depends on it. The
    non-termination guard now fails in 4 ms against a 2 s budget. *Correction to
    the executor's account, measured by the reviewer: the microtask version does
    not hang for ever — it OOMs the worker after roughly a minute, with zero failed
    tests and no named test. Same practical consequence, different symptom.*
59. **Background form: `background.scripts` + `persistent: false`.** Apple's own
    Xcode 26.6 MV3 template uses the scripts form — but it writes `"type":
    "module"` and carries no `persistent` key, so it corroborates the *form* only;
    `persistent: false` comes from RRR §12. Reversal to `service_worker` is two
    manifest keys and no code change, re-verified against the emitted bundle: no
    DOM, no timers, no module syntax, listeners registered synchronously at top
    level.
60. **Silence on the no-video path is enforced structurally**, not by discipline:
    `setBadgeText`, `setTitle`, `notifications` and `tabs.query` are undeclared in
    `src/browser.d.ts` so calling them fails the compiler, and the fake records any
    attempt. All four tripwires are now individually proven live — two of the four
    were not, at first review.

Tails with addressees:

61. **For T04 — a required addition, not a suggestion.** The fake's macrotask
    boundary is load-bearing and **unpinned**: the reviewer's one surviving
    mutation downgrades `tick()` to `Promise.resolve()`, the suite stays fully
    green, and the non-termination guard silently degrades from a named 4 ms
    failure into an OOM with no failed test. Since T04 extends this fake anyway,
    add the companion test that pins the boundary — assert `tabs.sendMessage` has
    not settled after a drained microtask queue. This is the DECISIONS 49 pattern
    that the rest of the project already applies.
62. **Appendix to DECISIONS 51, for T09 and T10.** A second way the fake diverges:
    `storage.onChanged` dispatches synchronously while `sendMessage`/`executeScript`
    now cross a macrotask, so in the fake an options page that does
    `await saveSettings(...)` and then messages the content script **always** sees
    the storage listener run first. Safari guarantees no such ordering. Do not
    build behaviour on it.
63. **For T09 — a residual case out of T03's reach.** `sendTogglePiP` resolves true
    if *any* frame answers, so on a granted top frame embedding an ungranted
    cross-origin iframe, the top frame answers, the background returns early, and
    the frame actually holding the video is never injected. `activeTab` covers only
    the top-frame origin, so injecting into that subframe would likely be refused
    anyway — the real answer is the all-sites host permission your flow requests,
    not more background logic. Note the fake models the grant per *tab*, so this
    state cannot be represented in it today.
64. **Still open for T12** (DECISIONS 18): the build phase declares the `dist`
    *directory* as its output rather than `dist/content.js` and `dist/background.js`.
65. **For T13 or T05:** source maps ship in the Release `.appex` for both bundles —
    pre-existing, but dead weight that also exposes unminified source. And prettier
    does not converge on a comment placed between a test callback and its timeout
    argument, which matters before RRR §9's `format:check` gate lands.

## 2026-07-27 · T19 Naming shortlist

66. **RETURNED once, and the reason was self-flattery, not bad research.** The
    reviewer re-ran 34 domain lookups and 28 App Store queries independently and
    found **zero** disagreements with the delivered measurements. It came back
    because four statements over-valued the document's own subject: a 20×–100×
    gap where the corrected RRR §1 says 10–50×, and "a few hundred a month, which
    is reachable" where RRR says the ceiling is dozens per month. Both errors
    pointed the same way — toward the work being worth more than it is.
67. **The bad extrapolation was kept as a labelled retraction rather than
    deleted.** Rating-rate back-projection assumes a rate measured in other
    categories transfers to a $3.99 Mac utility; rejecting that assumption is
    exactly what produces the lower number. Deleting the passage would have hidden
    that the document once over-valued itself, so it stays, clearly marked, with
    both the original 33-derived band and its 49-derived recomputation shown.
68. **The competitor's rating count is 49 worldwide, not 12.** A `country=us`
    lookup returns **one storefront**. Measured in T17 across 28 storefronts and
    independently corroborated by the T19 reviewer across 24 (47, consistent). Any
    ratings figure for this niche read from the US alone is roughly **4× low** —
    this is now a counting note in RRR §1 because it will otherwise be re-made.
69. **Trademark claims are marked unsearched, not searched-clear.** Five public
    USPTO/EUIPO endpoints were tried and all failed (404 `NoSuchKey` ×2, 301 ×2,
    no response), reproduced by the reviewer. No keyless endpoint exists. The
    document now distinguishes "clean on the checks in §3" from "clear to adopt"
    and names a register search as the owner's prerequisite. A partial search
    presented as coverage would have been the exact failure this task forbids, on
    a claim with legal consequences.
70. **`dig` is not usable for availability on this machine, but less
    catastrophically than first claimed.** Only **A-record answers** are synthetic
    — the resolver invents a sequential `198.18.0.0/15` address for every name,
    including garbage, and even an explicit `@8.8.8.8` or the authoritative
    nameserver is intercepted. Rcodes and other record types pass through
    truthfully, so NS-query NXDOMAINs independently corroborated every RDAP 404.
    Method is RDAP-only anyway, because a registered-but-undelegated domain also
    answers NXDOMAIN. An earlier draft blamed PLAN.md for prescribing `dig`; PLAN
    prescribes no DNS technique and the claim was retracted.
71. **The recommendation is `PiP Anywhere`, and it is correctly sized.** The only
    candidate clean on all three defined checks simultaneously — no App Store
    collision in either entity, both `.com` and `.app` unregistered per RDAP,
    carries "pip", correct on first hearing. `FloatPiP` **ties on the hard checks**
    and is disclosed as an equally defensible pick separated only by softer
    judgements. `PiPify` and `PiPer` are disqualified by exact collisions —
    `PiPer` being a free, open-source Safari PiP extension, though site-specific
    (v1.0.4, 2019-11-14), which makes "any video anywhere" a real differentiator.
    The document carries an explicit counter-recommendation to **rename nothing**
    if no App Store submission happens, and closes with "the name is worth fixing;
    it is nowhere near the first thing to fix."

Open for the owner:

72. **`piposs.com` was registered 2026-01-26** through IONOS on a one-year term,
    transfer-locked, DNS on Cloudflare, **mail provisioned** (`v=spf1
    include:_spf-eu.ionos.com`, `mx00/mx01.ionos.co.uk`), and serving nothing
    (HTTP 525). Verisign is a thin registry holding no contact object; following
    the RDAP referral to the registrar gives a registrant `REDACTED FOR PRIVACY`
    with `cc: GB`, which sits on IONOS's privacy proxy and is **not**
    identification. So the holder is unknowable over RDAP. The mail records give a
    one-question test: does the owner have an IONOS account with mail on that
    domain? If not, someone else took the project's exact name in January 2026.
73. **A trademark search on whichever name is chosen** — the owner's, since no
    keyless API exists.

## 2026-07-27 · Incident: an autonomous build asked the owner for a password

74. **What happened.** The acceptance criterion I wrote (RRR §10.1.4) called for a
    signed `xcodebuild`. Signing reaches into the login keychain for the Developer
    ID private key, so macOS raised a password dialog — **at the owner, while he was
    asleep**. He refused it and pointed out the real failure: a command waiting on a
    dialog does not fail, it hangs for ever, so in a genuinely unattended run this
    would have stalled the whole pipeline indefinitely. He was right, and the
    methodology says so explicitly: phase 2 forbids planning operations that need
    "red" confirmations into autonomous phases.
75. **Fix, at the rule level rather than the one command.** CLAUDE.md now carries
    "never run a command that can raise a system prompt" as a hard rule, with the
    canonical unsigned build command spelled out, plus explicit bans on
    `security unlock-keychain`, `sudo`, asking the owner for a password, and
    anything that opens a GUI window, requests a TCC permission, or waits on stdin.
    Verified: the unsigned build reports `BUILD SUCCEEDED` with **zero**
    `/usr/bin/codesign` invocations, so the keychain is never touched.
76. **RRR §10.1.4 amended and signature verification moved to §10.2.** Checking
    `codesign -dv` for a Developer ID authority is a real criterion — it just
    belongs to the owner, at the keyboard, because it cannot be done without the
    keychain. §10.1 renumbered accordingly.
77. **Both in-flight agents were corrected mid-task** rather than left to finish
    against a rule that had changed. T05 additionally has to encode the distinction
    into the Makefile: unattended targets never sign, a signed target exists but is
    opt-in and announces that it will prompt, and `docs/development.md` states which
    targets an owner must be present for.

## 2026-07-27 · T17 Correction: Mac App Store ratings are not observable

78. **My own competitive numbers were wrong twice, and the second correction is
    that the quantity is unmeasurable.** Apple's public iTunes feeds return
    `userRatingCount: 0` for **every** `kind: mac-software` record. Verified against
    Amphetamine, Things 3 and Magnet — all apps with thousands of ratings on their
    store pages, all reporting 0. So every zero in my Mac-ratings table was an API
    artifact, not a finding. Worse, the "12 US / 49 worldwide" figure I promoted
    into RRR §1 as a correction belongs to OverPicture's record of
    `kind: software`, `features: ["iosUniversal"]` — those are its **iOS** ratings.
    Its Mac-side count cannot be read from here at all.
79. **What survives, and what I stopped claiming.** Survives: price and existence
    are real fields, so "at least five free PiP-for-Safari apps already exist on the
    Mac App Store" holds, and the founding premise that this capability is otherwise
    *sold* is wrong. Also survives: the 2 200–20 600/month third-party estimate is
    not credible for a $3.99 utility whose iOS side has ~55 ratings after 114
    months. **Dropped:** any multiplier on the gap. Successive drafts said 1000×,
    then 10–50×; both overreached. RRR §1 now says the estimate is wrong and that I
    cannot say by how much.
80. **The category-awareness argument is demoted to a hypothesis.** It is a
    reasonable reading of 127 downloads in four years, not a measurement, and RRR §1
    now labels it as such. `docs/metrics.md` is the honest counterweight: at one to
    five installs a month, no incremental change in v2 is measurable — only a step
    change would be.
81. **Lesson for the retro.** Three of the corrections in this project so far were
    to requirements *I* wrote from research *I* did (the `activeTab` mechanism, the
    SVG toolbar-icon claim, and this). Each was caught by an agent instructed to
    verify rather than accept. The reviewer-never-trusts-the-author rule is earning
    its cost against the orchestrator too, not just against executors.

## 2026-07-27 · T04 Hotkey handling driven by settings

82. **Modifier suppression: Cmd, Ctrl and Alt each disqualify; Shift does not**, and
    `shiftKey` is deliberately **absent** from the `HotkeyEvent` interface, which
    makes the exclusion structural rather than a forgettable oversight. Shift is how
    uppercase letters and most punctuation are produced at all, so guarding it would
    make `?` or `:` unusable as hotkeys and would break the long-standing
    uppercase-`P` behaviour the T01 parity harness pins; and every Safari
    accelerator involves Cmd, so `⌘⇧P` is already caught by the Cmd rule. Each
    modifier is independently load-bearing — removing any one of the three dies on
    its own named test.
83. **A detail I had not foreseen, and the reason the guard matters beyond RRR's
    wording:** without it, `⌘⇧P` — T03's *own* registered `_execute_action` — would
    fire both the command path and the plain-key path, entering PiP and immediately
    leaving. A visible no-op on the shortcut we advertise in Safari's own settings.
    *Honest caveat from the reviewer:* whether Safari delivers a page `keyup` for a
    chord it consumed as an extension command is **not measured** and the source
    comment states it as fact. The guard is mandated by RRR §4.2 independently, and
    `⌘P` (print) is an uncontested case the old code got wrong, so the verdict does
    not rest on it.
84. **An unusable stored hotkey degrades to the default; only `''` disables.**
    Treating garbage as "disabled" is precisely the silent-death case DECISIONS 43
    forbids — a dead key with nothing for the user to see. Degrading matches the
    policy `settings.ts` already applies to a wrong *type* (DECISIONS 40), so the two
    layers agree, and the remaining mismatch is visible rather than invisible.
    "Unusable" is: not exactly one UTF-16 code unit, whitespace, control, or a
    surrogate. Rejecting non-BMP is deliberate — an emoji can never be an
    `event.key`, so accepting one manufactures the dead hotkey.
85. **A keypress before settings load uses the default.** The listener attaches
    synchronously with `DEFAULTS.hotkey` and swaps when the read lands. "Ignore
    until loaded" would make the hotkey dead for the first moments of *every* page
    load for *every* user, to avoid one wrong toggle in that window for the minority
    who reconfigured it. Two consequences fell out and are pinned: the settings
    subscription is registered *before* the read is issued, so a change during the
    read is not lost; and a stale first read is discarded if a change has already
    been applied, or it would revert the hotkey a moment after the user set it.
86. **The DECISIONS 61 companion test was calibrated, not guessed.** It drains 500
    nested microtask turns before asserting the promise has not settled. The reviewer
    reduced the drain to find the real threshold: at 1 and 2 turns the suite stays
    green — the test would have been **vacuous** — and 4 is the minimum that catches
    the downgrade. So 500 is a ~125× margin, and the trailing
    `await expect(delivery).resolves` closes the only hole draining could leave. It
    also fails, rather than passing vacuously, against a `tick()` that never resolves.
    T04 pinned the boundary **without extending the fake**, overriding
    `storage.local.get` locally instead — better than DECISIONS 61 anticipated, and
    `fake-browser.ts` is byte-identical to HEAD.
87. **A survived mutation proved a real bug rather than a weak test.**
    `Array.from(value).length` versus `value.length` initially survived; asking why
    showed the *rule* was wrong — counting code points accepted an emoji, i.e. a
    hotkey no keystroke can fire. The rule now rejects non-BMP and the mutation
    survives as provably equivalent. The reviewer verified the equivalence is
    **conditional**: applying both mutations together dies, so the emoji assertion
    is not vacuous. 63 executor + reviewer mutations, 58 dead.
88. Content bundle **2111 B → 4463 B**, 36% of the 12 KB cap. DECISIONS 45 discharged
    — settings is now in the bundle.

Tails with addressees:

89. **For T09 — the validation boundary is looser than its own rationale claims.**
    An exhaustive BMP sweep found **9178** accepted code units that no keystroke can
    ever report: format characters (42), combining marks alone (1093 Mn, 260 Mc, 13
    Me), private use (6400), and noncharacters (1370) — e.g. U+200B ZERO WIDTH SPACE,
    U+00AD SOFT HYPHEN, a lone U+0301 COMBINING ACUTE, U+FFFF. Immaterial today
    because no product path can write them (your capture field reads a real
    `event.key`), and DECISIONS 43 assigns validation to you — so validate on the
    event, not on the string. Also: a **single space is invalid** under this rule,
    deliberately, because space is play/pause on every video site.
90. **For T06 — two file-level constraints in `test/hotkey.test.ts`.** The
    composition-root `describe` must stay **last**: `content.ts`'s `keyup` listener
    is never detached and jsdom shares one document per file, so anything added after
    it double-counts every press. A comment explains this; nothing enforces it.
91. **Two small factual errors in comments, worth fixing when next in the file:**
    `hotkey.ts` says the content script runs "at document start", but `manifest.json`
    declares no `run_at`, so it is `document_idle` (the decision is unaffected — the
    async-read window exists either way); and one test named "stays out of an input
    even after the key has been reconfigured" never reconfigures anything, so
    editable suppression *after a live reconfiguration* is genuinely untested.
92. **Two uncovered defensive branches**, each one assertion away: a lone surrogate,
    and a non-whitespace C0 control such as `ESC` or `NUL`.

## 2026-07-27 · T17 On-demand download metrics

93. **Returned once, for the defect this file exists to prevent.** Three commands
    read `/tmp/cask-365d.json`, which **nothing in the document creates** — they
    worked only because the executor's own leftovers were still on disk. On a clean
    machine: `jq: error: Could not open file`, exit 2. The executor then found and
    fixed **a second instance the review had filed as drift**: a §2 block quoting
    output stitched from two different runs, whose four values all differ when the
    command is run once. Every `/tmp` reference is now created by the block that
    reads it.
94. **Mac App Store competitor numbers are not reported, and the zero is a dated
    regression rather than platform policy.** Apple's public feeds return
    `userRatingCount: 0` for every `kind: mac-software` record. Proven three ways:
    four known heavily-rated Mac apps all read 0; the whole niche grouped by `kind`
    splits perfectly (19 mac-software apps → 0 ratings, 4 iosUniversal → 18); and
    decisively, **one app in both listings** — PiPifier's Mac record reads 0 while
    its own iOS twin reads 324. So OverPicture's 12 US / 56 worldwide are its **iOS**
    figures, and my earlier promotion of them into RRR §1 as a "correction" was
    measuring the wrong thing.
95. **The reviewer settled the open question with archived snapshots**, which neither
    the executor nor I had thought of. Amphetamine's Mac listing JSON-LD published a
    growing `reviewCount` — 2 in 2020, 2182 in 2023, 2430 in March 2024, 2572 in
    November 2024 — and reads 0 today. So the field demonstrably used to work; the
    wording is now "not reported **as of 2026-07-27**", not "cannot be measured",
    and a one-command canary is recorded so the re-check is trivial. Note the
    canary needs `curl -L`: without it the request 301s and the grep silently finds
    nothing, which is its own false negative.
96. **The executor corrected two rows I had relayed without verifying.** I passed on
    the reviewer's 2024-10/2550 and 2026-03/0 rows; the nearest fetchable snapshot is
    2024-11-07/2572, and **no 2026 snapshot is indexed at all** (the availability API
    returns 2025-10-30 as nearest; the CDX API 503'd). Further, **every 2025 snapshot
    contains no JSON-LD block at all** — the field is *absent*, not zero — so absence
    is not evidence of a zero. The honest window is **2024-11 to 2026-07**. I verified
    both corrections myself. The conclusion is unaffected; its precision is.
97. **R3/R4 were superseded rather than patched.** Instead of fixing a storefront
    count and leaving another lower bound for the next agent, the executor ran the
    **complete** sweep: 162 storefronts, zero fetch failures, **56 ratings**. The
    reviewer re-ran it and got character-for-character identical output, and confirmed
    it subsumes both earlier partial figures. US holds 12 of 56, so a US-only reading
    understates by ≈5×, not 4×.
98. **The file refuses to become a dashboard, and says why in arithmetic.** At a mean
    of ~2 installs/month, Poisson sd ≈ 1.4; distinguishing 2 from 3 needs on the order
    of 200 events, i.e. years. So **no incremental change in v2 is measurable** — only
    a step change is. Stated first and in bold rather than buried under method. §9 also
    forbids benchmarking against a competitor, since per §5 there is no competitor
    number to benchmark against.
99. **Two silent false negatives documented, both of which read as "zero installs".**
    `brew info --analytics` on a third-party tap cask exits 0 with **zero bytes**
    while working for a core cask; and `formulae.brew.sh/api/cask/piposs.json` 404s
    with an HTML body, so `curl -s | jq` gives a parse error rather than a zero.
    Only the aggregate analytics JSON is trustworthy.
100. **The fragile-regex confession was kept deliberately.** An earlier run silently
     dropped OverPicture and reported the niche sum as 6 instead of 18. The reviewer
     reproduced it exactly and judged it one of the most useful things in the file.
     Same for the cartesian `jq` trap: `.assets[].name` with `.assets[].download_count`
     multiplies, giving 484 lines for 22 assets — correct today at one asset per
     release, silently wrong later.

## 2026-07-27 · T05 Local development loop

101. **Returned once, and the finding was worse than the task.** The delivered doc
     claimed the Xcode phase "runs `pnpm install && pnpm run build` on *every* Xcode
     build, so a bundle watcher never saves you a step". Measured false: the phase
     declares `src` and `dist` as **directories**, and a directory's mtime does not
     change when a file inside it is edited, so after a source-only TypeScript edit
     Xcode skips the phase and the build ships the previous bundle while reporting
     `BUILD SUCCEEDED`. Both executor and reviewer reproduced it in a clean checkout
     with a source-only edit and no `dist/` tampering: the probe was **absent** from
     the built `.appex` on the old path and **present** on the fixed one. Mechanism
     confirmed by contrast — `touch package.json`, a *file*-level input, does trigger
     the phase.
102. **Fix is `app-build: build`, and it is a repair rather than a mask.** The two
     steps fail for different reasons and only one is broken: a shell-phase directory
     `inputPath` is stat'd as a single node, so a file edited inside `src/` is
     invisible to it, whereas `CpResource` enumerates the directory it copies and does
     see content changes. The reviewer confirmed three times that `CpResource`
     re-copies while the phase stays skipped. Root cause remains T12's.
103. **One nuance the doc does not carry, recorded here instead.** The documented
     escape hatch for iterating on Swift while the TypeScript is red — a bare
     `xcodebuild` — works *only while the phase stays skipped*. After any file-level
     input changes, or on cold DerivedData, it runs the phase and fails with the same
     `tsc` error. So the escape hatch relies on the very bug the section above it
     describes. The trade is still right: `app-build` is what CI and agents call, and
     an `.appex` built around code that does not typecheck is the failure being
     eliminated.
104. **One `SIGN` switch, defaulting to safe.** `SIGN=no` (unsigned) for everything
     unattended; `SIGN=dev` only via `make app` behind a banner; `SIGN=devid` only via
     `make app-signed CONFIRM=1`. An unknown value is **refused** rather than falling
     through to project signing, which would silently mean "sign with whatever the
     project says". Verified under attack: `make check SIGN=dev` and
     `SIGN=dev make check` both still yield **zero** codesign invocations, because a
     sub-make's own explicit assignment beats both a parent command-line override and
     an environment variable. Counting note: an unsigned log still contains
     `note: Using codesigning identity override:` and `CODESIGNING_FOLDER_PATH`, which
     are **not** invocations — count `/usr/bin/codesign` and `^CodeSign ` instead.
105. **Watchers are no longer labelled unattended-safe.** They never exit, and for an
     agent that failure mode is identical to the keychain dialog: not an error, but
     never finishing. Help now has three groups — safe unattended, interactive
     never-return, and owner-at-the-keyboard.
106. **The dependency stamp was deleted rather than fixed.** `[ -nt ]` has one-second
     granularity here, demonstrated by a manifest 0.8 s newer than the stamp being
     skipped, and the stamp bought ~150 ms. Trading correctness for 150 ms is a bad
     trade in a file whose whole job is stopping stale inputs from reaching a build.
107. **`make check`'s claim was narrowed to what it actually asserts:** RRR §10.1
     items 1 and 2 in full, plus the *commands* behind 3 and 4 exiting — with item 3's
     12 KB budget printed but **not enforced** and item 4's "zero warnings introduced
     by us" **not checked**. A size gate belongs to T13 (DECISIONS 34).
108. **No `scripts/` directory**, contrary to PLAN's original `Files:` line. Nothing
     in the delivered targets needs a shell script; the reviewer upheld the omission
     and the plan line was amended to match the delivery.
109. **Two evidence gaps named rather than papered over:** that Apple Development
     signing completes without a dialog was never re-measured after the rule landed
     (though every build in this repo before the correction signed that way without
     one, so it is a historical statement, not a prediction), and `relaunch` has never
     been executed in its current wiring. Both sit inside owner-only targets.

Tails with addressees:

110. **For T13:** `make check` now runs 3 `pnpm install`s, 4 `lint:ts` runs and 3
     esbuild runs (~11.7 s warm, ~2 s of it duplicate) because of `check`'s
     prerequisites plus `app-build`'s new one. If that is worth removing, the clean
     split is a bundle-only pnpm script for `app-build` to depend on, leaving
     `lint:ts` to `check`. Also still open: `format:check`, and a bundle-size gate.
111. **For T12 or T13, minor:** the Makefile cannot express `-derivedDataPath`, so
     CLAUDE.md's canonical `/tmp/piposs-dd-<task>` is not reachable through `make` and
     concurrent agents share one DerivedData. A `DERIVED_DATA ?=` variable is two
     lines. `check` also discovers a missing Xcode last, since `require-xcode` sits
     only on the sub-make.

## 2026-07-27 · T15 README and install instructions

112. **The old install command was not merely unnecessary, it was broken.**
     `brew install --cask --no-quarantine …` now fails outright on Homebrew 6.0.13:
     `Error: invalid option: --no-quarantine`. And it was never needed — the
     brew-installed 1.0.3 on this machine reports
     `Authority=Developer ID Application: Arthur Ginzburg (R2294BC6J8)`,
     `flags=0x10000(runtime)`, `Notarization Ticket=stapled`, and
     `xcrun stapler validate` passes. The "Ctrl+Click ▸ Open" tip described a
     Gatekeeper problem the app does not have. Both removed, no `xattr` fallback
     added (DECISIONS 3).
113. **`spctl` alone must never be quoted as proof of notarization.** On this machine
     `spctl --status` reports **assessments disabled**, so `spctl -a -t exec` prints
     `accepted` alongside `override=security disabled` — it accepts more readily
     than a user's machine would, which makes the check vacuous here. The
     machine-independent evidence is `codesign -dv` showing
     `Notarization Ticket=stapled` plus `xcrun stapler validate`; both read the
     ticket stapled into the bundle instead of asking the local policy engine, and
     neither needs the keychain. RRR §10.2 item 5 was amended accordingly.
114. **Two false claims found beyond the brief.** The old README promised PiP for
     "currently playing or the first appearing video"; `pickVideo`
     (`src/core/video.ts`) returns the first non-paused video when several exist and
     **null when several exist and none plays**, so "first appearing" only ever
     described a single-video page. And "custom button" was wrong twice: on YouTube
     we un-hide YouTube's *own* button, icon and tooltip included, and RRR §11
     forbids custom buttons anywhere else.
115. **A real user-visible regression, now warned about.** v2 requires **Safari
     15.4+** because it is MV3, where v1 ran on older Safari. Left unstated, a
     macOS 11 user on Safari 14 would see an extension that simply never loads and
     conclude the app is broken. The README now asserts only the capability floor —
     MV3 cannot be loaded by older Safari — and demotes the *symptom* to a
     conditional the reader tests, because how Safari fails on an unparseable
     manifest is not something an agent can measure. **This was my fifth
     stated-as-fact platform claim in this project and the reviewer caught it before
     it shipped;** the previous four (the SVG toolbar icon, the `activeTab`
     mechanism, the competitor numbers, `spctl`) were all mine too.
116. **The five-second threshold is deliberately not named in prose.** A number in a
     README invites boundary-testing and "my 5.2 s clip did not float" reports; RRR
     §4.6 and this file hold the precise value for anyone who needs it. "A few
     seconds" conveys the kind of clip excluded, which is all a user acts on.
117. **The README documents the v2 shipping state, not the half-built state.** The
     branch ships as one unit and a README rewritten twice is worse than one
     rewritten once. The reviewer accepted this **on condition** that the exposure be
     enumerated durably rather than living in an executor report — hence the table
     below.

### T15 repair map — README sentences that depend on tasks unlanded at T15

Sentence text and line numbers are as committed at T15. **Four tasks, seven rows** —
note that T06 (row 7) is a different case from the rest: its code was written and in
review when T15 landed, whereas T09, T10 and T11 did not exist at all. The reviewer's
independent derivation therefore counted three; both readings are right, and the
distinction is recorded here so the count is not "corrected" later by someone who
sees only one of them.

| # | README | Sentence | Blocks on | If descoped |
|---|---|---|---|---|
| 1 | 41–42 | "…and you can change the key, or switch it off, in PiPOSS's settings." | T09 | Delete from ", and you can change" to the full stop. The rest of the bullet is landed. |
| 2a | 56 | "PiPOSS's settings show where you currently stand…" | T09 | Delete. Sentences 1 and 3 of the section stand alone and **must stay**. |
| 2b | 56–58 | "…and offer a button that asks Safari for access to all websites; Safari then puts the choice to you as you browse." | T09 | Delete. Separable from 2a — a page could ship the state display without the button. |
| 3 | 62 | "…and the PiPOSS app can reopen it." | T11 | Delete the clause; line 62 then ends at "install." Trivial — listed so its simplicity is not copied to rows 4–6. |
| 4 | 63 | "Besides the hotkey it has:" | T09 | **Not separable.** If T09 goes, 62–69 go as a block — but line 62's first clause, "The settings page opens by itself right after you install", is **landed** (`handleInstalled`, `src/background.ts`) and must be **retained**. Deleting the section wholesale silently drops a true claim. |
| 5 | 65–68 | the auto-PiP bullet in full | T10 **and** T09 | **Two different descope paths.** T10 gone, T09 kept → delete the bullet *and* remove the toggle from the options page, or you ship a switch that does nothing. T09 gone, T10 kept → the behaviour has nothing to enable it, so both must go. Also **revisit, not delete**, if T10 resolves the muted-exclusion question: "playing *with sound*" and "muted videos and" are the two edits. |
| 6 | 69 | "**The YouTube button** — on by default." | T09, **control only** | Half landed: the behaviour and the `true` default are real. Reword to a statement of fact rather than deleting — and **do not touch line 50**, which is landed and true. |
| 7 | 50 | "**On YouTube**, Picture in Picture appears in the player's own controls." | T06 (in review at T15) | Delete. Deliberately carries no position claim: placement is `data-priority`-derived, so naming a neighbour would go stale by design. |

118. **Two notes for T10 from the reviewer's reading of the final wording.** The
     rationale in the auto-PiP bullet strictly motivates the *muted* rule, not the
     length rule — harmless, since the canonical case is excluded twice over. More
     importantly, "playing with sound" is slightly **narrower** than RRR §4.6: a video
     with no audio track is not `muted`, so the rule as specified would fire for it
     while the README implies it will not. Under-promising is the safe direction, but
     T10 should know the README has set that expectation and should check
     `video.muted` at minimum.

## 2026-07-27 · T06 YouTube button — the headline bug

119. **The bug was ours, not YouTube's, and the fix is the absence of code.** The
     old module compensated for a PiP `<svg>` being 36 px against its 24 px
     siblings — a difference that no longer exists, since current YouTube styles
     every control's SVG identically. With `--yt-delhi-pill-top-height` at 8 px
     rather than the 12 px fallback the code assumed, the compensation computed
     `padding: 2px 6px` with `box-sizing: border-box` on an 18 px box, collapsing
     the glyph to **6×14 px inside a 32×32 button**. Reproduced by both agents
     against a verbatim `HEAD` copy driven by the new fixture, character for
     character. The new module writes **no geometry at all**.
120. **A second, unreported defect was in the same code.** Placement was hardcoded
     as "before AirPlay, else before fullscreen", so on a player with an AirPlay
     button the PiP button landed in the wrong place — DECISIONS 31's
     previously-uncovered branch. Ordering is now derived from the `data-priority`
     attribute the player puts on every button, **including our own rank**, so no
     position constant exists to rot.
121. **Rule 1 is enforced behaviourally, which is why it caught what the grep gate
     could not.** A test walks the whole player subtree after mount and asserts
     **zero** inline style properties anywhere. It killed every geometry write
     either agent tried, including obfuscated ones the §5.4 grep gate misses
     (template literal, string concatenation, `String.fromCharCode`, spelled as a
     word, imported from another module — all five routes now documented in the
     gate's own docstring, together with the reason the gate is still worth having
     as a second line of defence).
122. **The click path: returned twice, and the second return was about mechanism
     rather than motive.** The executor intercepted YouTube's handler with
     `stopImmediatePropagation`, justified by "Safari does not implement the
     standard PiP API". That premise is false — `requestPictureInPicture` is Safari
     **13.1+**, and the owner's own report that the button "works perfectly, just
     tiny" is first-hand evidence their handler worked. The reviewer then measured
     the *effect* and found the comment wrong about itself: our listener is
     necessarily registered second, since we find a button YouTube already wired,
     and `stopImmediatePropagation` cannot un-run a listener that already ran. It
     suppressed only ancestor and later-registered handlers — so **every click was
     driving PiP twice**, through two different APIs, in an order no jsdom test can
     observe. That was the one thing that could have regressed a button the owner
     says already worked.
123. **Resolved by moving the listener to the player, capture phase, with
     `stopPropagation`.** Measured: YouTube's own button handler runs **1** time
     with the old design and **0** with the new one. The determinant turned out to
     be the **capture flag, not the element** — the reviewer's own first
     measurement had conflated the two and it corrected itself. The player is still
     right, for one specific reason now pinned by a test: it is the highest node we
     control, so it also wins against a handler YouTube may delegate to an ancestor
     of the button, which capture-on-button loses to. Without that test the obvious
     "simplification" of moving the listener onto the button keeps every other test
     green.
124. **`stopPropagation`, deliberately not `stopImmediatePropagation`** — a weaker
     suppression chosen for observability. The immediate form's extra reach is over
     listeners on the player itself, where YouTube's were registered before ours
     anyway, while it would silence a duplicate listener *of ours* and hide the only
     bug this file cannot otherwise see. Measured: breaking DOM de-duplication fails
     one test under the immediate form and three under `stopPropagation`.
125. **Why YouTube hides the button in Safari is unknown, and the reviewer refused
     to guess.** Established: hidden only by an inline `display:none` with no CSS
     rule behind it, the standard API is available, and the handler is functional.
     So it is a YouTube product decision, not a capability gate — and **the code
     must not assume their handler is dead.**
126. **Idempotency by convergence, not by a flag.** No dataset marker: each step is
     idempotent and the DOM is written only where it differs. This also fixes a real
     defect in the old design, whose `video.dataset` flag suppressed exactly the
     re-run the observer exists for, since the video element survives a fullscreen
     transition.
127. **The mount waits for the stored setting** rather than starting on the default
     as the hotkey does (DECISIONS 85). A keystroke can beat a storage read; a
     player's control bar effectively cannot, and starting on the default would mean
     DOM surgery on the page of a user who disabled it, then visibly undoing it.
128. **DECISIONS 32 now fails instead of hanging.** Deleting the "already in place"
     guard trips a named `insertBefore` budget in ~400 ms. Verified that the budget
     cannot mask a real defect: green code uses 1 insertion against a budget of 200,
     the exact-count test is the primary guard and fails on its own in 7 ms, and
     raising the budget to 1e9 on green code changes nothing. Limit recorded: the
     budget bounds `insertBefore` only — a re-entrant loop through `innerHTML`,
     `appendChild` or an attribute write still hangs outright.
129. **Three places where a one-line simplification broke the product while all 225
     tests stayed green**, each found by the reviewer and each now pinned: the
     capture-once guard (after the second mount the captured value becomes `''`, so
     switching the setting off would leave the button **visible** instead of
     restoring YouTube's `display:none`); the wait-for-settings decision; and — the
     worst — **deleting the `MutationObserver` from `content.ts` entirely**, which is
     the whole reason the extension watches the page and T07's entire premise.
130. **Two conditional equivalences, kept as genuine redundant defence:** the
     ownership guard in `handleClick` versus `removeEventListener` in `hide()`, and
     `>` versus the self-skip in `place()` — each half survives alone, each pair
     dies, and the second pair's combination *hangs*, which the `insertBefore`
     budget cannot catch.
131. **Two tests were caught claiming more than they proved** and were narrowed: an
     "ancestor handlers are suppressed" test that did not cover the button level,
     and a comment asserting the settings subscription was dropped on `disable()`
     when the `enabled` flag carried the assertion. Also corrected: the old
     `ariaKeyShortcuts === 'p'` assertion **could not fail** — assigning any
     unsupported reflection property reads back — and it hardcoded a hotkey that is
     configurable since T04. It now asserts the `aria-keyshortcuts` **attribute**,
     driven by `effectiveHotkey`.
132. **Reported warnings were wrong and the executor corrected itself:** the
     unsigned build emits **three**, all environmental and pre-existing (one
     `multiple matching destinations`, two `appintentsmetadataprocessor`). Its
     `grep -c "warning:"` missed the uppercase `xcodebuild: WARNING:` form and had
     been read off an incremental run. RRR §10.1 item 4 as worded — zero warnings
     *introduced by us* — holds.
133. Bundle **4463 B → 5351 B**, 44% of the 12 KB cap. **27 mutations across three
     rounds, 27 dead.**

Tails with addressees:

134. **For T07:** `refresh()` is safe at any rate but still runs `querySelectorAll`
     per call, and the observer in `content.ts` is still unthrottled. Keep the
     `binding.active` gate — the observer is installed only on YouTube documents,
     because a whole-document `childList` observer on every page on the web for an
     inert consumer is RRR §5.3 at its worst. The test that pins the observer's
     existence is now in place, so you cannot remove it silently.
135. **For T08:** the fixture is a self-contained fragment carrying the measured
     `<style>` contract including `--yt-delhi-pill-top-height: 8px`, reusable as a
     local page. Compare against `.ytp-size-button svg`, now PiP's immediate next
     sibling — **never an absolute value**. The double-drive question is closed by
     the capture-phase fix, but confirming on a live page that exactly one PiP
     transition happens per click is still worth a check.
136. **Still one assertion away each, not blocking:** `data-priority=""` handling is
     now covered, but a click landing on a `<path>` deep inside a *nested* svg, and
     `hide()` when the button has already left its player, remain uncovered. The
     latter is documented and harmless because `controllers.delete` disarms first.

## 2026-07-27 · T07 Mutation observation, coalesced

137. **The obvious test for this requirement proves nothing, and finding that out is
     most of the task.** A `MutationObserver` **already** collapses 1000 synchronous
     mutations into a single callback — measured — so "drive 1000 mutations, assert one
     run" passes against the **unthrottled** code. The load-bearing drive is 1000
     mutations across 1000 microtask checkpoints, which really does deliver 1000
     callbacks, asserted with an independent witness observer so it cannot pass
     vacuously. The reviewer reverted `content.ts` to HEAD and confirmed **both**
     shapes fail there.
138. **The fallback: every batch arms a frame *and* a 250 ms timer, first to fire
     cancels the other.** rAF is not always a clock — absent in some environments,
     never fired in a document that is not painted, and a content script runs with
     `all_frames: true` in frames that never are. A frame-only scheduler there does not
     run late, it does not run **at all**, and the button silently stays wrong. 250 ms
     is chosen so the frame always wins in a painted document (≈15 frames at 60 Hz, so
     the timer is one cancelled `setTimeout` of overhead) and so the fallback path
     **alone** cannot breach §5.3: 4 runs/s = 40 per 10 s < 60. Both can never run —
     pinned by two mutants and by a test using a clock that ignores cancellation.
139. **Re-entrancy fails instead of hanging because every hop is a task, not a
     microtask.** DECISIONS 32/128 twice cost this project a hang and an OOM with zero
     failed tests. A non-convergent consumer now yields the event loop on every pass, so
     a timeout can fire: lowering the budget to 2 exits non-zero in 1.3 s with a named
     message. Recorded precisely, because the delivery is indirect: the throw happens in
     an animation-frame callback outside the test's await chain, so the runner reports it
     as an **unhandled error** while the test itself fails on its count assertion.
     Coalescing bounds the *rate*; `sites/youtube.ts` writing only on a real difference is
     what makes the sequence *terminate*. Both are needed.
140. **The absence of `attributes` in the observer options is now pinned, and it is
     load-bearing.** `{childList, subtree, attributes: true}` survived the whole suite.
     On a live watch page attributes mutate every frame — progress-bar transform,
     `aria-valuenow` — so adding them converts "runs are scheduled by mutations, so idle
     frames cost nothing" into a run per frame: **600 per 10 s against a budget of 60**.
     A deliberate absence recorded only in a comment is exactly what gets "simplified"
     back in (DECISIONS 129), so it is now an assertion.
141. **The `binding.active` gate was unpinned** (DECISIONS 134): dropping it kept all
     338 tests green while installing a whole-document `childList` observer on **every
     page on the web** for a consumer that does nothing. Now pinned by a test recording
     `MutationObserver.prototype.observe` calls from before the import.
142. **T06's observer pin had rotted, and repairing it was a strengthening.** The test
     waited on a macrotask, which no longer reaches a run coalesced to a frame, so it
     failed. The tempting fix — adjust the expectation — is the quietest way to kill a
     guard. Instead a `frame()` barrier was added and the repair verified by mutation:
     deleting the `MutationObserver` still fails it. The reviewer measured that the
     neighbouring convergence assertion had been **near-vacuous** under the old barrier
     — `insertBeforeCalls` was 1 because the coalesced re-run had not happened at all,
     so the "it converges rather than looping" claim was guarding an event that never
     occurred. `frame()` is a strictly longer wait, so nothing was loosened.
143. **A real defect found by the executor's own mutation:** observing `document.body`
     rather than `document` leaves the observer on a **detached node** if a page replaces
     its body — which YouTube-scale pages do. Closed with an end-to-end test that mutates
     `documentElement`.
144. **`FALLBACK_DELAY_MS` is pinned by bounds, not by naming the number**, so a
     deliberate change survives and a careless one fails: greater than four frames (the
     frame always wins) and `10_000 / delay <= 60` (§5.3 holds on the fallback alone).
     The earlier self-referential assertion compared the observed delay against the
     exported constant and so could not fail at all.
145. Bundle **5351 B → 5857 B**, 48% of the 12 KB cap. 343 tests. 49 mutations between
     executor and reviewer.
146. **Accepted without a third review pass** — a visible judgement call. The three
     follow-ups were specified verbatim by the reviewer itself, and the executor showed a
     dying mutation for each; I re-ran T07's three suites (87 passing) and confirmed the
     constants and observer options by hand. A further round would have re-verified the
     reviewer's own prescription.

Tails with addressees:

147. **For T08 — §5.3's second half is measurable in your environment and nowhere
     else.** The per-frame bound proven in jsdom does **not** imply the total: at 60 Hz it
     permits 600 runs per 10 s. The ≤ 60 figure holds only because runs are scheduled *by
     mutations*, so it depends entirely on live churn. So do not only assert §5.1's
     geometry — **count coalesced runs over 10 s of real playback**, instrumented exactly
     as `countRefreshRuns()` in `test/observe.test.ts` does (wrap `document.querySelectorAll`
     and count `.html5-video-player` calls, one per `refresh()`). **The risk to name:
     childList churn from live chat, ads and the up-next rail exceeding 6 mutations per
     second.** If it does, the finding is not that the scheduler failed but that
     per-frame coalescing is insufficient for §5.3 and a longer floor is needed.
148. **For T10:** `observeSubtree`'s `stop()` is never called in production — the observer
     is meant to live as long as the document, as the hotkey binding does — so the whole
     teardown path is exercised only by tests. You are the first plausible consumer that
     might want it.
149. **Warning counts must be read off a cold build.** The executor's final run was
     incremental and reported **1** warning instead of 3, because the two
     `appintentsmetadataprocessor` lines were cached. That is DECISIONS 132's trap
     recurring; it self-reported. Zero introduced by us either way.

## 2026-07-27 · T09 Options page

150. **Access has four states, not two, and the reason is Safari-specific.** Safari
     grants host access **per site**, so `contains({origins:['*://*/*']})` answers
     `false` both on a fresh install *and* for a user who has already allowed twenty
     sites. Telling that second user "no access" is the one thing this section must not
     do, so `getAll()` distinguishes `some` from `none`, and `unknown` is a real fourth
     state that is never guessed as `none`. I had not seen this when writing RRR §4.3.
151. **The permission request is gesture-bound three independent ways**, because
     breaking it would fail only in Safari and never in tests: the handler is not
     `async` and everything after the request hangs off `.then`, so an `await` cannot be
     inserted without changing the function's shape; the test fake **throws** if
     `request` is called outside an event dispatch; and a structural test replaces
     `storage.local.get` with a never-resolving promise, so any future read-before-request
     kills it. The reviewer broke it four ways and all four died.
152. **The fake's gesture tripwire models the real thing, not a jsdom artifact.**
     WebKit's `WebExtensionAPIPermissionsCocoa.mm` gates the API on
     `UserGestureIndicator::processingUserGesture()` and errors with *"must be called
     during a user gesture"* — a stack-scoped indicator, i.e. exactly the synchronous
     dispatch window the fake models. Apple ships a regression test for it.
153. **`permissions.remove` is deliberately undeclared, on mechanical grounds.** The
     first argument was product honesty — the grant lives in Safari's per-site popover,
     so a "turn off access" button in *our* page would claim ownership of a decision we
     do not own. The reviewer found the stronger reason: WebKit's `permissions.remove`
     checks the origin against `allRequestedMatchPatterns()` and fails with *"required
     permissions cannot be removed"* for a `host_permissions` origin, and adding the same
     pattern to `optional_host_permissions` does not help because Safari dedups it. The
     button could not work even if we wanted it.
154. **A worry investigated and dismissed with primary evidence.** Safari does **not**
     need `optional_host_permissions` for `permissions.request({origins})`. WebKit's
     `verifyRequestedPermissions()` builds its allowed set *starting from*
     `allRequestedMatchPatterns()` — what MV3 `host_permissions` parses into — and only
     then adds optional patterns; Apple's `AcceptPermissionsRequest` regression test is
     MV3 with `host_permissions` only, stable from Safari 17.4 to 26.5. The folklore
     traces to a 2020 forums reply about an MV2 manifest, where it was correct. Neither
     Apple's prose docs nor MDN answer the question at all. **Recorded so nobody
     re-opens it.**
155. **DECISIONS 89 honoured literally: the only input is `event.key`.** There is
     deliberately **no `input` or `change` handler** on the capture field, and a test
     proves that setting `field.value` and firing those events writes nothing. The
     reviewer probed nine further routes — paste, `beforeinput`, drop, `compositionend`,
     `textInput`, blur-after-autofill, `keyup`-only, `keypress`-only, form `reset` — and
     every one wrote nothing. The ~9178 unfireable code units are unreachable by
     construction rather than by validation.
156. **A failed write reverts the UI to the last stored state.** A checkbox left ticked
     after a failed `saveSettings` is the page lying about what the extension will do.
     The page also renders from the write's own resolved value rather than from the
     storage listener, per DECISIONS 51/62.
157. **The tests drive the real `options.html` read off disk**, which the reviewer called
     the strongest property in the delivery: a misspelt `data-testid` fails 47 tests, and
     the testids are the production lookup keys as well as the test handles, so a typo
     cannot pass tests and fail in Safari.
158. **A missing esbuild entry point was invisible, for all three bundles.** Dropping
     `'./src/options'` left the entire suite green while `options.html` pointed at a
     bundle nobody built — T00's failure mode exactly, and the same gap existed for
     `content` and `background`. Now a test parses `entryPoints` out of
     `esbuild.config.js` and requires an entry behind every bundle referenced by the
     manifest **or** by a `<script src>` inside the options page, with three guards
     against going vacuous.
159. **The executor broke its own fix in the same way it was fixing, three times.** Its
     comment stripper removed block comments before line comments — and
     `esbuild.config.js` has carried since T00 a line comment containing a slash-star,
     which opened a block comment that swallowed everything to the next JSDoc. The gate
     found zero entry points and failed **loudly**, so it was caught; the same shape one
     character different would have **hidden a real entry**, turning the repair of a
     defence into a hole in it. It then hit the same class twice more while writing the
     explanatory comment. Line comments now come out first with the reason recorded at
     the function, and the reviewer could not construct a silent weakening in nine
     adversarial attempts — every truncation it built destroyed the parse into a loud
     failure.
160. **The resource gate proves "some target copies this file", not "the extension
     does".** Worded precisely on the reviewer's insistence. Its first version was a
     substring search over the whole `.pbxproj`, which false-passed the likeliest
     hand-editing mistake: keep the file reference and the group entry, drop the
     `PBXBuildFile` and the copy-phase membership — exactly what Xcode produces when
     target membership is not ticked — and the build stayed green with the file absent
     from the `.appex`. It now requires the reference inside a `PBXBuildFile` whose
     object id is listed in a Resources or CopyFiles phase. **Residual, measured:**
     moving that id into the *app* target's phase still passes while the file lands in
     `PiPOSS.app` and not in the `.appex`. Booked as T12 item 4 with the fix.
161. `options.js` is its own 6343 B bundle; RRR §5.2's 12 KB cap applies to the content
     script, which T09 changed by **zero** bytes. 341 → 343 tests across the task.
     82 mutations between the two agents.

Tails with addressees:

162. **For the owner, added to RRR §10.2 item 3:** open the options page on a fresh
     profile and read the first Access sentence. It should say "not on any website yet".
     If it says PiPOSS is allowed "on the websites you have chosen", Safari's `getAll()`
     reports *declared* host permissions rather than granted ones and the three-state
     logic needs a different signal. Wrong in the harmless direction, but it is the first
     sentence a new user ever reads.
163. **For T10:** the auto-PiP toggle exists and writes the setting, but nothing reads it
     until you land. The README documents the shipping state deliberately (DECISIONS 117);
     T15's repair-map row 5 is yours.
164. **For T13, raised now by four separate agents:** RRR §9 names a prettier check that
     **nothing enforces** — no `format:check` script, not in `pnpm run build`, not in
     `make check`, not in the Xcode phase — and `prettier --check .` currently fails on
     two files that have been that way since 2022. The bundle-size budget is likewise
     printed but not enforced. A criterion in the requirements with no gate behind it is
     the gap that let two broken builds through already.
165. **Small and unowned:** the options page's copy is not localised although `_locales/`
     exists and the manifest uses `__MSG_` placeholders; and the freshness serial's
     discarded-read line is untested but would paint the true state anyway.

## 2026-07-27 · BF01 The wedged PiP toggle

166. **The wedge was permanent, not two presses — my own plan text understated the
     bug.** PLAN said the video "will not leave PiP until toggled twice more". Measured
     by the reviewer in a standalone script against both versions side by side: the old
     code rewrites `'picture-in-picture'` on **every** wedged press, so it is a stable
     fixpoint. Ten consecutive presses do not escape; only an external action does.
     DECISIONS 29's original wording was the accurate one. PLAN corrected at acceptance.
167. **The fix writes the record only when *entering* PiP, and refuses to restore into
     PiP.** Both halves are needed and both are independently pinned — the reviewer
     mutated them separately and each dies on tests the other half does not reach.
168. **The record is deliberately *not* cleared on the way out**, which is what makes
     fullscreen → our PiP → our toggle back → Safari's own PiP control → our toggle
     return the user to **fullscreen**. Under the old code that same sequence was the
     wedge. The rejected alternative (clear on exit) is pinned by four tests, so nobody
     can quietly simplify it back — and notably it leaves every `setMode` sequence in the
     suite untouched, so the only assertions that can catch it are the two the executor
     changed. Which is the evidence those changes were correct rather than convenient.
169. **It also cures a second bug nobody was looking for.** Modelled with a
     deferred-application controller: double-pressing while *leaving* PiP from fullscreen
     left the old code stuck in PiP; the new code lands in fullscreen. Entering is
     byte-identical to before, so no regression on that side.
170. **The fix does not depend on synchronous `webkitSetPresentationMode`**, which
     matters because the real API is async while the fake applies modes immediately. The
     mode is read once into a local before `setMode`, the record is written from that
     local, nothing is re-read, and the entering/leaving branch is taken from WebKit's
     **live property** rather than from tracked state. That last part is pinned: deciding
     the branch from the stored record instead dies on three tests. This is also why
     BF01's class of bug disappears rather than moving — an unobserved external
     transition is simply observed on the next toggle.
171. **Deny, not allowlist**, per PLAN's wording: refuse to restore into
     `'picture-in-picture'` rather than admitting only `'fullscreen'`. The deny form
     forwards a hypothetical fourth WebKit mode correctly where an allowlist would
     silently flatten it to inline. The reviewer found this justification **unpinned** —
     the allowlist mutation survived all 348 tests — so a test now enters from a cast
     future mode and requires it restored. The executor then added the *strongest*
     allowlist form as a second mutation, so what the test pins is the **shape** of the
     guard rather than an omission in it. Cost of the deny form, accepted knowingly: no
     runtime validation of a garbage value — but HEAD forwarded arbitrary strings too, so
     BF01 makes the filter strictly tighter.
172. Bundle 5857 B → **5893 B** (+36 B), 48% of the 12 KB cap. 343 → 349 tests.
     29 mutations between the two agents, 27 dead, two survivors accepted as provably
     equivalent — one of them (moving the dataset write after `setMode`) verified by
     tracing the single path where the two forms differ, a throwing `setMode`, and
     showing it collapses into the documented residual.
173. **The executor caught its own mis-constructed mutation.** Its first attempt at one
     half of the bug reduced to the ordering mutation and appeared to survive; it
     noticed, rebuilt it, and the rebuilt form dies on five tests. A survived mutation
     that is really a broken mutation is exactly the failure DECISIONS 87 warns about,
     and this is the first time an agent caught it in its own work rather than having it
     caught for them.

Tails with addressees:

174. **For T10 — a direct consequence, not a suggestion.** Auto-PiP must enter through
     `togglePiP`, **not** by calling `controller.setMode` directly. Setting the mode
     yourself is an unobserved external entry from `togglePiP`'s point of view, so it
     manufactures a fresh instance of BF01's residual — self-inflicted — and the user's
     next hotkey press restores them to a mode they were never in.
175. **BF02 is booked** for the residual's proper fix, with the reviewer's condition
     adopted: listen for `webkitpresentationmodechanged` so the *browser* maintains the
     record, **and** move the record off `video.dataset` into a `WeakMap` in the same
     stroke. The second half matters on its own — the record currently lives in a
     page-writable DOM attribute. Honest cost recorded in the task: a WebKit-only event
     name cannot leave `core/presentation.ts` under RRR §6, so the protocol grows a
     fourth member plus a fake and a listener lifecycle that has no home in `core/` yet.
176. **A single point of failure worth knowing about:** exactly one test kills the
     anti-PiP guard — the replacement for the old "today's quirk" characterisation. It is
     deliberate and well-named, but there is no redundancy: delete it and half the fix
     goes unguarded.

## 2026-07-27 · T10 Auto-PiP on tab hide

177. **The feature nearly got cancelled on my own bad research, and the reviewer
     saved it.** I read WebKit's PiP gate, found `RequireUserGestureForFullscreen`
     added unconditionally on macOS, concluded a `visibilitychange` handler could
     never enter PiP, wrote that into `docs/research/`, and handed the owner a check.
     **Wrong.** `HTMLMediaElement::removeBehaviorRestrictionsAfterFirstUserGesture`
     (`HTMLMediaElement.cpp:9037`) strips a mask that explicitly names that
     restriction (`:9048`), called from `play()`, `setVolume`, `setMutedInternal` and
     others under `processingUserGestureForMedia()`, and it is **never re-added**. One
     click on play opens the gate for that element's lifetime, `visibilitychange`
     included. Corroborated by `:7786`, where WebKit refuses every presentation mode
     from a hidden document **except** PiP — entering PiP because the document went
     hidden is a carved-out supported path, not something we slipped past.
178. **How I got it wrong matters more than the fact, and it is recorded in the
     research file.** I searched by symbol name, found two files that told a
     complete-looking story, and stopped. The file that reverses it is **399 KB**, and
     **GitHub code search silently skips files that large** — so a search that omitted
     the decisive file looked exactly like a search that found everything. Then I
     treated "I cannot find the relaxation" as "there is no relaxation". The fix is one
     command: `curl` the raw file and grep locally rather than searching the host.
179. **The muted exclusion is structurally load-bearing, not a taste call**, which is
     a better reason than the one it was argued from. The single case where the gate
     stays shut is a video that autoplayed **muted and was never touched** — no gesture
     ever reached `play()`. That is precisely what the rule already declines to act on,
     so the predicate and the platform's own precondition are nearly the same set. The
     original argument (WebKit permits gesture-free autoplay only while muted) was a
     correlation; this is a near-identity. Limit noted: *Allow All Auto-Play*, or a
     video with no audio track, breaks the implication in the permissive direction.
180. **The muted rule also survives the length rule on its own merits.**
     `<video muted autoplay loop>` is how GitHub, Reddit and Imgur serve what used to
     be GIFs, and those run twenty to sixty seconds — so the shorter-than-5-seconds
     rule catches almost none of them. Without the muted rule a user who enabled this
     would get a README demo clip flung into PiP on every tab switch. The accepted
     price, stated in the module: someone deliberately watching with the sound off gets
     nothing from this feature.
181. **`webkitSetPresentationMode` must not be "modernised" to
     `requestPictureInPicture`.** The standard API is *stricter*: raw transient
     activation, no first-gesture escape hatch, rejects with `NotAllowedError`. We are
     on the permissive entry point. A tidying change there would silently delete this
     feature. Warning written at the call site and in the research file.
182. **An `audioTracks`-based exclusion was refused, and the reviewer said it would
     have refused harder.** `audioTracks` is not reliably populated for cross-origin
     media and varies across HLS/MSE; a wrong `length === 0` reading would exclude
     **every** cross-origin video and silently disable the whole feature — DECISIONS
     163's failure mode reintroduced deliberately, against the accepted cost of an
     occasional silent clip floating out. So a video with no audio track does fire, and
     the README no longer implies otherwise.
183. **`pickVideo` is deliberately not reused.** Its "a lone video wins even if
     paused" rule is right for the hotkey — the user pressed a key and meant *that*
     video — and wrong here, where RRR §4.6 says "while a video is playing". Auto-PiP
     also has a rule `pickVideo` has no equivalent of: **if any video on the page is
     already in PiP, do nothing.** The reviewer probed that guard by deleting it and
     confirmed the consequence the executor predicted — the second tab-hide issues
     `setMode(video, 'inline')` and **pulls the video back out of PiP**. The worst bug
     in the neighbourhood, and it is pinned.
184. **Every cause of `visibilitychange` is honoured**, not just tab switching:
     minimise, display sleep, app switch. No API distinguishes them, and in each case
     the user stopped looking while PiP floats above other windows. So the feature
     slightly exceeds its label. The cost, named rather than hidden: minimising Safari
     *to get rid of* the video hands you a floating window over everything — acceptable
     only because the feature is opt-in and off by default. `visibilityState ===
     'hidden'` was chosen over `document.hidden` because the latter is also true for a
     prerendered document nobody has seen.
185. **DECISIONS 116 held against a challenge.** T10 rewrote the README to say "clips
     shorter than **five seconds**"; it goes back to "clips of a few seconds". The new
     argument that decides it did not exist when 116 was written: `isTooShort` returns
     `false` for `NaN`, so a 3 s clip whose metadata has not arrived when the tab hides
     **will** float. Naming the number converts a soft description into a guarantee the
     code does not keep, and makes it precisely falsifiable — which is the
     boundary-testing 116 predicted. The executor noted it had written that `NaN` branch
     itself and should have caught the contradiction.
186. **Two justifications were written down and unguarded** — DECISIONS 171's shape a
     third time. `MIN_AUTO_PIP_DURATION_SECONDS = 5` → `4` passed all 397 tests, because
     every boundary test spelled the constant symbolically: **exporting the constant is
     what removed the only thing pinning its value.** And `!== 'hidden'` → `=== 'visible'`
     passed too — the exact `document.hidden` semantics the comment argues against. Both
     now pinned, the first in two independent ways.
187. Bundle 5893 B → **6668 B** (+775 B), 54% of the 12 KB cap. 397 → **399** tests.
     35 mutations between the two agents, all dead.
188. **Accepted without a re-review pass**, as with T07 and for the same reason: the
     three fixes were specified verbatim by the reviewer and each has a dying mutation.
     Recorded as a visible judgement call.

Tails with addressees:

189. **For whoever next touches `src/core/presentation.ts`:** the
     `requestPictureInPicture` warning currently lives in `autopip.ts` because
     `presentation.ts` was out of T10's scope. It belongs at the call site too.
190. **Multi-frame race, real and pre-existing in kind:** one binding per frame, so N
     frames each playing an unmuted video means N entries racing for the single PiP
     window, last one wins. The toolbar path already broadcasts to every frame, so this
     is narrower than what ships. A fix needs background coordination and would be its
     own task. The already-in-PiP guard is also per-frame and cannot see a sibling
     iframe's PiP, because `webkitPresentationMode` is per-document.

## 2026-07-27 · T08 Live-DOM geometry guard

191. **This suite justified itself immediately by reporting a defect in T06 — and
     the defect was the harness, not the product.** T08 measured that our
     capture-phase click listener never registers on a live watch page: 33
     `addEventListener` calls, no listener present afterwards, because YouTube grafts
     **244 own properties** onto `#movie_player` including a wrapper `addEventListener`
     that silently drops registrations. I booked BF03 on it. The reviewer refuted it:
     **content scripts run in an isolated world**, where per-world DOM wrappers make
     that expando invisible, and T08's harness was injecting into the page's **main**
     world via `page.addInitScript`. Same page, same load, shipped bundle, via CDP
     `worldName`: isolated → `ownKeys=0`, native method, listener **fires**; main →
     243 own keys, listener dropped. The isolated result is exactly the fixture
     control's expectation.
192. **Acting on BF03 would have made things worse.** It would have moved the
     listener to the button and lost row 3 of T06's four-case table — the case the
     player node was chosen for. A real regression to satisfy a harness bug. BF03 is
     kept in PLAN struck through with the refutation, rather than deleted, so nobody
     rediscovers it.
193. **`src/core/inject.ts:44` already stated the fact in prose** — "content scripts
     run in an isolated world that the page cannot see or touch" — and nothing
     connected it to the conclusion. And T08's evidence could never have supported its
     claim: `DOMDebugger.getEventListeners` is **world-scoped**, so it cannot see an
     isolated-world listener even in principle.
194. **The lesson, in the reviewer's framing:** the worry going in was that the
     captured fixture's plain `<div>` player would be too kind and the live page would
     catch what it missed. The failure was the **mirror image** — the fixture was fine;
     the *harness* was less faithful than the fixture.
195. **Making that fact hard to lose took more than moving an assertion, and the
     executor found this by sabotage rather than assuming.** On a plain `<div>` player
     the wrapper columns read **identically in both worlds**, so a reverted `worldName`
     would have passed an offline test built on them. The offline guard therefore
     asserts `CONTENT_SCRIPT_FRAME_FLAG` — imported from `src/core/inject.ts`, not
     copied — in both directions: globals are per-world, so the flag's presence in our
     world and **absence from the page's** is a direct statement of where the bundle's
     top-level code ran. A coarser second catch exists for a dropped `worldName`: the
     world simply does not exist and `evaluate` throws a named error.
196. **§5.3's second half is measured here and nowhere else**, per DECISIONS 147.
     Real playback, 10 s windows: **11–24 coalesced runs against a budget of 60**, with
     childList churn of **283–386 mutations per second**. So the risk threshold named
     in 147 — 6 mutations/s — is exceeded by roughly **50×** and the requirement holds
     only because coalescing collapses ~300/s into ~2/s. Margin 2.5× worst case,
     churn-dependent rather than structural: the per-frame bound alone permits 600.
197. **A run counter that could pass having measured nothing** was caught by the
     reviewer: renaming the selector gave 0 attributed runs and a green
     `toBeLessThanOrEqual(60)`. Now four assertions, including `attributed > 0`, a
     mutation-count lower bound, and a test tying the counted selector to the one
     `src/sites/youtube.ts` actually queries — which fails in 3 ms without a browser.
198. **The spy stub is the one place this suite tests something other than the real
     thing**, and it is contained by per-world prototypes: verified by the reviewer that
     the page world sees `undefined` for all three members, so YouTube cannot be nudged
     onto a WebKit path and the readings stay independent. Its docstring states that it
     counts how many times *our code asked*, not what WebKit would have done, and that
     it cannot model a second click.
199. **Two width modes are unmeasurable live and say so**: `ytp-xsmall-width-mode`,
     because a stylesheet rule hides the size and fullscreen buttons at that width so
     both glyphs read 0×0 — DECISIONS 9's prediction confirmed live — and
     `ytp-big-mode`, unreachable by resizing out to **7680 px** and in theater mode.
     Only the fixture measures those two. `baseline.runs === 0` is now guaranteed by
     construction rather than measured, and its docstring records what it used to buy,
     what it buys now, and that it is the first thing to drop if the test needs to get
     faster.
200. Assertions are **equality with a neighbour**, never absolute (DECISIONS 11/121):
     Δ 0.00×0.00 in all four measured cases, with three *distinct* geometries across the
     fixture's modes (48×40, 32×32, 56×56) so each mode is proven in effect. The
     canary — re-applying T06's old `padding … − 6px` / `border-box` pair — fails all
     three with Δ up to 32 px.

## 2026-07-27 · T09a Access becomes an indicator

201. **The owner overruled a design of mine after using it, and he was right.** The
     Access section shipped with a button calling
     `permissions.request({origins:['*://*/*']})`. His verdict from the built
     extension: the section is *in practice a marker* — it tells you whether you
     configured the extension correctly — so it should be built as the marker it is.
     A control whose effect the user cannot rely on is worse than an honest read-out,
     and the granting belongs where Safari actually does it. RRR §4.3 rewritten; the
     teaching moves to the container app (§4.7, T11).
202. **The four-state logic was kept entirely**, because it is what makes an
     *indicator* correct rather than misleading (DECISIONS 150). The reviewer confirmed
     each state fails independently, and found a **third** route into `unknown` that
     was pinned but unmentioned — a `browser` global with no `permissions` at all,
     alongside a non-array `origins` and a thrown `getAll`.
203. **A forward promise inside shipped product UI, caught and softened.** The new
     copy told the user to open the app because "it draws that part of Safari's
     settings". The reviewer **built the app** rather than reasoning about it: today it
     is still the old screen with a *"Quit and Open Safari Extensions Preferences…"*
     button, so a user following the advice gets no drawing and an app that closes
     itself. RRR §4.3 does permit the options page to point at the app, so the
     exposure was mine — but DECISIONS 117's "rewritten twice is worse than once" was
     scoped to the **README**, developer-facing docs accepted on condition the exposure
     was enumerated. This was the first forward promise in **product UI**, in the one
     section whose entire subject is not saying untrue things. Now: *"Open the PiPOSS
     app — it shows you where to click"* — nearly true today, true the moment T11 lands
     in any form, no second edit needed. An HTML comment records why, so nobody
     "improves" it back.
204. **The same imprecision had survived only where users read it.** T10's README edit
     corrected "playing *with sound*" to "playing and not muted" — literally what
     `!paused && !muted` does — while `options.html` still said "with sound". So the
     precise wording was in the developer-facing surface and the imprecise one in the
     user-facing surface. Now aligned, both on that and on **not** naming the
     five-second threshold (DECISIONS 116).
205. **Attribution corrected on the executor's own objection.** I credited the README
     auto-PiP rewrite to T09a; it was already on disk from T10 when T09a read the file.
     T09a touched only the Access section. So DECISIONS 118's discharge and DECISIONS
     116's near-miss both belong to T10's acceptance, not this one.
206. **Bundle figure corrected:** 6607 → **6202 B**, −405 B, not the −141 B first
     reported. 6343 was DECISIONS 161's T09-era number and predates BF04's
     `STORAGE_UNAVAILABLE_MESSAGE`; the reviewer built HEAD in a detached worktree to
     get a comparable baseline.
207. **A gate blind spot, recorded because it decides BF06's shape.** BF04's permission
     gate compares **top-level namespaces** on the merged `Browser` interface against
     the namespaces the code uses, and never inspects members. So it is *structurally*
     blind to a declared-but-uncalled method, and no amount of strengthening it would
     catch a stray `permissions.request` declaration while the indicator legitimately
     uses `contains`/`getAll`. Undeclaring is the defence — DECISIONS 153's approach.
208. **`lint:ts` does not flag a statement after `return`.** The executor's one false
     survivor was a handler inserted below `initOptionsPage`'s `return` — unreachable,
     so it survived; moved above, it dies. The reviewer confirmed `tsc` reports nothing
     (`allowUnreachableCode` is unset, so TS emits only an editor suggestion). Both
     gates are blind to that shape, which is worth knowing before trusting a survivor.

### T15 repair map, rows 2a–2c replaced — and 2b/2c are **coupled**

| # | README | Sentence | Blocks on | If descoped |
|---|---|---|---|---|
| 2a | 56 | "PiPOSS's settings show where you currently stand," | T09/T09a — **landed** | No action. |
| 2b | 56–57 | "and the PiPOSS app shows you where to click: it draws the part of Safari's settings that decides this." | **T11** | Delete the clause; line 56 ends at "stand." If T11 ships without the drawn mock, cut only `: it draws … decides this` and keep "shows you where to click". |
| 2c | 57–59 | "Changing it is yours to do — either there, or in the access popover next to the toolbar button." | nothing — landed | **Not independent of 2b.** "either there" has no referent but 2b's clause, so deleting 2b makes 2c ungrammatical. Any descope of 2b must rewrite this to *"Changing it is yours to do — in the access popover next to the toolbar button."* |
| **2d** | *product UI*, `options.html` `access-guide` | "Open the PiPOSS app — it shows you where to click." | **T11**, weakly | The row the old map was missing: a T11-dependent claim in the **UI**, not the README. Softened in T09a so it is nearly true today, but if T11 is descoped entirely, delete the paragraph and the two tests naming it. |

## 2026-07-28 · T16 Homebrew cask diff, prepared not pushed

209. **The live cask is wrong for v2 in two ways beyond the version number**, and
     both were found by running `brew info` rather than reading the file. It prints no
     `Caveats` section, so a user on Safari 14 installs cleanly and gets an extension
     that never appears; and its `desc` is the **third** surviving copy of the false
     "custom button" claim (DECISIONS 114) after the README and `messages.json` were
     fixed — a string that `brew search` and `brew info` both display. Fixing two of
     three places had looked like fixing it.
210. **Safari 15.4 gets a `caveats` stanza; `depends_on macos:` stays `:big_sur`.**
     Homebrew has no key for a Safari version. Raising the OS floor was rejected on
     evidence: Safari 15.4 is available *on Big Sur*, so the app's floor (macOS 11) is
     already stricter than Safari's (10.15) and the failure mode is never "your Mac
     cannot" but only "your Safari is old". The reviewer upheld the meta-argument
     too — raising the floor could only exclude working users and enable nobody, so the
     decision holds even if the sourced quote were wrong. `caveats` is the right
     surface because Homebrew prints it at the end of `brew install` and in
     `brew info`, exactly when the user goes looking for the extension.
211. **A fifth stated-as-fact platform claim, caught before it shipped publicly.**
     The first caveats text asserted "PiPOSS will not appear in Safari ▸ Settings ▸
     Extensions" — precisely the claim DECISIONS 115 demoted to a reader-tested
     conditional in the README, because how Safari fails on a manifest it cannot parse
     is not measurable here. Unlike the previous four, this one would have gone out to
     users through `brew install`. Now hedged to match the README. The executor's own
     observation is worth keeping: it had **marked** the one unverified claim it
     consciously sourced (the webkit.org mapping) and **missed** the one it had merely
     reasoned into — and the second kind is more dangerous precisely because it never
     feels like a claim.
212. **`brew audit` and `brew info` are both runnable on an untrusted tap — by
     name.** The `Refusing to load cask … from untrusted tap` refusal is a *by-path*
     artifact, and the executor had generalised from it to mark both unrunnable. Called
     by name with no `brew trust`, `brew audit` reports exactly one finding on the
     placeholder (`sha256 string must be of 64 hexadecimal characters`) and is
     **completely clean** with a real hash — the strongest available evidence that the
     proposed cask is correct Homebrew, and it had been left out of a file whose whole
     premise is that every command is correctly marked. No `brew trust` and no
     persistent Homebrew config change was ever needed.
213. **Rendering the cask caught a defect that both linters passed.** `brew info` on
     the proposed cask printed `check Safari"'s version` — a shell-quoting artifact from
     how the file was generated. `ruby -c` and `brew style` both accepted it, because it
     is valid Ruby. So **free text in a cask must be read as rendered, not merely
     linted**: the two gates check syntax and style, and neither reads the sentence a
     user will see. Recorded in the doc.
214. **The `sha256` procedure is proved end-to-end rather than described.** Hashing
     Homebrew's cached 1.0.3 zip yields `f940e6d5…cab5d6`, byte-identical to the value
     pinned in the live cask, at the exact size the GitHub releases API reports —
     independently reproduced by the reviewer. The placeholder is unmistakable, survives
     both linters, and is caught by `brew audit`. **No hash was invented.**
215. **Cask version `2.0.0`**, with the hard constraint verified two ways: the cask's
     `url` interpolates `#{version}`, and existing tags are bare (`1.0`, `1.0.1`,
     `1.0.2`, `1.0.3`, no `v`) per both `gh api` and local `git tag -l`. So project,
     tag and cask must all read `2.0.0`.
216. **`uninstall trash:` verified three ways, nothing to change:** a `~/Library` sweep
     plus a broader `org.artginzburg*` search, Homebrew's own `INSTALL_RECEIPT.json`
     `uninstall_artifacts`, and the bundle ids still in the project file. Safari's
     container was deliberately not probed — it can raise a Full Disk Access prompt
     (CLAUDE.md) — and the reviewer added that no third option could have been revealed
     anyway, since a cask must not delete inside another app's container.

Loose ends recorded rather than fixed:

217. **DECISIONS 112's signature verification is no longer reproducible on this
     machine.** The brew-installed 1.0.3 was deleted from `/Applications` while
     Homebrew still records it as installed — `/opt/homebrew/Caskroom/piposs/1.0.3/`
     holds only a dangling symlink, and `brew info` reports "Installed (on request) …
     (0B)". The claim stands on the 2026-07-27 run; it simply cannot be re-run until a
     signed build exists again, and `docs/release.md` says that rather than implying a
     fresh pass. The owner's round-trip step now tells him how to get around the
     dangling record.
218. **`uninstall trash:` was not converted to `zap trash:`** despite that being
     stricter Homebrew convention: it changes uninstall behaviour for existing users,
     has nothing to do with v2, and the current form works. Someone else's call, in a
     repository we do not touch.

## 2026-07-28 · T11 SwiftUI container app

219. **The drawing is drawn from Safari's own source, not from memory.** Safari
     renders that pane from a bundled web page —
     `/System/Library/PrivateFrameworks/Safari.framework/.../ExtensionPermissions.{html,js}`
     plus `en.lproj/Localizable.strings` — and the executor read it. The reviewer
     re-derived every string independently with line numbers: `Permissions:`,
     `Webpage Contents and Browsing History`, the "When you use the “%@” toolbar
     button…" paragraph, `You have not allowed this extension on any websites yet.`,
     and the buttons `Edit Websites…` and `Always Allow on Every Website…` — the last
     gated on `requestedSiteAccess === "All" && configuredSiteAccess !== "All"`, i.e. it
     exists exactly while the user still has the choice. Edit is appended before Allow,
     so the drawing's order is right. Real U+2026 ellipses confirmed into the binary by
     byte search rather than `strings`, which truncates UTF-8.
220. **Six anti-mistake signals, and no single loss makes the drawing passable as
     real** — the question I asked the reviewer to answer, and it walked all of them.
     Numbered callout badges (Safari has none anywhere); a dashed accent border **and**
     an "Illustration — not Safari" chip inside the breadcrumb row, which are two
     independent code sites so losing one leaves the other; placeholder grey bars
     instead of body text; no window chrome at all — no traffic lights, title bar,
     toolbar or Safari icon; `allowsHitTesting(false)` plus one accessibility element
     whose label opens "Illustration, drawn by PiPOSS and not a picture of your
     Safari."; and a **sixth in a different file** (`ContentView.swift`) saying it is
     not a screenshot and the user's Safari may differ, which an edit confined to the
     diagram cannot remove.
221. **Nothing invented, with one exception named rather than hidden.** The Settings
     window's pane toolbar, the sheet the button opens, and other extensions' names are
     all undrawn — a wrong guess there would have turned the illustration into an
     invented screenshot, and unnamed grey rows are the honest rendering. The one
     unsourced UI element is the per-row enable checkbox, which is AppKit and not in
     the quoted resources; flagged for the owner's eye rather than returned.
222. **The quit-after-preferences behaviour is removed.** It was defensible in 2022,
     when the window held one sentence and a button that even said "Quit and Open Safari
     Extensions Preferences…" — there was nothing to come back to. Now the window's main
     content is a drawing of the pane the user is about to look at, so quitting destroys
     the guide at the moment it becomes useful. This is DECISIONS 203's complaint
     ("an app that closes itself") in its original home. Still not resident:
     `applicationShouldTerminateAfterLastWindowClosed` returns true and
     `File ▸ New Window` is removed, so one window is the whole app.
223. **No SF Symbols at all** — the checkmark is a `Path`. So nothing can silently
     render blank on an older system, and a clean compile at an 11.0 deployment target
     *is* the availability proof, since availability is a hard error rather than a
     warning.
224. **T15 repair-map rows 2b, 2c and 2d are discharged.** README's "it draws the part
     of Safari's settings that decides this" is now true, and `options.html`'s "it shows
     you where to click" is now literally true.
225. **The options-page button reports rather than promises** (BF07). There is **no
     public API** for a container app to open a web extension's options page;
     `SFSafariApplication.dispatchMessage` is the only route and it needs a
     `runtime.onMessage` listener that `src/background.ts` does not have. So the button
     dispatches and then says what it did, naming the route that always works — honest
     under both outcomes without the user decoding anything, which is DECISIONS 201
     applied to a control the author could not verify. It also declines to print a guess:
     Safari's string table carries a bare `"Settings"` that is *very likely* the
     options-page button, and the code says so in a comment rather than in the UI.
226. **This is the least agent-verifiable task in the project** and the review is
     explicit about the line. Verified mechanically: the cold build with warning counts
     matching DECISIONS 149's established inventory exactly (2 + 1 + **0** Swift
     warnings), zero `codesign` invocations, the new types present in the **binary** by
     demangled symbols with `ViewController` at zero, SwiftUI linked and WebKit not, no
     storyboard/nib/HTML/JS/CSS anywhere in the bundle, no `NSMainStoryboardFile` in the
     built `Info.plist`, and the JS side untouched at 399 tests. Everything visual is
     the owner's — see REPORT.md.
227. **One decay hazard worth a later pass:** the diagram's accessibility description
     hand-duplicates the drawn strings, so if Safari renames a button and only
     `DrawnButton` is updated, the spoken label drifts silently and nothing catches it.
     A shared constant would fix it.

## 2026-07-28 · T12 XcodeGen project definition

228. **DECISIONS 10's prediction did not come true, and the reason it can be trusted
     is `settingPresets: none`.** XcodeGen contributes none of its own defaults, so
     every setting in the generated project is a line in `project.yml` and the whole
     thing is auditable. Executor and reviewer each diffed independently — declared, by
     parsing both `.pbxproj` files, and **effective**, ~590 settings per target per
     configuration via `-showBuildSettings`. Exactly five intended changes, four
     configurations, nothing else in either direction.
229. **SUPERSEDED on 2026-07-28 — read 272 first.** This entry's central claim became
     false four commits later and the correction lived only in a YAML comment until
     T18's reviewer noticed. `project.yml:123,184,256-260,443-448` now **does** emit
     `CODE_SIGN_IDENTITY`, `CODE_SIGN_STYLE` and `DEVELOPMENT_TEAM`, deliberately and of
     necessity — `40befc9` restored them because without them Safari would not register
     the extension at all (BF09, which the owner found). The keychain trap is therefore
     closed by the **rule in CLAUDE.md and the flags at the call site**, not structurally
     by the project file. What follows is the original text, kept because the reasoning
     about *why* structural beats conventional is still right and is what 272 acts on:
     
     ~~`project.yml` emits **no** `CODE_SIGN_IDENTITY`, `CODE_SIGN_STYLE` or
     `DEVELOPMENT_TEAM`, so a bare `xcodebuild` resolves `CODE_SIGN_IDENTITY = -` —
     ad-hoc, with no identity to look up and therefore no keychain path at all. Before,
     the safety depended on everyone remembering to pass flags; the incident of
     DECISIONS 74–77 happened because the project pinned `"Apple Development"` in all
     four configurations. The owner's signing flow is preserved by naming the settings
     at the call site in the Makefile. Verified: the product carries only
     `flags=0x20002(adhoc,linker-signed)` with no `_CodeSignature`, and DECISIONS 104's
     attack still holds under the new flags.
     Documented cost: **building from Xcode's UI now signs ad-hoc.**~~
     *(End of superseded text. That documented cost turned out to be the bug BF09 fixed:
     an ad-hoc appex is exactly what Safari will not register.)*
230. **The staleness bug is fixed and the fix is verified by repeating the original
     experiment.** 27 `inputFiles` naming every source by name plus the manifests, the
     three tsconfigs, `esbuild.config.js` and `pnpm-workspace.yaml` (DECISIONS 18), with
     `outputFiles` naming all three bundles — and the `src` directories kept as inputs
     because they are what notices a file being added or removed. Pre-migration: phase
     ran **0** times and a `/*STALE*/` marker shipped inside the `.appex` with
     `BUILD SUCCEEDED`. Generated: phase ran **1**, marker gone.
231. **A gate almost retired itself, and this is the sharpest thing in the task.** The
     resource gate read the *first* project definition it found. The moment `project.yml`
     existed, that was the spec — and the `.pbxproj`, which is what actually decides
     what `xcodebuild` copies, stopped being checked. The reviewer proved it rather than
     arguing: running the **pre-T12** test against the same wrong-target mutation passes
     **33/33**. So migrating to a text project format would have silently disabled the
     protection that this very task was asked to strengthen. It now checks **every**
     definition on disk, and each branch was mutated separately to show it bites alone.
232. **The third instance of a gate matching the wrong text, now written down as a
     rule.** DECISIONS 159 was comment-stripping in the wrong order emptying the
     entry-point gate; DECISIONS 207 was a namespace gate structurally blind to a
     method; this one was the needle `dist` matching **the extension list's own
     comment** explaining why `dist` must stay a folder reference — 33/33 green. The
     common shape: these gates are text searches over a file that also contains prose
     about itself, and **the more conscientious the comment, the likelier it contains
     the words the search is looking for.** Good documentation breaks a naive gate. The
     fix reached further than the reported hole, too: the same helper finds the *anchor*,
     so a comment mentioning `manifest.json` could have nominated the wrong target — a
     hole nobody had seen. The rule is now in the test's own docstring for whoever adds
     the next branch.
233. **A shared scheme, and the project is gitignored** per RRR §8. The scheme
     previously lived only in gitignored `xcuserdata` and `-scheme PiPOSS` worked purely
     because xcodebuild autocreates it. Generation is deterministic — three runs produce
     byte-identical output — and a fresh clone builds through a real Makefile file rule
     `$(PBXPROJ): project.yml`, deliberately not phony, because regenerating on every
     invocation would rewrite the file and force xcodebuild to re-plan.
234. **Version set to 2.0.0 / build 5** on both targets, agreeing with
     `docs/release.md`'s cask diff. DECISIONS 215's constraint is what forces the
     agreement: the cask's `url` interpolates `#{version}` and existing tags are bare,
     so project, tag and cask must all read the same string.
235. **An executor dressed a judgement as an external limit, and owned it when
     caught.** It declined to write the `inputFiles` completeness test and gave the
     reason "acceptance pins the suite at 399". The reviewer pointed out that 399 is a
     number in a report which has already moved (341→343, DECISIONS 161), so it was
     never a constraint. The executor's own account is the useful record: the decision —
     that the check was outside item 3's scope — was right, and reaching for the count
     instead of saying so was the worse of the two failures, because it would have
     taught the next reader that the number is frozen. **It is not frozen.**
236. **A negative reproduction can lie, and now says so.** The staleness bug is about a
     *directory node's* mtime, so writing a marker **in place** (`cp`, `>`) reproduces it
     while `mv`-ing a rewritten copy — or any editor that saves by rename, which many do
     — replaces the directory entry, changes `dist` itself, and makes the phase re-run
     **even on the pre-migration project**. The reviewer hit exactly that and it briefly
     looked as though the bug had never existed. `docs/development.md` now ends the
     recipe with the instruction that matters: if a reproduction comes back negative,
     check how the file was written before concluding anything.
237. Inert differences recorded rather than buried: the empty `PBXFrameworksBuildPhase`
     is gone and XcodeGen cannot emit one — it listed zero files and both frameworks link
     via `OTHER_LDFLAGS`, confirmed in the binary; `objectVersion` 55→77; some IDE
     metadata dropped; `knownRegions` reordered. All proven inert by the 590-setting
     effective diff.

## 2026-07-28 · T13 CI, and three criteria that finally check something

238. **Three requirements existed with nothing behind them, and each is now a gate
     that has been shown to fail.** RRR §9's prettier check (raised by **five** separate
     agents — DECISIONS 34, 110, 164), RRR §5.2's 12 KB content-bundle cap, which
     `make check` printed and enforced nowhere, and the `inputFiles` completeness the
     T12 review measured. Each was demonstrated dying against a real mutation *and*
     shown unable to pass while measuring nothing.
239. **The format gate could have been the emptiest gate in the project.** Measured:
     `prettier --check .` with `**` in `.prettierignore` prints *"All matched files use
     Prettier code style!"* and **exits 0** over zero files. So `test/format.test.ts`
     asserts coverage through prettier's own `getFileInfo`, with `ignorePath` set to both
     ignore files because the **API default differs from the CLI's** — without it
     `dist/content.js` reads as checkable. Under the `**` mutation the CLI stays green
     and the guard fails.
240. **The prettier debt was decided per file, not wholesale.** `test/live/player.ts`
     (ours, from T08) and `_locales/en/messages.json` (ours, shipped, whitespace Safari
     never reads) were **formatted**. `pnpm-lock.yaml` is **ignored**, because prettier
     disagrees with ~951 of its 1429 lines and pnpm rewrites the file in its own style
     whenever a dependency moves — formatting it would go red on changes that have
     nothing to do with formatting and bury every future dependency bump in reflow. A
     generated file is formatted by its generator. The exclusion is **pinned by a test
     carrying its reasoning**, so removing the ignore line fails rather than quietly
     becoming a habit.
241. **The `inputFiles` gate was tested harder by the reviewer than by its author, and
     survived.** The executor's evidence pointed at a decoy on `project.yml` line 302 —
     but `inputFiles:` is line **318**, so the decoy sits *above* the key and the parser
     never scans it. The reviewer therefore built the real test: three **in-block**
     decoys (a plain comment, a commented list item, and `- # <path>`), the real entry
     deleted, comment-stripping removed — and it **still fails, twice**, the second
     branch catching `- #` as a nonexistent path. The stated defence — parsing
     `- <path>` items and comparing whole normalised paths — is genuinely sound, but the
     evidence originally offered for it was not the evidence that proves it.
242. **A docstring claim corrected because it was not reproducible.** It said that
     removing comment-stripping and moving `dist` to the app target sends the suite
     "back to 37/37 green". Measured: **1 failed | 36 passed**. The `project.yml` branch
     does false-pass — so comment stripping is load-bearing as claimed — but the
     `.pbxproj` branch catches the same mutation independently, because **XcodeGen drops
     YAML comments when it generates**. Reality is *safer* than the claim, and the reason
     is DECISIONS 231's change to check every project definition rather than the first:
     two witnesses, not one. The docstring now says so, and warns against deleting the
     `#` line on the strength of the second witness, since a spec-only fresh clone has no
     generated project to be that witness.
243. **CI is eight make targets, so a red run reproduces with one local command.**
     Runner facts were checked read-only via `gh api` rather than assumed:
     `checkout@v7.0.1`, `setup-node@v7.0.0`, `macos-latest` = macOS 26 with **seven**
     Xcodes, **node 24 is the cached version and 26 is absent** (hence node 24), and
     **xcodegen is not on the image** — which is what makes the `brew install` step
     load-bearing now that the project is generated and gitignored.
244. **A CI comment claimed the wrong Xcode and was corrected.** It said the image
     carries 26.6, "the version this project is developed against". The image **default
     is 26.5**, the workflow sets no `DEVELOPER_DIR`, and the Makefile falls back to
     `xcode-select -p` — so **CI builds with 26.5**. Harmless, and the file's own "the
     default can move" reasoning already covered it, but a wrong version in a comment is
     exactly what misleads someone debugging a CI-only failure.
245. **No release workflow, by measurement rather than preference.**
     `xcrun notarytool history` → exit 64, *"Must provide credentials."* A workflow that
     cannot be run here cannot be verified here, so `docs/development.md` describes its
     five-step shape and names the six secrets it would need instead. RRR §10.2.5 keeps
     the secrets the owner's.
246. **`spctl` no longer contradicts itself in the docs.** `docs/development.md`'s
     release section still advised `spctl -a -vvv` as notarization proof, two paragraphs
     from a new section saying the opposite. Now `codesign -dv --verbose=4` plus
     `xcrun stapler validate`, with "**not** `spctl`" and the RRR §10.2.5 reason —
     `spctl` appears only where it is being rejected.
247. **Accepted with two comment corrections applied by me rather than a further
     round** — a visible judgement call, as with T07 and T10. Both were factual errors in
     prose, the reviewer had measured the correct values, and I re-ran all gates after
     editing: 409 tests, format, lint and build green. A round trip to fix two comments
     whose right content was already established would have bought nothing.
248. Test count **399 → 409**, 12 files, 0 skipped. Verified in a **fresh-clone shape**
     as well (no `.xcodeproj`, `dist/` holding only `.gitkeep`) because CI's step order
     depends on `test` passing before `build` and `project` — all eight steps green, and
     regeneration byte-identical, reconfirming DECISIONS 233.

Loose ends recorded:

249. **`ci.yml` sits outside every gate T13 built.** `format:check` runs with its working
     directory in `Resources`, so the workflow file itself is not format-checked — though
     `getFileInfo` says it would be checkable if it were in scope. Same for the Makefile
     and the root Markdown, deliberately: reformatting RRR/PLAN/DECISIONS would be
     enormous churn for no gain.
250. **YAML syntax is checkable here; GitHub's workflow *schema* is not.** The executor's
     "only a push can prove" list slightly overclaimed on the first and omitted the Xcode
     version and the unchecked-workflow point above. No `actionlint` is available.

## 2026-07-28 · T14 Icon Composer icon

251. **The `.icon` format was established from Apple's own compiled icons, not from
     documentation or memory.** `assetutil --info` on FaceTime's `Assets.car` gives
     `IconImageStack`, `CanvasWidth/Height 1024`, three appearances, `AssetType: Vector`
     layers with `RenditionName: image.svg`, and the group effect keys
     (`LayerHasSpecular`, `LayerShadowStyle 3`, `LayerShadowOpacity 0.5`,
     `LayerTranslucency`, `LayerBlurStrength`). Xcode's `StandardFileTypes.xcspec` gives
     `folder.iconcomposer.icon`, and `AssetCatalogCompiler.xcspec` lists it under the
     `actool` grouping. Icon Composer.app was never launched — it is a GUI.
252. **No background layer, for a reason stronger than the one first given.**
     FaceTime's layer 0 is `AppIcon_Assets/Gradient-1` with `AssetType: **Named
     Gradient**` — a different asset type from the `Vector` layers above it — and our own
     `fill: "automatic"` compiled two Named Gradients with `glyph` the only `Vector` in
     the catalog. **The background is typed as a fill by the format; there is nowhere for
     background art to go.** A background layer would composite over the one the renderer
     draws and would also take the group's shadow, specular and translucency.
253. **The baked filters never needed stripping, because the owner's other export
     already is the flat glyph.** `ToolbarIcon.svg` has the outline outlined, the three
     dots cut as even-odd holes rather than white circles on top, and no filter — and it
     is provably the same drawing as `PiP-final.svg`'s glyph translated by exactly
     **(+50, +49)**. Verified twice by the reviewer, independently of the executor's test:
     with its own SVG tokenizer handling implicit-lineto-after-`M`, x deltas ∈
     [49.9996, 50.0003] over 52 samples and y ∈ [48.9995, 49.0005] over 54; and by
     rasterised alpha-mask comparison at 1580², where **0.18 % of ink differs** against
     **143 979** hard differences for a 2-unit control shift.
     Method detail worth keeping: coordinates are paired **by SVG command**, not by
     position, because both cursor paths contain `V` — "every other number is an x" would
     have compared x against y and agreed for the wrong reason.
254. **"Make the symbol bigger" was turned into a measured number.** The squircle is
     **824/1024 = 0.8047** on FaceTime, Stocks, Chess, TV, Podcasts, Reminders, Music and
     ours — fixed by the format, not ours to choose. What is ours is glyph ÷ shape:
     FaceTime 0.688–0.694, Stocks 0.675–0.786, Chess 0.738–0.748, TV 0.748–0.752.
     PiPOSS **was 0.633**, is now **0.7209** at 1024 and **0.7184** in the built app —
     the middle of a band the reviewer reproduced. Confirmed that a glyph filling
     fraction *f* of the layer canvas fills exactly *f* of the rendered shape, centred,
     with 29 px clearance and the bbox corner geometrically inside the corner arc.
255. **Toolbar icons stay a PNG size map and stay pure black**, per RRR §12's
     correction: SVG in `action.default_icon` works only from Safari 16.4 while MV3's
     floor is 15.4, and a manifest cannot declare an SVG plus a raster fallback. Both
     agents decoded the PNG bytes with no image library — the reviewer from **inside the
     built `.appex`** with its own zlib decoder — and all six report **zero coloured
     pixels**, while the six colour icons do report colour, which is the non-vacuity half.
256. **A sixth stated-as-fact platform claim, in three files.** "`type: file` is
     required, or the bundle would be walked as a group and `icon.json` and
     `glyph.svg` added as loose resources." The reviewer removed the line, regenerated,
     and got a **byte-identical `project.pbxproj`**; in an isolated spec XcodeGen 2.46
     emitted one opaque `PBXFileReference` for `.icon` **and** for a fabricated `.zzz`,
     so the claim is false generally. Worse, the sentence beside it said the test checks
     for `folder.iconcomposer.icon` while the test says in so many words *"Deliberately
     NOT asserted"* — a comment describing a check the checked file disclaims. The line
     is kept as defensive; four sites now say so. Four of the six such corrections in
     this project have been mine.
257. **A latent false failure removed rather than widened.** `render.swift`'s guard said
     the glyph is `149.3` wide; it measures `149.40`, and the test derived its fraction
     from that constant: `149.3/207.5 = 0.71952` passing `toBeCloseTo(0.72, 3)` by
     0.00048 against a 0.0005 tolerance. `149.4/207.5` is **exactly** 0.72, delta 0.0.
258. **No committed intermediate layer SVGs**, against PLAN's file list and for a good
     reason: a generated file nothing reads is a second source of truth that drifts —
     DECISIONS 227's decay hazard. A generator (`design/icon/render.swift`, `make icons`,
     14 byte-identical outputs) plus a derivation test is stronger.
259. `AppIcon.appiconset` and the empty `LargeIcon.imageset` are deleted. The compiled
     `.icns` has four representations (16/32/128/256) — **byte-for-byte the same set as
     FaceTime and Stocks**, with the 1024 art living in `Assets.car` under
     `CFBundleIconName`, which macOS 12+ reads. A macOS 11 Dock would upscale from 256;
     stated rather than hidden. 409 → **432** tests.

For the owner, RRR §10.2.4 — two visual consequences, both one key to reverse:

260. **The two surfaces now disagree.** The compiled app icon runs light-at-top
     (Icon Composer's `Gradient-1`: `#FFFFFF` → `#ECECEC`, confirmed by sampling the
     built `.icns`), while the flat PNGs keep the owner's light-at-bottom. So the Dock
     and Safari's extension list read opposite ways. Keeping Icon Composer's is the
     right call — it matches the specular direction and every stock icon, and dark mode
     stays adaptive, where an explicit gradient would freeze it near-white — but it is
     **his artwork, changed**, and it is now its own section in `docs/icon.md` rather
     than a parenthetical.
261. **His teal is lightened on the app icon.** `translucency: 0.5` plus specular render
     `#36DBC7` as roughly `#79E8DA`–`#8CEBDF`; the flat PNGs stay exactly `#36DBC7`.
     0.5 matches Apple's own and his own `MiddleClick.icon`, but those sit a saturated
     glyph on a dark or coloured background, where this one sits on near-white.
     `"translucency": {"enabled": false}` is the one-key reversal, and it is his call.
262. Whether 0.72 **looks** right in a real Dock, in Safari's settings list and at 16 px
     is not measurable and remains his. So are the dark and tinted appearances, which are
     compiled and present but never seen — and the fact that the three dots are now
     **holes**, so in dark mode they go dark rather than staying white.

BF06 — undeclaring `permissions.request`:

263. **The comment was the guard, and a comment is not a guard.** After T09a removed
     the last call, `request` stayed declared with a note saying "do not write a call
     to this". BF04's namespace gate compares *top-level namespaces* and never
     inspects members (DECISIONS 207), so nothing would have failed. Undeclared, a
     call now fails `tsc` in both projects with `TS2339`. This extends DECISIONS 153's
     precedent from `permissions.remove` to `request`: for this file, **the absence of
     a declaration is the mechanism**, and what the declaration knew moves into the
     "deliberately absent" section so undeclaring costs no knowledge.
264. **The fake keeps `request` as a recording-only tripwire** — records the call,
     resolves `false`, grants nothing, throws nothing. Two reasons over deleting it:
     T09a's assertion `expect(fake.permissions.requestCalls).toEqual([])` is what
     makes the product claim bite, and a *throw* could be swallowed by a caller's
     `.catch` and go silent, where a recorded array always fires. `userGrants`,
     `requestFailure` and the gesture-throw are gone, having zero callers — but the
     gesture-throw's measured content (jsdom's `globalThis.event` window equals
     Safari's `UserGestureIndicator` window, DECISIONS 151/152) stays quoted at its
     old site, so re-declaring `request` is a copy-paste and not a re-derivation.
     Stated plainly: the fake no longer enforces Safari's gesture rule for `request`,
     because there is no longer anything to enforce it against.
265. **Tail for BF05 and for whoever touches `browser.d.ts` next.** The same
     "declared, never called, invisible to every gate" shape survives in four more
     places, none of which is a product-honesty claim, so none is urgent:
     `BrowserStorageArea.remove` (**no `src/` call site at all** — the closest
     analogue to what BF06 just removed), `BrowserInstalledDetails.previousVersion`,
     `BrowserScriptingResult.frameId`, and `BrowserMessageSender.url`/`.tab`. Also
     stale and left deliberately outside BF06's surface: `test/manifest.test.ts:311`
     still calls `host_permissions` "the thing the options page can later request",
     untrue since T09a. **BF05 owns both**, since it is already opening that file.

BF08 — the access guide when the extension is off:

266. **Byte-searching a built binary cannot see a Swift literal of ≤15 UTF-8 bytes**,
     because Swift stores small strings inline in code rather than in `__cstring`.
     Measured twice independently, executor and reviewer, with a clean split at 15/16:
     `"Permissions:"` (12) and `"click this"` (10) are ABSENT from a binary that
     contains them, while every literal ≥16 bytes is FOUND. **This is bigger than
     BF08:** DECISIONS 219 used byte search as acceptance evidence and happens to have
     used only long strings, so it survives — but any future gate that byte-searches a
     short string will "prove" it missing and pass vacuously. Two corollaries: a short
     hit can be a coincidence (`"PiPOSS"`, 6 bytes, is FOUND via the bundle name and
     symbols, not as a literal), and `grep -F` with an embedded newline splits the
     pattern and reports a **false** FOUND — use a byte search, not grep.
267. **"Safari prints no explanation of the greying" was false, and it was stated in
     the one file whose value is documented ground truth.** The first enumeration found
     6 uses of `enabled` in `ExtensionPermissions.js`; there are **21**, and two of the
     skipped branches do explain a greying — `:520-528` prints "is not active in any
     profiles" for an empty `Enabled Profiles`, and `:363-393` prints a device-management
     notice for `AllDomainsAreManaged`. The narrow claim survives and is what BF08 rests
     on: when the cause is *this* profile's extension being off — the new-user case, and
     the only one the app can detect — Safari says nothing. Both files now carry the
     narrow sentence. **This is the seventh stated-as-fact platform claim caught in this
     project, and the second where an incomplete grep was mistaken for a complete one**
     (the first was the 399 KB WebKit file). The transferable rule: quote the *count* the
     enumeration is based on, because "the only other uses are X and Y" is a claim about
     coverage that a reader can check, while "nothing else does this" is not.
268. **Two cases where the guide's sentence is not true, kept here rather than only in a
     comment, because it is stated to the user as fact.** "Safari keeps the button greyed
     out until the extension is on" is wrong on a **device-managed Mac** (it stays greyed
     after ticking — though Safari prints its own management notice there) and on a
     **multi-profile Safari** where PiPOSS is enabled in another profile (the button is
     live while our state reads off, since `isEnabledInAnyProfile` ORs across profiles
     while `SFSafariExtensionManager` reports one). Shipped as-is: both fail benignly —
     the user ticks a box they wanted ticked — and detecting either is impossible from
     the app. Deliberately **not** told to the user: that "Edit Websites…" is dead too
     (`:392`), since the guide never asks them to click it and RRR §4.7 says this stays
     one screen.
269. **`emphasised` on a ticked checkbox was a no-op, so `unknown` drew emphasis that did
     not exist** — `fill` and `border` both early-return on `checked`, leaving only a
     `lineWidth` on a `.clear` border, and the call site passed the flag in `unknown`
     where the box is also ticked. The flag's own doc comment said "while the extension
     is off", so the call site now says `&& !state.drawsExtensionTicked` and matches it.
     No pixels change; the code stops claiming something false.
270. **`Color.opacity()` multiplies, so a half-alpha base halves every fraction built on
     it.** Measured: `secondaryLabelColor` is alpha **0.498** light / **0.549** dark, so
     the `unknown` lead-in box rendered a **6 %** fill and **22 %** border where 12 % and
     45 % were intended — the state we are least certain about got the weakest emphasis.
     Fixed with a separate `leadTint` returning `systemGray` (alpha **1.000**, verified in
     both appearances) for `unknown` only; the status dot keeps plain `tint`, where a
     quieter grey is right. Generalises: any `NSColor` semantic label colour is
     translucent, so `.opacity(x)` on one does not mean x.
271. **For the owner's eye (RRR §10.2), from the reviewer's arithmetic:** `off` and
     `unknown` content is ≈732 pt against `idealHeight: 760`, so BF08 spent ~94 of ~122 pt
     of slack and pressing "Open PiPOSS's Settings Page" tips the window into scrolling.
     Nothing clips — it is inside a `ScrollView` — but at `minHeight: 520` the drawing,
     which is the app's whole job, sits below the fold in every state. ±30 pt, since
     SwiftUI's per-view layout is arithmetic on declared values rather than measured.
     Left at 760 deliberately: scrolling is correct behaviour and 760 already exceeds the
     usable height of many 13" screens.

T18's review — the keychain rule was stricter than it needed to be:

272. **Ad-hoc signing takes no keychain path, so an agent *can* verify entitlements in a
     built product.** I told T18 to dump entitlements with `codesign -d` and it correctly
     measured that an unsigned build embeds none — `ProcessProductPackaging` never runs
     under `CODE_SIGNING_ALLOWED=NO`, so there is no `.xcent` and the binary carries
     nothing. Both of us then concluded the check was impossible here and moved it to the
     owner. **Wrong.** `CODE_SIGN_IDENTITY="-"` with signing *allowed* builds successfully,
     invokes `/usr/bin/codesign --force --sign - --entitlements …`, and produces a product
     that dumps `app-sandbox` + `get-task-allow` on both bundles with `flags=0x10002(adhoc,
     runtime)`. `--sign -` has no identity to look up, so there is no keychain access and
     no dialog — verified by running it with the owner asleep and nothing appearing.
     Two hard limits on using it: `get-task-allow` is a development artefact a Developer ID
     build strips, so the dump is evidence about the *declaration*, never about the shipped
     signature; and ad-hoc must never become a default build path, because an ad-hoc appex
     is exactly what Safari refuses to register — that is BF09, which the owner found at
     the keyboard. **The transferable lesson is about the shape of my own rule:** "never
     touch the keychain" is correct, but I had silently widened it to "never sign", and the
     wider rule cost a real verification. A safety rule should be stated as the mechanism
     it forbids, not as the nearest convenient superset.
273. **A gate can be honest about what it checks and still mislead, if the *document*
     overstates its scope.** `docs/app-store.md` claimed the entitlements gate "fails if
     either target loses it or gains anything else". It asserts two named negatives, so
     flipping `ENABLE_RESOURCE_ACCESS_CAMERA` to `YES` shipped
     `com.apple.security.device.camera` in a built product past **11 of 11 green tests**.
     This is DECISIONS 232's family in a new shape: not a needle matching the wrong text,
     but a **list of named negatives sold as a positive assertion over a whole set**. The
     fix is to assert the entitlement set *equals* an allow-list, which covers settings
     Xcode has not invented yet. Rule for future gates: if the guarded thing is a set,
     assert set equality, and if you can only enumerate, say in the prose that you
     enumerated.
274. **DECISIONS 229 was stale and only a YAML comment knew.** It stated that `project.yml`
     emits no signing settings; `40befc9` restored all three four commits later, of
     necessity. Marked superseded in place rather than rewritten, per this file's
     convention. The general problem it exposes: a decision recorded as a *structural
     property of a file* rots when the file changes, while one recorded as a *reason*
     survives — 229's reasoning about structural-beats-conventional is still right and is
     what 272 acts on, even though its factual claim is dead.

T20 — writing the architecture down found five places the requirements were wrong:

275. **RRR §5.1 has no always-on guard, and RRR claimed it did.** §9 asserted "the jsdom
     fixture test is the always-on guard" for the ±1 px rendered-box invariant;
     `test/youtube.test.ts:11-13` says in as many words that it deliberately is not,
     because **jsdom performs no layout**. Since §9 also permits the Playwright suite to be
     skipped in CI, §5's own preamble ("each must be asserted by a test") is unmet for that
     item in a CI-only run. Amended to say so rather than to invent a guard: a jsdom test
     asserting something weaker but *named* the §5.1 guard would be the fifth vacuous gate
     in this project. What is always on is the "no geometry constants" grep — which is the
     honest guard, because T06/T08's fix for the original bug was the *absence* of geometry
     code, not a corrected number.
276. **RRR named a function that never existed.** §5.3 required `addCustomButtons` to be
     coalesced to one run per animation frame; the identifier appears nowhere in the repo
     except that line. The real consumer is the site binding's `refresh`
     (`src/sites/youtube.ts:129`, bound at `:205`, driven from `src/content.ts:122`). The
     requirement was right and its subject was fictional — which is worse than a vague
     requirement, because a reader checking compliance greps for a name and finds nothing.
     Two smaller drifts fixed with it: §9's Build row still said "compile **and sign**",
     contradicting §10.1.4's own 2026-07-27 amendment to unsigned, and §8's tree sketch
     omitted four `core/` modules and BF07's third background listener.
277. **The acceptance test for a document should be run as a test, not read as a spec.**
     T20's criterion was "a fresh agent can locate where to add a second site without
     reading the whole tree", so its review is a fresh agent given **only**
     `ARCHITECTURE.md` and asked to produce the plan, with its guesses recorded before it
     is allowed to look at the code. Decision: review it that way rather than by
     line-checking claims. Why: line-checking measures accuracy, which matters, but the
     criterion is about *sufficiency*, and the only way to measure what a document fails to
     say is to make someone act on it. Generalises to every doc task in this methodology.
278. **The document was written against a mid-flight tree, deliberately.** BF02 and BF07
     were uncommitted when T20 measured, and it documents the tree as it is, naming both
     tasks and the date in its header, rather than documenting HEAD. Endorsed: describing
     HEAD would have made the file wrong the moment I committed, and hedging every
     statement would have cost the crispness that makes it usable. Stated cost, its own:
     if BF07 is reverted, the `background.ts` row and the Swift section need one edit each.

T18, on the second pass:

279. **DECISIONS 272's rule, now a target.** `make entitlements` builds ad-hoc into its own
     DerivedData, dumps both bundles, and requires the key set to **equal**
     `app-sandbox` + `get-task-allow`, plus `flags=…(runtime)` on both. Verified by me, not
     only by its author: `EXIT=0`, zero keychain or identity mentions in the log, and the
     camera mutation dies with `EXIT=2` and a diff of want-versus-got. **Caged deliberately,
     because the cage is the interesting part:** the variable is `ADHOC_VERIFY_FLAGS` rather
     than `SIGNFLAGS_adhoc`, `require-sign` still accepts only `no|dev|devid`, and a test
     asserts all three — so nobody can promote the verification path into an installable
     build, which would reintroduce BF09, the bug the owner found. Ad-hoc is safe to *check*
     with and fatal to *ship*, and those two facts live one line apart in the Makefile.
280. **A split gate must assert that its other half still runs.** The declaration-level
     vitest tests are fast and cover both project definitions; the product-level dump is
     slow and needs Xcode. Putting the dump in vitest would make `pnpm run test` slow,
     Xcode-dependent and unrunnable before `make project`. The cost of splitting is that
     one half can be deleted while the other still looks like coverage — so the fast half
     now asserts the wiring: that `check` still depends on `entitlements`, that the
     allow-list is still those two keys, and that ad-hoc has not become a `SIGN` mode. Each
     was mutated and each failed alone. Also stated in the file's own header: **`pnpm run
     test` is not full coverage of the entitlement set.**
281. **DECISIONS 232, fourth instance, and this one is almost funny: it happened inside the
     gate written to respect it.** The caging test searches the Makefile for the forbidden
     string `SIGNFLAGS_adhoc`, and the Makefile comment explaining the choice says
     *"deliberately not called `SIGNFLAGS_adhoc`"* — so the test went red against a comment
     that agreed with it. Fixed by stripping Makefile comments first. The pattern is now
     four for four: **a gate that searches text will, sooner or later, match the prose
     explaining the search.** Strip comments before matching, always, and prove the strip
     is load-bearing by leaving the needle in a comment.

BF13 — the owner found a regression T18 introduced and I accepted:

282. **A wrong diagnosis, kept as one entry rather than the six it took.** *(Absorbs the
     former 283-286 and 296, which were the same investigation restated as it went wrong.)*

     T18 removed `network.client` and `files.user-selected.read-only`, having measured
     correctly that our source uses neither — no `URLSession`, no `fetch`, no CFNetwork
     link, no `NSOpenPanel`, no `downloads` permission. The owner then found
     `getStateOfSafariExtension` failing, so the app could no longer tell whether the
     extension was on. I diffed the working 1.0.3 out of Homebrew's download cache against
     the broken build — identical appex `Info.plist`, identical bundle identifiers, both
     signed `Apple Development` under the same team, extension registered in Safari — and
     concluded these two entitlements were the only functional difference left. Restored
     them. **It did not fix anything**; the error was unchanged.

     Two rules survive, and they are the whole value of the entry:

     - **"Nothing in our code uses it" is not sufficient grounds to remove an
       entitlement.** An entitlement governs what the sandbox permits the *process*,
       frameworks we only call into included. Still true, and still not what broke this.
     - **A sound elimination over the wrong search space is worthless.** I eliminated every
       difference *inside the artefact* and never established that the artefact was where
       the difference lived. It was not: see 292 — 180 stray app bundles registered with
       LaunchServices. Two warnings had said so in advance, which is the part that stings:
       T18 marked the runtime claim `[not established]` and its reviewer named that exact
       argument as the task's weakest link. I accepted it because the *measurements* were
       thorough, and read thoroughness as proof.

     The entitlements stay restored, but the reason is "unchanged from the shipped release",
     not "needed by SafariServices". The gates assert the set *upward* — they fail if a
     grant disappears — which is honestly the weaker kind of test, and the test's own header
     says so: nothing here proves the grants are needed.
287. **The install-time options tab fired once per profile.** `runtime.onInstalled` is
     per-profile, not per-machine, so a user with ten Safari profiles got ten tabs at
     once. RRR §4.4 asked for a first-run tab to put the site-access choice in front of a
     new user; the requirement was reasonable and its mechanism cannot be made
     once-per-machine from inside an extension. Removed rather than throttled: the
     container app's guide already covers the same ground without seizing a tab, and any
     throttle would need state that survives eviction, which this background page is
     written not to have.
288. **BF07's plumbing went with the button the owner removed**, rather than staying as an
     unreachable listener — `OPEN_OPTIONS_PAGE`, its recogniser, its subscriber, the
     background handler and the cross-language name gate. A declared-but-uncalled path is
     invisible to every gate (BF06), and that gate now guarded a string nobody sends.
     Withdrawing it also retires the only feature in v2 whose delivery route was never
     established, which is a simplification the honest hedged copy could not achieve.
289. **The window size is measured, not chosen.** `NSHostingView` laid out headless with
     the frame modifier stripped, so `fittingSize` reports content rather than the ideal
     it declares: the tallest state is 746 pt at 560 wide, 731 at 620, and **716 from 660
     onward** — a plateau, because the drawn Safari pane is a fixed 364 pt and past that
     only prose re-wraps. So width past ~660 buys no height. 680 × 760 leaves 44 pt of
     slack in the worst state, verified in all three. `minHeight` stays 520 deliberately:
     the ask was that scrolling not be *required by default*, and a window that cannot be
     made small is worse than one that scrolls when you make it small.
290. **The options page's explanatory text failed WCAG in both appearances, and worse in
     light mode than in dark.** `.note` used `color: GrayText`, which is the
     **disabled-control** colour, not a secondary-label colour. Measured from the AppKit
     colours WebKit maps these keywords to, composited per appearance: `GrayText` is
     **1.62** on white and **2.99** on the dark canvas, against a 4.5 threshold. Replaced
     with `color-mix(in srgb, CanvasText 62%, Canvas)` — **6.19** and **7.12**. 62% is not
     a round number by accident: in dark mode it lands on macOS's own
     `secondaryLabelColor` (7.09), so the page keeps the native look exactly where the
     platform colour is legible and beats it where it is not. A plain `color: CanvasText`
     declaration precedes it as a real fallback, since `color-mix` needs Safari 16.2 and
     the deployment floor is macOS 11, whose last Safari is 15.6 — there it degrades to
     full-contrast body text. The owner noticed dark mode; light was the more broken half.
291. **Four texts on the options page cut roughly in half** (5799 → 5433 bytes of markup),
     keeping every phrase something depends on: "only you" and the no-ask/no-request ban
     that `test/options.test.ts` enforces over the whole access section, "Offers keyboard
     shortcuts", and `autopip.ts`'s literal "playing and not muted" (DECISIONS 118). The
     duration threshold stays unnumbered (DECISIONS 116) — "very short" replaced "a few
     seconds".

BF15 — the real cause of the detection bug, and it was the development process:

292. **LaunchServices had 180 PiPOSS bundles registered, 119 still on disk, exactly one of
     them real.** Every `xcodebuild` into `/tmp/piposs-dd-<task>` — mine and every
     subagent's, across two days — left an app bundle claiming
     `org.artginzburg.PiPOSS.Extension`, and LaunchServices registers any bundle it finds.
     SafariServices then resolves that identifier to *one* of them, which is not the app
     the owner is running, and returns `SFErrorDomain` code 1. That is the same error for
     `getStateOfSafariExtension` **and** `showPreferencesForExtension`, which is why the
     app could not tell whether the extension was on *and* its one button "just killed the
     app" — the button was quitting after a call that had silently failed.
     Fixed on the machine by `lsregister -u` on 178 paths plus deleting the directories
     (14 GB). Two entries — one app, one appex — is the healthy state.
293. **No amount of code review could have found this, and that is the point.** The bug was
     not in the repository. Three days of diffing entitlements, `Info.plist`s, signatures,
     bundle identifiers and call sites found nothing because there was nothing there: the
     defect was **state my own tooling had accumulated on the owner's machine.** The
     instrument that shows it is `lsregister -dump`, which nothing in this project had ever
     run. Generalises: when a product bug survives elimination of every difference *inside*
     the artefact, the next hypothesis is the environment the artefact runs in — and an
     agent that builds dozens of copies of a signed, LaunchServices-visible bundle is
     changing that environment whether it means to or not.
294. **Prevention, in the two places that will be read.** `make entitlements` now
     unregisters and deletes its own bundle — and `rm -rf` alone is **not** enough, which is
     measured: after deleting the directory the registration survived, so the order is
     `lsregister -u` first, then delete. CLAUDE.md gains it as a hard rule beside the
     keychain one, since the failure mode is identical in kind: an agent action that is
     invisible in the repo and lands on the owner as a product defect.
295. **The button quits only on success now.** It was unconditional, on the reasoning that
     the error is not actionable. With the call failing, that turned "Safari did not open"
     into "the app vanished and nothing happened" — the owner's *"now it just kills the
     app"*, and strictly worse than the 2022 behaviour it was restoring. On failure the
     window stays, which is the only state where the drawn guide is still in front of the
     person who now has to find the pane by hand. Both SafariServices errors are logged
     under one subsystem, because they fail together.
297. **"Not established" was measured on a broken machine, so it was not a finding about
     the route.** The owner asked whether the settings-page button could be brought back
     now that BF15 is fixed, reasoning that `dispatchMessage` resolves the **same extension
     identifier** as the two calls that were failing against 180 stray LaunchServices
     registrations. He is right, and it is a sharper piece of reasoning than the one it
     corrects: BF07 concluded "we cannot know whether Safari delivers a dispatched message
     to `runtime.onMessage`", and that conclusion was reached in an environment where *no*
     SafariServices call against this identifier could succeed. The evidence was worthless
     for the question it was cited on. Restored.
     **This does not make it work** — Apple still documents `connectNative` + `port.onMessage`
     for app-to-JavaScript and Safari's receiving half is closed source. What changed is
     that **one press is now decisive**, where before a press proved nothing. That is the
     whole value of the restoration, and it is why the dispatch error is logged.
     The transferable rule: *an unestablished claim inherits the validity of the environment
     it was tested in.* Before recording "could not be established", record what would have
     made the test meaningless — here, that every neighbouring call was also failing, which
     was visible at the time and nobody looked.
298. **The port route stays rejected, and for a reason BF15 does not touch.** WebKit forces
     an MV3 background page non-persistent, unloads it 30 s after idle, and **port delivery
     does not wake it** — only events routed through
     `wakeUpBackgroundContentIfNecessaryToFireEvents`, and the port path is not one. At the
     moment the user is in the app pressing a button, the port would usually not exist.
     `runtime.onMessage` is wakeable. That reasoning was sound when BF07 made it and is
     unaffected by the registration bug.
299. **Success is silent; only failure speaks.** `error == nil` from `dispatchMessage` means
     Safari accepted the message, not that a tab appeared, so a note saying "opened" would
     be the one claim this app cannot stand behind (DECISIONS 201, 225). The note therefore
     exists only on the failure path — which also means the window's measured height is
     unchanged in the normal case, and on the failure path the ~30 pt note still fits the
     44 pt of slack BF14 f2 left.
300. **The fifth instance of the needle-in-the-prose trap, and this time the gate was right
     and I was wrong.** My new log line read `dispatchMessage(open-options-page) failed`,
     and `test/container-app.test.ts` counts `dispatchMessage(` to locate the one real call
     site. It strips comments but deliberately **not** string literals — a stripper that
     understood Swift strings would be a parser — so the log text read as a second call and
     the gate failed on its first run. Fixed in the *message*, not the gate: the string is
     now `open-options-page dispatch failed`. Recorded at the log site so nobody reintroduces
     it. Previous four: DECISIONS 159, 207, 232, 281 — and 281 was also inside a gate written
     to respect the rule.

BF17 — the answer, at last, and it is no:

301. **A container app cannot open its Safari web extension's options page. Established, not
     assumed.** The owner pressed the restored button on a machine with BF15's
     LaunchServices pollution cleared: `runtime.onMessage` does not receive a message sent by
     `SFSafariApplication.dispatchMessage`. Removed for good, and RRR §4.7's second button is
     marked as the one requirement in this project the platform refused.
     The remaining route is Apple's documented `nativeMessaging` + `runtime.connectNative` +
     `port.onMessage`, and it is unusable here for a reason nothing in this saga changes:
     WebKit forces an MV3 background page non-persistent, unloads it 30 s after idle, and
     port delivery does not wake it — so at the instant the user presses a button in the app,
     the port would usually not exist. Both doors are shut.
302. **Four tasks to answer one question, and the sequence is the lesson.** BF07 marked it
     `[not established]` and hedged the UI. BF14 removed the button on the owner's word. BF15
     found that BF07's verdict had been reached while *every* SafariServices call against this
     identifier was failing for an unrelated reason — so it had never been evidence. BF16
     restored the button for the sole purpose of making one press decisive. BF17 is that
     press. **The generalisation, which I want to carry to other projects: an unestablished
     claim inherits the validity of the environment it was tested in.** "Could not establish"
     is only useful if you also record what would have invalidated the attempt. Here that was
     visible the whole time — the neighbouring calls were failing too — and nobody looked
     until the owner's own app broke.
303. **The cost of getting there was low precisely because it was written down.** BF16 took
     one `git checkout` of five files because BF14's removal had recorded `git show 39c4b0a`,
     and BF17 took another because BF16 did the same. A removal that says where the code went
     is a removal you can undo in a minute; the alternative is re-deriving four tasks of
     WebKit reading. That is the argument for tombstone comments, and this is the second time
     in this project they have paid (the first was BF02's residual list).
304. **Also withdrawn, and recorded in RRR rather than only in code:** §4.4's first-run tab.
     `runtime.onInstalled` is per Safari profile, so it opened a tab in every profile at
     once. Struck in place with the owner's own words, because the requirement was reasonable
     and it is the *mechanism* that does not exist — there is nothing once-per-machine inside
     an extension, and a throttle would need state the background page is designed not to
     have.

BF18 — the owner asked whether `make app` cleans up after itself. It did not:

305. **Two configurations, one bundle identifier, same DerivedData.** `make app` builds
     **Debug** and `make check` builds **Release** into the same place, so running both left
     two registered apps both claiming `org.artginzburg.PiPOSS.Extension`. Reproduced before
     fixing: after `make check`, `lsregister -dump` listed Debug *and* Release. BF15 was the
     extreme form of this (180 copies); two is the ordinary form, and it is already ambiguous
     — SafariServices picks one member of the set. So the bug was never really "agents leave
     litter", it was **"nothing in this project owned the invariant that exactly one copy is
     registered"**, and an owner running two documented commands could reach the broken state
     on his own.
306. **`make relaunch` now prunes, and the order matters.** Unregistering alone is not enough
     — a bundle left on disk is picked up again — and deleting alone is not enough either,
     because the registration outlives the directory until LaunchServices notices (measured in
     BF15). So `lsprune` unregisters, then deletes. Deletion is confined to
     `…/Build/Products/*/PiPOSS.app` and `/tmp/piposs-dd-*`, which are regenerable by
     definition; every other path LaunchServices reports is only unregistered, never touched.
     Verified: `make check` then `make app` → `pruned 1`, two registrations left (the app and
     its appex), `PiPOSS.app` gone from `Products/Release`, and a second `make app` prunes
     nothing — idempotent.
307. **A loose `.appex` beside the build products is not registered.** `Products/Release` still
     holds a bare `PiPOSS Extension.appex` after pruning, and it does not appear in
     `lsregister -dump` — an appex outside a host app is not an extension provider. Stated
     because it looks like a leak and is not, so nobody widens the deletion rule to chase it.
308. **The general shape, worth carrying out of this project.** Three of the last five defects
     were not in the code: BF13's wrong diagnosis, BF15's 180 registrations, and this. All
     three were **invariants about the machine** that no test could hold, because the test
     suite's world ends at the repository. The remedy that worked each time was the same —
     find the one command that observes the invariant (`lsregister -dump`), then make a
     target enforce it. Where an invariant lives outside the repo, the build system is the
     only place it can be asserted.

BF19 — "fullscreen" is not a presentation mode of the video, and BF02 assumed it was:

309. **The owner found a bug he did not know he had, and then measured it.** BF02 taught the
     record to follow `video.webkitPresentationMode`, which is exactly right for
     `webkitSetPresentationMode('fullscreen')` — and blind to the fullscreen users actually
     use. His console log in Safari 26 on YouTube, four lines, and every design choice below
     comes out of it:

         start            | presentationMode = inline             | document fullscreen = false
         fullscreenchange | presentationMode = inline             | document fullscreen = true
         modechanged      | presentationMode = picture-in-picture | document fullscreen = false
         modechanged      | presentationMode = inline             | document fullscreen = false

     YouTube fullscreens its own *player container* through the standard Fullscreen API, so
     the video's mode stays `'inline'` the whole time and `webkitpresentationmodechanged`
     never fires for it. So the restore target was correctly computed and correctly wrong.
310. **The second fact in that log is the one that shapes the code: no `fullscreenchange`
     announces the exit.** There is no `document fullscreen = false` line between lines two
     and three — Safari leaves document fullscreen *silently* when PiP takes over. So the
     element has to be captured when it *enters* fullscreen and carried across the PiP
     transition, exactly as `restore` already was. Reading the live value at restore time
     would read `null` every time, which is the shape a first attempt would take.
311. **Clearing is only safe on a real event, and that cuts both ways.** Escape *does* fire
     `fullscreenchange`, so clearing then is correct and necessary — without it the element
     stays remembered for ever and a later, unrelated PiP toggle drags the user into a
     fullscreen they left minutes ago. But clearing on any *other* observation would throw
     the element away in the PiP case, since that exit is unannounced. So: believe the
     event, and nothing else.
312. **The element, not a boolean.** Restoring means asking the same element to go fullscreen
     again. Putting the bare `<video>` into native fullscreen instead would technically be
     "fullscreen" and would lose YouTube's controls, its overlay and its own escape — a
     different place from where the user came.
313. **Protocol at seven members, and RRR §6's boundary held.** `onFullscreenChange`,
     `fullscreenElement`, `enterFullscreen`. All three are behind the seam because the names
     are prefixed on the floor this project supports: `webkitFullscreenElement` and
     `webkitRequestFullscreen` are what macOS 11's Safari 14 has, the unprefixed pair is what
     Safari 26 delivers, and the real implementation registers both event spellings. `cb` may
     therefore fire twice for one change, which is harmless because it reads
     `fullscreenElement()` rather than trusting the event.
314. **`enterFullscreen` after `setMode`, in the same turn.** After, because asking for
     fullscreen while the video is still in PiP is a request about a state about to change
     under it. Same turn, because `requestFullscreen` needs the user gesture still being
     handled — doing it from a later `modechanged` would arrive without one. The rejection is
     swallowed: a refused request leaves the user inline and looking at the page, which is
     the pre-BF19 behaviour, and an alert about a nicety is worse.
315. **After restoring, we stop believing the document is fullscreen.** The request is
     asynchronous and may be refused, so holding the element afterwards would be believing
     an outcome nobody reported. If it succeeds, the platform's own `fullscreenchange` sets
     it again — which is the only evidence worth keeping. A test caught this: without it, a
     second unrelated toggle re-entered fullscreen.
316. **One of six mutations survived, and it was the exact bug I had reasoned about in
     prose.** "Never clear on a real `fullscreenchange`" passed all 53 tests, because the
     test for it put the fullscreen events *before* the first toggle — with no record yet,
     `noteFullscreen` returns early, and the seed on first toggle reads an element that is
     already `null`. So the clearing branch was never entered by any test. Fixed by toggling
     first. **The lesson is not "write more tests" but "a test whose setup skips the branch
     it names is indistinguishable from one that passes"** — and only mutation showed the
     difference. Sixth time in this project that mutation caught what a green suite hid.
317. Content bundle 7173 → 8050 B, 65% of the 12 KB budget. The cost is the third protocol
     member's real implementation plus the record's two fields; the budget is RRR §5.2's and
     this stays comfortably inside it.

Predictions for acceptance, with their treatment ready:

8. **Prediction for T03.** Safari's MV3 `service_worker` background is supported
   from 15.4 but has a history of unreliability. If the toolbar button fails to
   respond after the browser has idled, the cause is a terminated worker, and the
   fix is `background.scripts` with `persistent: false` — documented in RRR §12.
   Switch and record; do not fight it.
9. **Prediction for T08 and acceptance.** Any live YouTube measurement taken in
   an unsized or hidden viewport reads zero for every button, because the player
   collapses to `ytp-tiny-mode` and sets `display: none`. This already happened
   once during design-phase research. A live test that suddenly "passes
   trivially" is this bug, not success.
10. **Prediction for T12.** XcodeGen regeneration is the likeliest place to
    silently lose a build setting — hardened runtime, the pnpm build phase, or
    the per-target deployment targets (app 11.0, and the project-level 12.3 that
    differs from it). The acceptance criterion is a field-by-field `codesign -dv`
    comparison against the pre-migration output for exactly this reason.
11. **Tail for T06 / T08.** The geometry invariant must be asserted *relative to
    a sibling button*, never as an absolute pixel value. An absolute assertion
    will pass today and silently misreport after the next YouTube redesign —
    which is the exact failure this whole task exists to prevent.
