# ARCHITECTURE.md

Orientation for whoever changes this codebase next. It is deliberately **not**
complete: it says where each decision lives and which boundaries are load-bearing,
so you can find the two files your change belongs in without reading the tree.

- **What must be true** is [RRR.md](RRR.md). **Why it is the way it is** is
  [DECISIONS.md](DECISIONS.md) and the block comments in the files themselves,
  which are long on purpose. **How to build and test** is
  [docs/development.md](docs/development.md). **Measured platform ground truth** is
  [docs/research/](docs/research/) — read the relevant note before touching YouTube,
  signing, or auto-PiP.
- RRR is the *requirement*; the code is the *fact*. Where a comment or a test cites
  **§5.1–§5.4**, it means RRR §5's numbered list — item 1 = the ±1 px button
  invariant, 2 = the 12 KB budget, 3 = mutation cost, 4 = no geometry constants.
  RRR itself never writes those sub-numbers, so grepping for them in RRR finds nothing.
- Paths are repo-root-relative. **`R/` abbreviates `PiPOSS Extension/Resources/`**,
  the JavaScript root — where `pnpm` and every `src`/`test` path below live.
- Written 2026-07-28 against the working tree of that date, including BF02
  (`core/presentation.ts`) and BF07 (`background.ts`, `core/messages.ts`), which were
  uncommitted at the time. Every number and path here was checked; anything
  unchecked says so.

---

## Adding a second site — the whole path

This is the task this document exists to make cheap, so it comes first. Note that
RRR §11 settles **no custom buttons outside YouTube in v2**, so this is post-v2
work; the shape below is what
[R/src/sites/youtube.ts](PiPOSS%20Extension/Resources/src/sites/youtube.ts)
establishes, and it is the only example.

1. **Write `R/src/sites/<site>.ts`.** Export one mount function with youtube.ts's
   signature — `mount…(doc: Document, controller: PresentationController)` — returning
   a binding of `{ active, ready, refresh(), disable() }`. Both arguments are *handed
   in*, never reached for: the controller because WebKit is untestable (below), the
   document because a site module that consulted the ambient global could be aimed at
   the wrong page by its caller and would not notice.
2. **Detect the site from `doc.location.hostname`, never from `video.src`.** RRR §4.5;
   on YouTube the source is a `blob:` URL that happens to carry the origin in its text,
   so the old substring check passed by accident. Copy `isYouTubeHost`'s dot-anchored
   suffix match so `notyoutube.com` and `youtube.com.evil.example` do not match. On a
   document that is not yours, return a frozen inert binding (`INERT`, youtube.ts:100)
   rather than a live one that does nothing.
3. **Wire it in `mountSiteButtons()` in
   [R/src/content.ts](PiPOSS%20Extension/Resources/src/content.ts) — the only place.**
   Nothing else may import from `src/sites/`.
4. **Make `refresh()` convergent, then reuse `observeSubtree` from
   [R/src/core/observe.ts](PiPOSS%20Extension/Resources/src/core/observe.ts)** if the
   player rebuilds its controls — and install the observer only when the binding's
   `active` is true, as `content.ts` does. A whole-document `childList` observer on
   every page on the web feeding a consumer with nothing to do is RRR §5.3 at its worst
   (DECISIONS 134). "Convergent" means writing to the DOM only when it differs from
   what you want: `insertBefore` is itself a `childList` mutation, so an unconditional
   write feeds the observer that woke you and never settles (DECISIONS 32).
   Do **not** import your module from `core/` — `R/test/observe.test.ts:744` asserts
   `core/observe.ts` contains no `../sites/` import.
5. **Toggle only through `togglePiP(video, controller)`** from
   `core/presentation.ts`. Never call a `webkit*` method or name a `webkit*` event.
6. **Add the file to `project.yml`'s extension-target `inputFiles`** (the `src` entries
   are [project.yml](project.yml):391–407), and add the containing directory too if it
   is new. This is not tidiness: a directory's mtime does not change when a file inside it
   is edited, so a source file missing from that list has its edits silently skipped
   while `xcodebuild` prints `BUILD SUCCEEDED`. Two gates in
   `R/test/manifest.test.ts` (`:801` files, `:815` directories) fail if you forget.
7. **No `manifest.json` change.** `content_scripts[0]` already matches `*://*/*` with
   `all_frames: true`, so a new site needs no new permission and no new match.
8. **If the site gets its own on/off setting**, it is a new field in `Settings`,
   `DEFAULTS` and the merge in
   [R/src/core/settings.ts](PiPOSS%20Extension/Resources/src/core/settings.ts), plus a
   control in `options.html`/`options.ts` with a `data-testid`. Follow youtube.ts:
   subscribe to `onSettingsChanged` **before** issuing `loadSettings()`, and discard
   the read if a change already applied (DECISIONS 85). Do nothing to the DOM until the
   setting has been read — starting on the default means doing surgery on the page of a
   user who asked you not to, then undoing it visibly.
9. **Tests: `R/test/<site>.test.ts` plus a captured fixture in `R/test/fixtures/`.**
   Nothing YouTube-specific transfers automatically: the no-geometry-constants gate
   reads *one file by path* (`test/youtube.test.ts:65`), so a second site inherits none
   of it. If your module has layout rules, write your own gate — and prove it
   non-vacuous (below).
10. **Watch the budget.** Your module lands in `dist/content.js`, which is capped at
    12 288 B and currently uses 7 141 B.

---

## The three bundles

`esbuild.config.js` emits three, from three entry points. They share `src/core/*` at
the source level and each gets its own copy: they run in **separate realms** and
cannot reach each other's modules.

| Bundle | Entry | Loaded by | Size (2026-07-28) |
|---|---|---|---|
| `dist/content.js` | `src/content.ts` | `manifest.json` `content_scripts`, every frame of every page, `all_frames: true` | **7 141 B of 12 288 B (58 %)** |
| `dist/background.js` | `src/background.ts` | `manifest.json` `background.scripts`, `persistent: false` | 1 099 B, uncapped |
| `dist/options.js` | `src/options.ts` | a `<script src>` inside `options.html` — **not** the manifest, which names only the HTML | 6 202 B, uncapped |

Only the content script is capped, because it is the one whose cost is paid on every
page load whether the user presses anything or not (RRR §5.2). The cap is enforced
inside `esbuild.config.js`, so `pnpm run build` — and therefore the Xcode build phase
— fails, not just `make check`.

**`background.js` is a non-persistent background page, not a service worker.** Safari
has supported `background.service_worker` since 15.4, but RRR §12 records
`background.scripts` + `persistent: false` as the documented fallback for its
unreliability, and RRR §4.1 makes the toolbar button the one surface that must always
work — so the fallback is used from the start rather than after a user reports a dead
button. Reversing it is a two-key manifest edit and **no code change**: the bundle
esbuild emits is a classic script, which is what `service_worker` also loads. That
stays true only while nothing in `background.ts` relies on a DOM, a persistent global,
or a timer outliving an event. Both forms can be evicted between events, which is why
listeners are registered at top level and not inside a callback.

**The toolbar button, the registered command `⌘⇧P`, and the plain `P` hotkey all reach
the same function.** Because the manifest declares no `default_popup`,
`_execute_action` fires `action.onClicked` — so the button and the command are
literally one event. That handler messages the tab; the content script's listener calls
the *same* `togglePiPOnPage` the hotkey calls (`content.ts:87`). RRR §4.1's "exactly as
the hotkey does" is a requirement, so there is deliberately no second code path to
drift from it. Auto-PiP is the deliberate exception: it shares `togglePiP` but not
`togglePiPOnPage`, because the hotkey path takes a lone *paused* video and toggles
either way — both wrong for a trigger nobody pressed (DECISIONS 174).

---

## The composition root — `R/src/content.ts`

**The only file that wires anything.** 132 lines, and no rule of its own.

It decides: which `PresentationController` implementation is real
(`WebKitPresentationController`, line 19); that a frame runs at most one copy
(`claimFrame()`, line 25); which features are enabled; which site modules exist and
whether a mutation observer is installed for them; and that a user-initiated toggle
goes through `pickVideo` then `togglePiP` — the rules inside both being
`core/video.ts`'s and `core/presentation.ts`'s.

It must **never** decide: which key the hotkey is (`core/hotkey.ts`), which videos
auto-PiP may touch (`core/autopip.ts`), anything about YouTube's DOM
(`sites/youtube.ts`), the wire format of a message (`core/messages.ts`), or how a
presentation mode is set (`core/presentation.ts`). It also must not name a
`webkit*` symbol.

`claimFrame()` guarding everything is not defensive style. RRR §4.1 makes the content
script injectable *twice* on one page — a declared copy plus the injected one the
toolbar click produces on an ungranted site — and every copy runs the same top-level
code. Two copies means two `keyup` listeners and two message listeners, so one
keypress toggles PiP twice: it enters and immediately leaves. A visible no-op, on
exactly the sites that otherwise work.

---

## The core protocol boundary — RRR §6

`webkitSetPresentationMode`, `webkitPresentationMode`,
`webkitSupportsPresentationMode` and the `webkitpresentationmodechanged` event exist
**only in WebKit**. No test can touch a real one — jsdom does not implement them and
never will. So they are behind one interface, `PresentationController`, in
[R/src/core/presentation.ts](PiPOSS%20Extension/Resources/src/core/presentation.ts),
with two implementations: `WebKitPresentationController` (the real one, selected only
by the composition root) and `FakePresentationController` (records every call).
Everything else — video selection, hotkey handling, button placement, auto-PiP —
depends on the interface and is therefore fully testable under jsdom. **We test our
own logic; we never test WebKit.**

Four members since BF02:

| Member | Answers |
|---|---|
| `supportsPiP(video)` | can this video do PiP at all |
| `getMode(video)` | which presentation it is in **now** — the only honest source |
| `setMode(video, mode)` | put it in one (asynchronous in Safari) |
| `onModeChange(video, cb): () => void` | tell me when the **browser** moves it, including moves we did not cause; returns its own unsubscribe |

The fourth was *added* rather than worked around, and that is the section's whole
point in one example. Without it, "where do I restore this video to" had to be
inferred from our own calls, and the inference was wrong whenever the user changed
presentation by hand — the player's PiP button, the fullscreen control, the system PiP
window's close button. `cb` takes no argument deliberately: the event carries no mode,
so `getMode` stays the single source.

**The rule a reader must leave with: a `webkit*` call or event name anywhere other
than `core/presentation.ts` is the mistake this design exists to prevent.** Verified
2026-07-28 — every executable occurrence in `src/` is in that file, plus the ambient
declarations in `R/src/webkit.d.ts`; every other mention is prose. Two honest caveats:

- **No test enforces the containment.** It is convention plus review. If you want it
  enforced, write the gate — and prove it non-vacuous, because the files that talk
  *about* `webkitSetPresentationMode` are exactly the ones a naive needle will match.
- **TypeScript does not spell-check event names.** `HTMLVideoElementEventMap` types
  the callback *parameter*, but `addEventListener` retains a `(type: string, …)`
  overload, so a misspelling compiles and the listener silently never fires. Measured by
  BF02: `…modechange` (no `d`) passed `tsc` and all 453 tests. The defence at the one use
  site is `'webkitpresentationmodechanged' satisfies keyof HTMLVideoElementEventMap`,
  which is erased before emit. Names are unchecked *exactly where the handler's
  parameter does not narrow* — see PLAN's BF10, whose enumeration was corrected from 8
  to 12.

The restore record lives in a module-scope `WeakMap`, not on the element. Attributes
are **not** isolated even though the content script's world is (below): the record
used to be `video.dataset.lastPresentationMode`, so any page could read where the user
was about to be sent and, worse, write it — and that string went straight to
`webkitSetPresentationMode`.

---

## Module map

Each file's header comment is the authority on *why*; this table is only for finding
it. "Must not know" is the boundary that breaks if you ignore it.

| File | Owns | Must not know |
|---|---|---|
| [R/src/content.ts](PiPOSS%20Extension/Resources/src/content.ts) | composition: which implementation, which features, which sites | any rule — see above |
| [R/src/core/presentation.ts](PiPOSS%20Extension/Resources/src/core/presentation.ts) | the `PresentationController` seam, both implementations, `togglePiP`, the restore record | which site, which trigger, any setting |
| [R/src/core/video.ts](PiPOSS%20Extension/Resources/src/core/video.ts) | `getVideos` / `pickVideo` — which video a *user-initiated* toggle means | WebKit; presentation modes |
| [R/src/core/hotkey.ts](PiPOSS%20Extension/Resources/src/core/hotkey.ts) | key matching (three ways to recognise one key), the Cmd/Ctrl/Alt veto, editable-target suppression, `isSinglePrintableKey` | what the key *does*; storage layout |
| [R/src/core/autopip.ts](PiPOSS%20Extension/Resources/src/core/autopip.ts) | RRR §4.6's three exclusions (paused, muted, < 5 s), "any video already in PiP means do nothing", `visibilitychange`, and the claim the opt-in return half rests on — which video *we* floated, and whether it has been in PiP ever since | WebKit; any site |
| [R/src/core/settings.ts](PiPOSS%20Extension/Resources/src/core/settings.ts) | the one `browser.storage.local` key, merge-over-defaults per field, unknown-field survival, the write queue | who reads a setting; the DOM |
| [R/src/core/messages.ts](PiPOSS%20Extension/Resources/src/core/messages.ts) | every string on the wire (`TOGGLE_PIP`, `OPEN_OPTIONS_PAGE`) and the send/receive helpers | why a message was sent; videos |
| [R/src/core/inject.ts](PiPOSS%20Extension/Resources/src/core/inject.ts) | both halves of one contract: `scripting.executeScript` under the `activeTab` grant, and `claimFrame()` which stops the second copy | what the content script does |
| [R/src/core/observe.ts](PiPOSS%20Extension/Resources/src/core/observe.ts) | RRR §5.3's number: ≤ 1 run per animation frame, with a 250 ms timer behind it because `requestAnimationFrame` does not fire in unpainted frames or hidden tabs | what it watches; any selector |
| [R/src/sites/youtube.ts](PiPOSS%20Extension/Resources/src/sites/youtube.ts) | **all** YouTube knowledge: the two hostnames, the three selectors, `data-priority` ordering, the capture-phase click interception, un-hide via `removeProperty` | anything about other sites; how PiP is performed |
| [R/src/background.ts](PiPOSS%20Extension/Resources/src/background.ts) | `action.onClicked` → message-then-inject-then-message; `onInstalled` reason `install` → open options once; the app's `open-options-page` request (BF07) | videos, the DOM, WebKit, state that outlives an event |
| [R/src/options.ts](PiPOSS%20Extension/Resources/src/options.ts) | the options page: Access read-out (four states, live via `permissions.onAdded`/`onRemoved`), the key-capture field, the two toggles | how a setting is stored; WebKit |
| [R/src/browser.d.ts](PiPOSS%20Extension/Resources/src/browser.d.ts) | the extension APIs we are allowed to use — undeclaring is a real defence (BF06) | — |
| [R/src/webkit.d.ts](PiPOSS%20Extension/Resources/src/webkit.d.ts) | the WebKit-only ambient declarations | — |

**What "site knowledge" concretely means**, i.e. what may only live in `src/sites/`:
a hostname or URL pattern; a CSS selector or class name for a player's DOM; an
attribute name that a player defines (`data-priority`); the order and position of a
control; which element a click listener goes on and in which phase; and any
compensation for a player's own styling. Everything else — "which video", "which
key", "how PiP is entered", "when to re-run" — is `core/`, and a second site must be
able to reuse it unchanged.

`sites/youtube.ts` writes **no geometry at all**, not one length, and never queries
the glyph. YouTube sizes every control button's glyph identically with values that
differ per width mode, so any number written there is already wrong in one mode and
will be wrong in all of them after the next redesign. The previous implementation
compensated for a size difference that no longer existed and collapsed the glyph to a
sliver: the button was not broken by YouTube, it was broken by our arithmetic about
YouTube. RRR §5.4 turns that into a static gate — the module may contain no numeric
literal at all.

---

## The Swift side, briefly

A contributor will almost certainly work on the JavaScript. The container app is a
launcher and a teacher.

| File | Role |
|---|---|
| [PiPOSS/PiPOSSApp.swift](PiPOSS/PiPOSSApp.swift) | one `WindowGroup`, `File ▸ New Window` removed; quits when its window closes |
| [PiPOSS/ContentView.swift](PiPOSS/ContentView.swift) | one sentence of extension state via `SFSafariExtensionManager`; the site-access guide; two buttons — `SFSafariApplication.showPreferencesForExtension`, and `dispatchMessage(withName: "open-options-page")` |
| [PiPOSS/SafariSettingsDiagram.swift](PiPOSS/SafariSettingsDiagram.swift) | a **drawing** of Safari's Settings ▸ Extensions pane (RRR §4.7): vector, not a screenshot, with five independent signals that keep it from passing as real Safari |
| [PiPOSS Extension/SafariWebExtensionHandler.swift](PiPOSS%20Extension/SafariWebExtensionHandler.swift) | the `sendNativeMessage` stub from Apple's template; echoes and logs, and nothing in the product depends on it |

Two things to know before editing either Swift target:

- **`SFSafariApplication.dispatchMessage` is the only route from the app to the
  extension**, and it needs a `runtime.onMessage` listener in `background.ts` to have
  any effect. The name is a bare literal in Swift and a constant in TypeScript — they
  *cannot* share one, so `R/test/container-app.test.ts` reads both files and requires
  the same string. Whether Safari delivers a dispatched message to `runtime.onMessage`
  at all is **not established** (Apple documents a different route); that gate settles
  only that a typo is not what breaks it.
- **The deployment floor is macOS 11.0** and stays there (RRR §2) — no `.task`, no
  `Canvas`, no `Grid`, no markdown in `Text`. If a build fails on availability, use
  the older API rather than raising the floor.

---

## Constraints that will bite someone

- **12 KB on `dist/content.js`** (RRR §5.2), 7 141 B used today. It is injected into
  every frame of every page. Reduce the bundle rather than raising the number.
- **The content script runs in an isolated world.** This is not a footnote: it refuted
  a whole booked bug. PLAN's struck-through **BF03** reported that YouTube's player
  object shadows `addEventListener` with a wrapper that drops registrations — true in
  the *main* world (244 own properties on `#movie_player`), and invisible in the
  isolated world a content script actually uses (0 own properties, native prototype
  method, our capture listener fires). Acting on it would have moved the click
  listener to the button and lost a real case. So: **a measurement taken in the main
  world says nothing about production**, and `core/inject.ts` had documented the
  isolated world before that finding was booked.
  The corollary that *does* bite: attributes are shared with the page even though the
  world is not, which is why the restore record and the button's
  hidden-state map are `WeakMap`s.
- **A declared-but-uncalled `browser` API is invisible to every gate.** BF04's
  permission gate compares top-level *namespaces* against the namespaces the code uses
  and never inspects members — so a stray `permissions.request` declaration stayed
  invisible forever while the Access read-out legitimately used `contains`/`getAll`
  (BF06, DECISIONS 207). **Undeclaring in `src/browser.d.ts` is the defence**, not a
  better gate. DECISIONS 265 lists four more places in that shape.
- **Safari builds `browser` property by property**, omitting a namespace entirely
  unless the manifest declares its permission. That is how a manifest mistake presents
  at runtime: not an exception from a call, but the call site finding nothing to call.
  It cost a real debugging session — the whole options page was inert because
  `"storage"` was undeclared (BF04) — and the test fake is still laxer than Safari
  (PLAN's BF05).
- **`project.yml` is the only place a build setting may be edited**; `PiPOSS.xcodeproj`
  is generated and gitignored. A change made in Xcode's inspector is thrown away by
  the next `make`, silently.
- **A code-signing step reaches into the login keychain and raises a dialog.** A dialog
  nobody answers does not fail a build, it hangs it for ever. Unattended builds must
  pass `CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY=""`; see
  `docs/development.md`, which also explains why an *unsigned* build's extension will
  not load in Safari at all (no sealed resources — a web extension is almost entirely
  resources).

---

## Two lessons that cost this project the most

They are here rather than in DECISIONS.md because they are the two mistakes most
likely to be repeated by the next person, and both have a one-line remedy.

**1. A gate can match the wrong text — and the better your comments, the likelier it
does.** Four separate times a test's needle matched something other than what it meant
to check: comment-stripping in the wrong order opened an unterminated block comment
and emptied the searched string, so the entry-point gate found nothing (DECISIONS 159);
a namespace gate was *structurally* blind to the member it claimed to guard
(DECISIONS 207); the needle `dist` matched **the comment explaining why `dist` had to
stay a folder reference**, 33/33 green (DECISIONS 232); and a byte search over a built
binary could not see any Swift literal of ≤ 15 bytes, because small strings are stored
inline in code (DECISIONS 266). These gates are text searches over files that also
contain prose about themselves.
→ **Any new gate must be proven non-vacuous by mutating what it guards**, and the
mutation belongs in the suite where it runs every time, not in a report. The gates in
`R/test/manifest.test.ts`, `R/test/presentation.test.ts` and `R/test/format.test.ts`
each carry one — copy the nearest.

**2. An enumeration is a claim about coverage, so quote the count it rests on.** Three
times an incomplete search was presented as exhaustive: GitHub code search silently
skips files ≥ 399 KB, and the WebKit file that reversed a complete-looking story was
399 KB (`docs/research/webkit-pip-user-gesture-2026-07.md`); "Safari never explains the
greying" rested on 6 of **21** uses of `enabled`, two of the skipped branches doing
exactly that (DECISIONS 267); and "eight unchecked event names" was really **12**, with
2 of the 8 already safe (PLAN's BF10).
→ **"The only other uses are X and Y" is checkable; "nothing else does this" is not.**
Say how many you looked at, and re-derive an inherited list rather than trusting it.
