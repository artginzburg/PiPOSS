# PLAN.md — what was built, and what is left

Executed under the autodev methodology: orchestrator, a fresh executor per task, and a
reviewer who did not write the code. Rules in [CLAUDE.md](CLAUDE.md), requirements in
[RRR.md](RRR.md), every decision made without the owner in [DECISIONS.md](DECISIONS.md).

**Goal:** remove every reason a normal person bounces off PiPOSS, and leave the codebase
in a state where a fresh agent can safely change it.

Closed tasks are one line each. Their reasoning is in DECISIONS.md and their diffs are in
git — repeating either here is how this file grew to 792 lines. Open tasks keep their full
brief, because a brief is what an executor reads.

## Closed

**Wave 0 — pipeline smoke test, on a real blocker.** The methodology asks for a throwaway
task; baseline verification found a shipping defect instead, so the smoke test ran on that.

- [x] **T00.** The Xcode build silently shipped a stale or empty content script.

**Wave 1 — foundation.**

- [x] **T01.** Test harness and the `PresentationController` protocol (RRR §6).
- [x] **T02.** Settings module over `browser.storage.local`.
- [x] **T02a.** Hardened it and the shared test fake — three defects the T02 review measured.
- [x] **T03.** Manifest V3, background script, toolbar button, registered command.
- [x] **T04.** Hotkey handling driven by settings.
- [x] **T05.** Local development loop (`Makefile`, `docs/development.md`).

**Wave 2 — the reported bug and the UX gaps.**

- [x] **T06.** YouTube button rewrite — *the headline bug*. The fix was deleting code.
- [x] **T07.** Mutation observation, coalesced to one run per frame.
- [x] **T08.** Live-DOM geometry guard (Playwright, allowed to be skipped in CI).
- [x] **T09.** Options page.
- [x] **T09a.** Access became an indicator; the request button went (RRR §4.3).
- [x] **T10.** Auto-PiP on tab hide.

**Wave 3 — container app and build modernisation.**

- [x] **T11.** SwiftUI container app, replacing the AppKit + storyboard + WKWebView trio.
- [x] **T12.** XcodeGen project definition.
- [x] **T13.** CI.

**Wave 4 — icon.**

- [x] **T14.** Icon Composer icon, symbol at stock macOS proportions.

**Wave 5 — distribution, docs, growth.**

- [x] **T15.** README and install instructions.
- [x] **T16.** Homebrew cask diff, prepared not pushed.
- [x] **T17.** On-demand download metrics (`docs/metrics.md`).
- [x] **T18.** Mac App Store readiness audit — prepared, not submitted.
- [x] **T19.** Naming shortlist (`docs/naming.md`).
- [x] **T20.** ARCHITECTURE.md.

**Defects found and fixed while building.** Four of these were found by the owner using
the app, which is the only reason they were found at all.

- [x] **BF01.** The PiP toggle wedged after re-entering PiP from Safari's own control.
- [x] **BF02.** The browser now maintains the restore record, and it left a page-writable
      DOM attribute for a `WeakMap`.
- [x] **BF03.** ~~The YouTube click listener never registers on a live page~~ — **the
      finding was a harness artifact**, refuted before anything was changed. The
      measurement that matters (a content script runs in an isolated world, where
      YouTube's `addEventListener` shadowing is invisible) is in ARCHITECTURE.md.
- [x] **BF04.** The options page could not save anything — `storage` was never declared.
      *Owner-found.*
- [x] **BF06.** The no-request rule became structural: calling `permissions.request` no
      longer compiles.
- [x] **BF07.** ~~Let the app open the options page~~ — see BF17.
- [x] **BF08.** The access guide told the user to click a button Safari had greyed out.
- [x] **BF09.** T12 made Safari stop loading the extension. *Owner-found.*
- [x] **BF11.** The extension called itself 1.0.3 while the app was 2.0.0.
- [x] **BF13.** ~~T18's entitlement removal broke extension-state detection~~ — **wrong
      diagnosis**, superseded by BF15. The entitlements stay restored because they match
      the shipped release, not because anything needs them.
- [x] **BF14.** Two useless buttons removed; the install-time options tab removed, because
      `runtime.onInstalled` fires once per Safari *profile*. *Owner-found.*
- [x] **BF15.** 180 stray app bundles registered with LaunchServices made SafariServices
      resolve the extension identifier to the wrong copy. Caused by this project's own
      builds. *Owner-found, as a product bug.*
- [x] **BF16.** The settings-page button restored, solely to make one press decisive.
- [x] **BF17.** It is not possible: `dispatchMessage` does not reach `runtime.onMessage`.
      RRR §4.7 marks it as the one requirement the platform refused. *Owner-established.*
- [x] **BF18.** `make app` now leaves exactly one registered copy — two documented
      commands were enough to reach the broken state.
- [x] **BF19.** Leaving PiP restores the *document's* fullscreen. On YouTube "fullscreen"
      is the page fullscreening its player container, so the video's presentation mode
      never changes and no mode-change event is delivered. *Owner-found and measured.*

## Open

- [x] **T21. The methodology metrics file** — `metrics/artginzburg-piposs.json`, submitted as
  [autodev-methodology#1](https://github.com/vvginzburg/autodev-methodology/pull/1). Everything
  else T21 asked for was already done: RRR §10.1 is confirmed by `make check`, and REPORT.md
  carries the owner's acceptance list.

- [ ] **BF05. The test fake is laxer than Safari, which is why BF04 was invisible**
  `test/helpers/fake-browser.ts` installs **every** namespace unconditionally, so 349
  tests passed over an extension that could not save a single setting. A fake that read
  `manifest.json` and omitted the namespaces the manifest does not permit would have
  caught BF04 in `settings.test.ts`, with no manifest gate needed.
  Done when: removing a permission from `manifest.json` makes the tests that *use* that
  API fail, not only the manifest gate. Expect this to be more invasive than it sounds —
  several suites rely on the fake being unconditionally complete.
  Three related findings belong here, being the same bug at three depths:
  1. **Safari gates two `runtime` *members*, not the namespace.** WebKit's
     `WebExtensionAPIRuntimeCocoa.mm` requires `nativeMessaging` for `connectNative` and
     `sendNativeMessage`, while `manifest.test.ts` maps namespaces and records
     `runtime: null`. A namespace-keyed map cannot express it.
  2. **`src/webkit.d.ts` declares `dataset.pipossCustomButtonEnabled`, which no production
     line writes**, and a test attributes it to a requirement RRR §4.5 does not contain.
     Careful: the closed object type is load-bearing since BF02 — it is what makes `tsc`
     refuse `video.dataset.anythingElse` — so narrow it to `dataset: {}` rather than
     deleting the declaration.
  3. Fix that false attribution either way. A test citing a requirement that does not
     exist is worse than an uncited one.

- [ ] **BF10. TypeScript does not spell-check event names**
  Misspelling `webkitpresentationmodechanged` passed `tsc` **and all 453 tests**: an entry
  in `HTMLVideoElementEventMap` types the callback parameter but does not constrain the
  name, because `addEventListener` keeps a `(type: string, …)` overload. BF02 guarded its
  own site with `satisfies keyof HTMLVideoElementEventMap`, which is erased before emit.
  The rule is subtler than "names are unchecked": under `strictFunctionTypes` a handler
  typed `(event: KeyboardEvent)` *is* checked, because the fallback overload takes
  `EventListenerOrEventListenerObject`. Only handlers taking no parameter, or `Event`, slip
  through — **12 sites**, not the 8 first reported.
  Done when every event-name literal in `src/` is constrained, **including the
  `removeEventListener` half**, where a typo is worse: it silently fails to detach, so the
  listener leaks rather than never firing. Re-derive the enumeration rather than trusting
  this entry; an incomplete grep has passed for a complete one three times here.
  `dist/content.js` must be byte-identical before and after, since `satisfies` must not emit.

- [ ] **BF12. The appex's message handler is still Apple's 2022 template**
  `PiPOSS Extension/SafariWebExtensionHandler.swift` force-casts
  `context.inputItems[0] as! NSExtensionItem` and `message as! CVarArg`, either of which
  crashes the extension process, and re-declares `SFExtensionMessageKey` instead of using
  SafariServices' own constant. **Latent:** nothing calls `sendNativeMessage` or
  `connectNative`, and without `nativeMessaging` in the manifest those methods do not
  exist in Safari, so the handler is unreachable.
  Done when neither force-cast remains — guard-let and return, since a message the handler
  cannot parse is not worth crashing over — **or** the file is deleted, which is a
  `project.yml` plus `NSExtensionPrincipalClass` question to settle *before* removing it.
  Lowest priority of the open items: it is dead code, and the honest reason to fix it is
  that the next person to add native messaging will not read it first.

## Deferred, with the condition to unfreeze

- **iOS/iPadOS target** — if and when the owner submits to the App Store. Dead code before
  that: no sideload path exists on iOS.
- **Custom buttons outside YouTube** (Vimeo, Twitch, a generic hover button) — after
  `sites/` has survived one YouTube redesign. ARCHITECTURE.md opens with the path.
- **Sparkle auto-update** for the non-MAS build — 126 existing users have no way to learn
  about updates.
- **Landing page** on GitHub Pages with a demo capture, for search traffic.
- **Release + notarization workflow** — blocked on owner-supplied secrets.
