# RRR.md — PiPOSS v2

Requirements for autonomous development. This file is the single source of
requirements: if an answer is not here, the executor makes a reasonable
engineering decision, records it in DECISIONS.md, and does **not** stop to ask.

Design phase was compressed into one conversation with the owner on
2026-07-26/27 (see DECISIONS.md § "Phase 1"). Everything below is settled.

---

## 1. The product in one paragraph

PiPOSS is a free, open-source Safari extension for macOS that gives every web
video Apple's native Picture-in-Picture, on any site, with one keypress or one
toolbar click. The goal of v2 is not new capability but **removing every reason
a normal person would bounce off it** — a broken YouTube button, a toolbar
button that only shows a text blurb, an unexplained permission choice, an
un-configurable hotkey, and an install page that tells users to disable
Gatekeeper for no reason.

### The competitive premise, corrected mid-project

The project was started on the belief that this capability is otherwise **sold**, and the
design conversation used third-party estimates of thousands of downloads a month for a paid
competitor. Both were wrong:

- **There are already free alternatives** on the Mac App Store, including one open-source
  and site-specific. "People prefer to pay" is not what the store shows.
- **Competitor volume on the Mac App Store is not measurable at all** — Apple's feeds
  report zero ratings for every Mac app, so any table of Mac rating counts is an artifact.
  Stop building strategy on such a number.
- **PiPOSS's own reach is one to five installs a month.**

The measurements, the arithmetic and what follows from them are in
[docs/metrics.md](docs/metrics.md); the rename question is in
[docs/naming.md](docs/naming.md). None of it changes v2's scope, which is about quality —
it changes what to expect from it, and at this volume **no incremental change in v2 is
measurable.**

## 2. Technology stack (settled — do not revisit)

| What | Decision |
|---|---|
| Container app | Swift, **SwiftUI** (replaces AppKit + storyboard + WKWebView + HTML/CSS/JS trio) |
| Extension | Safari Web Extension, **Manifest V3** |
| Extension language | TypeScript, strict; bundled by esbuild |
| Minimum macOS | 11.0 (unchanged) — MV3 requires **Safari 15.4+**, hotkey reassignment in Safari's own UI requires Safari 26+, both degrade gracefully |
| Settings storage | `browser.storage.local` |
| Package manager | pnpm |
| Unit / DOM tests | Vitest + jsdom |
| Live-DOM tests | Playwright, Chromium |
| Project definition | XcodeGen (`project.yml`), generated `.xcodeproj` |
| Bundle ids | `org.artginzburg.PiPOSS`, `org.artginzburg.PiPOSS.Extension` — **unchanged** |
| Signing | Developer ID Application: Arthur Ginzburg (R2294BC6J8), hardened runtime, notarized + stapled |
| Distribution | GitHub release zip + Homebrew cask `artginzburg/tap/piposs`. Mac App Store: **prepared, not submitted** |

**Not in v2:** iOS/iPadOS target, Mac App Store submission, non-YouTube custom
buttons, telemetry inside the app, renaming the bundle id or the repository.
See §11.

## 3. Settings model

One object in `browser.storage.local` under key `settings`:

| Field | Type | Default | Meaning |
|---|---|---|---|
| `hotkey` | `string` | `"p"` | Single printable key that toggles PiP. Stored lowercase. Empty string disables the hotkey. |
| `autoPipOnTabHide` | `boolean` | `false` | Enter PiP automatically when the tab stops being visible while a video plays. |
| `autoRestoreOnTabReturn` | `boolean` | `true` | Leave PiP again when the tab becomes visible, for a video this extension floated and that has stayed floating. Inert while `autoPipOnTabHide` is off, which is what lets it default to on. |
| `youtubeButton` | `boolean` | `true` | Show the PiP button in the YouTube player controls. |

Hard rules that bite late:

- Safari's `storage.sync` **does not sync** — it is an alias for `local` and
  Safari 15/15.1 stored sync items in `local`. Therefore `local` only; never
  introduce `sync`, and never write a migration between them.
- Missing or partially-written settings must resolve to the defaults above by
  merging, not by replacing. A settings object from a future version with
  unknown fields must not be discarded.
- The content script must react to `storage.onChanged` live. Changing the hotkey
  must not require a page reload.

## 4. Surfaces and behaviour

### 4.1 Toolbar button — the primary trigger

No popup. Clicking the toolbar button toggles PiP on the current tab
immediately, exactly as the hotkey does. Same behaviour for the registered
keyboard command. If there is no eligible video, nothing happens and nothing is
shown — silence is the correct response, not an error dialog.

The popup that currently only says *"Use the 'P' keyboard shortcut…"* is
deleted, along with `popup.html` and `popup.css`.

**The button must work on a site the user has not granted access to.** It is the
one surface that always works, and on a fresh install *every* site is ungranted.

**`activeTab` alone is not enough** — a trap worth stating, because it reads as if it
should be. It grants programmatic injection and privileged tab properties, but a
*declared* content script still does not run without a host permission, and Safari will
not inject declared scripts until the user allows the site. So messaging a declared
content script fails silently on an ungranted site.

The mechanism that does work, with `scripting` and `scripting.executeScript`
available from Safari 15.4 — the same floor MV3 already requires:

1. Declare both `activeTab` and `scripting`.
2. On click, message the tab as usual.
3. If that rejects — which is exactly the ungranted case, reported as
   "Could not establish connection" — inject the content script with
   `scripting.executeScript` under the activeTab grant the click just produced,
   then retry the message.

This makes the content script injectable twice on one page, so it **must be
idempotent**: it registers listeners at import time, and a second copy would
double-toggle into a visible no-op. Guard it.

### 4.2 Keyboard

Two independent paths, and they must not fight:

1. **The plain key** (default `P`), implemented in the content script. Ignored
   when the focused element is an `input`, `textarea` or anything
   `isContentEditable`; ignored when any of Cmd/Ctrl/Alt is held, so it never
   eats a browser shortcut. Configurable in the options page.
2. **The registered command** `_execute_action`, default `Command+Shift+P` on
   macOS. This is what fills Safari's *"Shortcuts — Offers keyboard
   shortcuts"* field, which is empty today only because the extension declares
   no `commands` at all. Safari 26 lets the user reassign it in Safari's own
   settings.

A bare `P` cannot be put in Safari's field: `suggested_key` requires a
modifier, and `commands.update()` is unsupported in Safari. This is a platform
limit, not a bug — do not spend tasks trying to defeat it.

### 4.3 Options page

`options_ui` (Safari 14+; Safari always opens it in a tab). Contents:

1. **Access — a status indicator, not a request.** *Rewritten 2026-07-27 on the
   owner's instruction, after he used the built extension.* Show what PiPOSS can
   currently act on and nothing more: every website, some websites, no website yet,
   or unknown. State must live-update via `permissions.onAdded` / `onRemoved`.

   **No request button.** The original design here had one, calling
   `permissions.request({ origins: ['*://*/*'] })`. The owner's verdict from using
   it is that this section is in practice **a marker** — it tells you whether you
   configured the extension correctly — so it must be built as the marker it is
   rather than as a control implying the extension can widen its own access. A
   button whose effect the user cannot rely on is worse than an honest read-out.

   **The guidance moves to the container app** (§4.7): rather than asking, *show
   the user where to click in Safari*. The options page may point at that and may
   name Safari's own path, but must not offer to do it.

   Keep the honesty already there: only the user can grant this, no extension can
   grant itself access, and the toolbar button works either way.
2. **Hotkey** — a single-key capture field, default `P`, with a "reset to
   default" affordance and a note pointing to Safari's own settings for the
   `⌘⇧P` command.
3. **Toggles** — `autoPipOnTabHide` (off by default), `autoRestoreOnTabReturn` (on, and
   **disabled** in the UI while `autoPipOnTabHide` is off — it can do nothing then, and a live
   control that does nothing is what §4.3 refuses elsewhere), `youtubeButton` (on).

Native look: system font, `color-scheme: light dark`, no third-party CSS.
Every control needs a stable `data-testid`.

### 4.4 First run

**WITHDRAWN 2026-07-28 on the owner's instruction (BF14).** `runtime.onInstalled` fires
**once per Safari profile**, not once per machine, so this opened a tab in every profile
at once — "if I had 10 profiles that would be 10 windows." Nothing inside an extension can
make it once-per-machine, and a throttle would need state that survives eviction, which
the background page is deliberately without. The container app's guide covers the same
ground without seizing a tab. Original text kept below, struck.

~~`runtime.onInstalled` with reason `install` opens the options page once.~~ A new user
is taught how to grant access by the container app instead (§4.7).

### 4.5 YouTube button

Un-hide YouTube's own PiP button and place it correctly. The full DOM/CSS
ground truth, the measured root cause of the current shrunken button, and the
five design consequences are in
[docs/research/youtube-player-2026-07.md](docs/research/youtube-player-2026-07.md)
— **read that file before touching this**. In short:

- Set **no** geometry: no `padding`, `box-sizing`, `width`, `height` on the SVG.
- Un-hide with `style.removeProperty('display')`, never by assigning a value.
- Order by the `data-priority` attribute the player already puts on every
  button, not by hardcoded neighbour selectors.
- Do not replace the icon: YouTube's PiP button already carries a correct 24×24
  `currentColor` glyph and a `Picture-in-picture` tooltip.
- Delete the `.ytp-miniplayer-button` removal — that element no longer exists.

Detect YouTube from `location.hostname`, not from `video.src` (on YouTube the
source is a `blob:` URL and the current check passes only by accident). Find the
player with `closest('.html5-video-player')`, not `parentElement.parentElement`.

### 4.6 Auto-PiP on tab hide

When `autoPipOnTabHide` is on and `document.visibilityState` becomes `hidden`
while a video is playing, put that video into PiP. Never fire for muted or paused
videos, and never for videos shorter than 5 seconds (those are decorative loops,
and flinging them into PiP is the failure mode that would make people uninstall).
Off by default.

Restoring on return is the separate `autoRestoreOnTabReturn`. It is **on by
default and its parent is not**, which is only coherent because nothing is ever
remembered while `autoPipOnTabHide` is off: the field says what auto-PiP *means*
for whoever switches it on without reading further, and can do nothing until they
do. The objection to restoring unconditionally still stands — the user may have
deliberately kept the window floating — and is answered by the two conditions
below rather than by the default. Two conditions keep the setting inside its
promise, and neither may be dropped — the video must be one **this extension
floated on the last tab hide**, and it must have been in PiP **continuously
since**, judged by the browser's own presentation reports rather than by the mode
read on return. A window the user opened, or closed and reopened by hand, is
theirs. Restoring means the same `togglePiP` a hotkey press performs, so the
video returns to the presentation it came from; the document-fullscreen half of
that will usually be refused for want of a user gesture, and that is accepted —
inline is the honest fallback, and the settings page says so.

### 4.7 Container app

SwiftUI window. Say whether the extension is enabled, offer a button that opens
Safari's extension settings, ~~and offer a second button that opens the options page~~.
Delete `Main.storyboard`, `Main.html`, `Script.js`, `Style.css`,
`ViewController.swift`.

**The second button is impossible — the one requirement here the platform refused.** A
container app cannot open its extension's options page: `dispatchMessage` is the only call
that reaches the extension and `runtime.onMessage` does not receive it, while Apple's
documented `connectNative` route cannot wake a non-persistent MV3 background page.
Established by measurement, not assumed; the account is in `src/core/messages.ts`.

Instead, the one button opens Safari ▸ Settings ▸ Extensions — one click from the options
page — and quits on success, as the 2022 app did.

**And — added 2026-07-27 on the owner's instruction — teach the user how to grant
site access, visually.** This is now the app's main job, not an afterthought,
because §4.3 removed the request button and Safari is the only place the grant
happens. Requirements:

- **Recreate what the user is looking for**, rather than describing it in prose. An
  illustration or mock of Safari's Settings ▸ Extensions pane showing *which
  control to change and to what* — the owner's words: "show visually where to click,
  recreate Safari's settings window so it is obvious".
- It must be honest about the ceiling: the user chooses, we cannot choose for them.
- It must not claim to be a screenshot of the user's own Safari, and must not
  pretend to be Safari's UI in a way that could be mistaken for it. It is a
  diagram of Safari, drawn by us.
- Do not ship a captured screenshot of Safari's window: it goes stale with every
  Safari release and cannot be localised or themed. Draw it.
- One screen still. If the guide needs more room than the state and the two
  buttons leave, it earns the room — the state line is one sentence.

This replaces the old §4.3 access flow entirely. Anything in the README describing
a request button inside the options page is now wrong — see the T15 repair map, rows
2a and 2b.

## 5. Quality requirements, with numbers

The four numbered items below are cited elsewhere as **§5.1 – §5.4**; code and tests use
that form, so keep the numbering stable.

These are the measurable acceptance gates. Each must be asserted by a test, not
by eyeballing.

1. **Button geometry invariant.** After our code runs on a YouTube watch page,
   the PiP button's rendered SVG bounding box must equal a sibling
   right-control button's SVG bounding box within **±1 px**, in all three of
   the player's width modes (default, `ytp-xsmall-width-mode`, `ytp-big-mode`).
   Assert *equality with a neighbour*, never an absolute pixel value — this is
   what keeps the assertion valid across YouTube redesigns, which is the whole
   point of the task.
2. **Bundle size** of the content script ≤ **12 KB** minified.
3. **Mutation cost.** The site binding's `refresh` must be coalesced to at most **one run
   per animation frame** regardless of mutation volume; over 10 s of playback on
   a watch page, total runs ≤ **60**. (Today it runs on every mutation of the
   whole document, unthrottled.)
4. **Zero geometry constants.** No numeric literal describing YouTube's layout
   may appear in the source. Enforced by a test that greps the YouTube module.

## 6. Isolating the platform API

`webkitSetPresentationMode` exists only in WebKit, so tests cannot touch a real
implementation. Put it behind one protocol from the first task:

```ts
interface PresentationController {
  supportsPiP(video: HTMLVideoElement): boolean;
  getMode(video: HTMLVideoElement): VideoPresentationMode;
  setMode(video: HTMLVideoElement, mode: VideoPresentationMode): void;
  // Added by BF02: `webkitpresentationmodechanged` is as WebKit-only as the setter,
  // so observing a transition PiPOSS did not cause belongs behind the same seam.
  // Returns its own unsubscribe.
  onModeChange(video: HTMLVideoElement, cb: () => void): () => void;
}
```

`onModeChange`'s `cb` takes no argument deliberately: the event carries no mode, so
`getMode` stays the only honest source. The fullscreen members exist because on most sites
"fullscreen" is a state of the *document*, not a presentation mode of the video.

Two implementations from day one — the real WebKit one and a fake that records
calls — selected in the composition root (`content.ts` entry). Everything else
(video selection, hotkey handling, YouTube button placement, auto-PiP) depends
on the protocol and is therefore fully testable under jsdom. We test our own
logic; we never test WebKit.

## 7. Integrations and accounts

- Apple Developer Program: active. `Developer ID Application` and
  `Apple Distribution` identities present on the machine.
- Notarization: release 1.0.3 is Developer ID signed, notarized and stapled —
  verified. Therefore `--no-quarantine` was never needed and the "Ctrl+Click ▸
  Open" tip in the README is false. Both come out.
- Notarization credentials are **not** stored on this machine
  (`xcrun notarytool history` → "Must provide credentials"). A release workflow
  that notarizes needs secrets only the owner can add → §10.2.
- Homebrew cask `artginzburg/homebrew-tap/Casks/piposs.rb` — a separate repo;
  changes there need the owner. Prepare the diff, do not push it.

## 8. Project structure

```
project.yml                     XcodeGen source of truth
PiPOSS/                         SwiftUI container app
PiPOSS Extension/
  Resources/
    manifest.json               MV3
    options.html / options.css
    src/
      content.ts                composition root
      core/                     protocol + pure logic — video pick, hotkey, auto-pip,
                                plus inject, messages, observe, settings
      sites/youtube.ts          the only site-specific module
      background.ts             action.onClicked — its only job
      options.ts
    test/
      fixtures/youtube-*.html   captured DOM
      *.test.ts
  SafariWebExtensionHandler.swift
design/icon/                    Figma exports (source of truth for the icon)
docs/
  research/                     captured platform ground truth
  metrics.md                    how to pull download numbers on demand
AppIcon.icon/                   Icon Composer bundle
.github/workflows/ci.yml
RRR.md PLAN.md DECISIONS.md REPORT.md ARCHITECTURE.md CLAUDE.md
```

`.gitignore` gains `dist/`, `.build/`, `*.xcodeproj` once XcodeGen lands, and
keeps `**/xcuserdata`.

## 9. Testing

| Layer | Tool | Covers |
|---|---|---|
| Unit | Vitest | video selection, presentation toggling via the fake controller, settings merge/defaults, hotkey matching incl. modifier and editable-target suppression |
| DOM | Vitest + jsdom + captured fixtures | YouTube button un-hiding, priority-based placement, idempotency across repeated runs, absence of geometry writes |
| Live DOM | Playwright + Chromium against a real watch page | the ±1 px geometry invariant of §5.1 in all three width modes |
| Build | `xcodebuild` | both targets compile, **signing disabled** — see §10.1.4 |
| Static | `tsc --noEmit`, prettier check, the "no geometry constants" grep | — |

Playwright against real YouTube is inherently flaky (network, A/B layouts). It
must be a separate script, allowed to be skipped in CI with an explicit skip
message.

**§5.1 therefore has no always-on guard**, and §5's "each must be asserted by a test" is
unmet for that one item in a CI-only run. Said plainly rather than papered over: jsdom
performs no layout, so a ±1 px *rendered-box* assertion cannot exist there, and a weaker
jsdom test *called* the §5.1 guard would be worse than none. What is always on is the "no
geometry constants" grep, since the fix for the original bug was the
*absence* of geometry code rather than a corrected number.

## 10. Acceptance criteria

### 10.1 Automatic — one fresh run by the final task

1. `pnpm run lint:ts` — exit 0.
2. `pnpm run test` — all suites pass, zero skipped except the Playwright suite.
3. `pnpm run build` — exit 0; `dist/content.js` ≤ 12 KB.
4. `xcodebuild -scheme PiPOSS -configuration Release build` **with signing
   disabled** (`CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO
   CODE_SIGN_IDENTITY=""`) — exit 0, zero warnings introduced by us.
   Unsigned because signing reads the login keychain, and a keychain dialog does not
   fail a build — it hangs it. Signature verification is §10.2's.
5. Grep gate: no YouTube geometry literals in `src/sites/youtube.ts`.
6. README contains neither `--no-quarantine` nor the Ctrl+Click tip.
7. `manifest.json` is MV3, declares `commands`, `options_ui`, `host_permissions`,
   and no `default_popup`.
8. `git status` clean; every task a commit; no `dist/` artifacts committed.
9. `AppIcon.icon` builds and the produced app bundle carries the new icon.

### 10.2 Physical world — owner only, outside the agent's scope

1. Safari: enable the extension from a locally built app, confirm the hotkey,
   the toolbar button and the YouTube button on a real watch page.
2. Confirm Safari's *"Offers keyboard shortcuts"* field now shows `⌘⇧P` and is
   reassignable.
3. Confirm the all-sites permission flow reads sensibly in Safari's UI. One
   specific thing to look at, added 2026-07-27 from the T09 review: **open the
   options page on a fresh profile and check the first Access sentence.** It should
   read "not on any website yet". If it instead says PiPOSS is allowed "on the
   websites you have chosen", then Safari's `permissions.getAll()` reports
   *declared* host permissions rather than only user-granted origins, and the
   three-state logic needs a different signal. Wrong in the harmless direction — the
   request button stays enabled and nothing false is claimed about access — but it is
   the first sentence a new user ever reads.
   *(A related worry was investigated and dismissed: Safari does **not** need
   `optional_host_permissions` for `permissions.request({origins})`. WebKit's
   `verifyRequestedPermissions()` starts from the MV3 `host_permissions` patterns,
   and Apple ships a regression test with `host_permissions` only. Nothing to check
   here.)*
4. Look at the new icon on a real Dock and in Safari's settings list.
5. **Verify the signature on a signed build**, which agents can no longer do:
   `codesign -dv --verbose=4` must report a Developer ID Application authority,
   hardened runtime (`flags=0x10000(runtime)`) and `Notarization Ticket=stapled`,
   and `xcrun stapler validate` must pass. Moved here from §10.1 because signing
   needs the login keychain and therefore needs you.
   **Never quote `spctl` alone as proof of notarization.** This machine has assessments
   disabled, so it prints `accepted` with `override=security disabled` — it accepts more
   readily than a user's machine. `codesign -dv` and `stapler validate` read the stapled
   ticket instead of the local policy engine, which is why they are the evidence.
6. Add notarization secrets if the release workflow is wanted.
7. Push the branch, the cask change, and the metrics PR to the methodology.

## 11. Settled decisions — do not re-ask

- **No iOS/iPadOS target.** No sideload path exists on iOS, so until an App
  Store submission happens the target ships zero installs; and it would double
  the fragile YouTube surface with a second, mobile DOM. Unfreeze only if the
  owner decides to submit.
- **No Mac App Store submission.** Prepare technically (sandbox-compatible,
  MV3), do not submit.
- **No telemetry in the app.** At 1–5 installs a month any in-app signal is
  noise, and it costs the privacy story. Download numbers are pulled on demand
  from Homebrew analytics and the GitHub releases API; write
  `docs/metrics.md` with the exact commands instead of a scheduled job.
- **No renaming yet.** Bundle ids, repository and cask name stay. A shortlist of
  keyword-bearing display names with App Store and domain availability checks
  is produced for the owner to choose from; nothing is renamed in v2.
- **No `xattr` command in the README.** The app is notarized; teaching users to
  strip quarantine would be advice to weaken Gatekeeper for no reason.
- **No custom buttons outside YouTube** in v2.

## 12. Known pitfalls

Read `~/.claude/skills/autodev/reference/pitfalls.md` first — the long-command
technique in it is mandatory in every subagent brief.

Specific to this machine and project:

- `xcode-select` points at `/Library/Developer/CommandLineTools`, so `xcodebuild`
  fails by default. `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`
  is pinned in `.claude/settings.json`; do not try `sudo xcode-select`.
- `log` is a zsh builtin — the system log is `/usr/bin/log` only.
- Safari toolbar icons: grayscale images are treated as **template images** and
  tinted with the system accent colour and appearance. That is why the existing
  toolbar PNGs are pure black with alpha — keep that property when regenerating
  them from `design/icon/ToolbarIcon.svg`.
  SVG *is* supported for `action.default_icon` from Safari 16.4, and Apple's own MV3
  template ships one. We still ship the PNG size map, because MV3 needs only Safari 15.4
  and the manifest cannot declare an SVG and a PNG fallback at once — so a single SVG
  would silently lose the toolbar icon for Safari 15.4–16.3 users on macOS 11/12.
  The PNGs already behave correctly; the choice is compatibility, not necessity.
- Safari `commands.update()` is unsupported; `commands.onChanged` too. The
  extension cannot read or set the user's chosen shortcut.
- Safari MV3 background: `service_worker` is supported from 15.4. If it proves
  unreliable, `background.scripts` with `persistent: false` is the documented
  fallback — record the switch in DECISIONS.md rather than fighting it.
- The YouTube player collapses to `ytp-xsmall-width-mode`/`ytp-tiny-mode` in a
  small or zero-size viewport and sets `display: none` on most buttons. Any
  live measurement in a headless viewport that is not explicitly sized will
  read zero for everything and look like a passing or failing test at random.
- Icon Composer input must be **flat and opaque**: shadow, specular and glass
  are applied by Icon Composer itself. `design/icon/PiP-final.svg` carries
  baked filters (`filter1_ii_5_31`) that must be stripped before use.
