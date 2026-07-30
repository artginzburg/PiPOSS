# Development loop

A fresh clone needs three tools: a full **Xcode**, **pnpm**, and **XcodeGen**
(`brew install xcodegen`). The last one is new since T12 — `PiPOSS.xcodeproj` is
generated from [`project.yml`](../project.yml) and is not in git. Every `make`
target that needs the project generates it first, so there is no separate setup
step; `make doctor` tells you if any of the three is missing.

The checks that do not need a human run from one command:

```sh
make check
```

That is prettier + typecheck + tests + extension bundle + an **unsigned** Release
`xcodebuild`. Green means:

- [RRR §10.1](../RRR.md) items **1, 2 and 3 in full** — `lint:ts` exits 0, every
  Vitest suite passes, the bundle builds *and* `dist/content.js` is within RRR §5.2's
  12 KB budget. The budget is enforced inside `esbuild.config.js` since T13, so it
  fails `pnpm run build` itself and therefore also the Xcode phase, not just `check`.
- RRR §9's **prettier check**, which had no script behind it until T13.
- The *command* behind item **4** exits 0. Its extra clause is **not** asserted:
  "zero warnings introduced by us" needs a cold build and a per-Xcode-version
  inventory — the command is at the end of *What an agent can verify* below.
- Nothing about signing. Item 5 moved to §10.2 — see below.

The same gates run on every push and pull request:
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml). Every step there is one
of the `make` targets above, deliberately — so a red CI run is reproducible with one
local command rather than by pushing again.

What it cannot cover is everything that needs a human at this keyboard, listed in
[RRR §10.2](../RRR.md) and repeated as a checklist below.

`make` with no target prints the target list. `make doctor` prints the toolchain
it resolved, which is the first thing to run when something behaves oddly.

## Which targets may run unattended, and which need you

**Safe unattended — they terminate, they never sign, they never open a window:**
`check`, `test`, `lint`, `build`, `deps`, `clean`, `app-build`, `doctor`, `help`.

**Interactive — `watch` and `watch-bundle`.** These are safe for *you* and wrong
for a script or an agent, because they never return. A watcher left in a
non-interactive pipeline fails in exactly the way a keychain dialog does: not
with an error, but by never finishing. Stop them with `q` or Ctrl-C.

**Owner at the keyboard only:**

- `make app` — signs with *Apple Development* (reads the login keychain) and opens a GUI
  window. Both are out of bounds for an autonomous agent even though neither has ever
  prompted on this machine.
- `make app-signed CONFIRM=1` — signs with *Developer ID Application*. This is the one that
  raised a password dialog on 2026-07-27, with the owner asleep. Without `CONFIRM=1` the
  target refuses and explains why, so it cannot be tripped by accident.

The switch underneath is `SIGN`, which defaults to `no`. What each mode gets you:

| `SIGN` | You get | Unattended? |
|---|---|---|
| `no` (default) | a compile check only. The product is linker-signed with **no sealed resources**, so it is **not installable** — Safari will not register an extension from it. | yes |
| `dev` | *Apple Development* — the bundle Safari can actually load. | no |
| `devid` | *Developer ID Application*, the distribution identity. | no |

Any other value is refused rather than treated as "sign with whatever the project says",
and `make check` pins `SIGN=no` on its own sub-`make` command line, so `make check
SIGN=dev`, `SIGN=dev make check` and `make check SIGN=devid` all still reach `xcodebuild`
with signing disabled. **If you want a signed build you must name a signing target.**

**The `Makefile`'s signing section is the authoritative statement of why the modes are
shaped this way** — the exact flags each passes, why a keychain dialog hangs a build
instead of failing it, why `CODE_SIGNING_ALLOWED=NO` on the command line beats the
project's own pinned identity, and why `project.yml` must keep naming
`CODE_SIGN_IDENTITY = "Apple Development"` on **both** targets. Read it there rather than
here; it is a second copy the moment it is restated.

One consequence a newcomer will otherwise rediscover the hard way: T12 removed those
signing settings, every default build became ad-hoc, and the owner reported that the
extension had stopped appearing in Safari. The signatures measured per build path, Safari's
own strings on "Allow unsigned extensions", what is **not** established about the refusal
mechanism, and the reasoning error behind that regression are in
[`docs/research/safari-extension-signing-2026-07.md`](research/safari-extension-signing-2026-07.md).
Read it before changing anything about signing.

## Targets

| Target | What it does |
|---|---|
| `make check` | The automatic gates: `format-check`, `lint`, `test`, `build`, `entitlements`, then an unsigned Release `xcodebuild`. `CHECK_CONFIG=Debug` for a faster pass. |
| `make entitlements` | Asserts the **signed** entitlements of the built product against an exact allow-list (T18). Builds **ad-hoc** into its own DerivedData (a `SIGN=no` product carries no entitlements at all). The bundle it leaves behind is for `codesign -d` only: **Safari refuses an extension from an ad-hoc-signed app**, so do not install it. Why ad-hoc is safe unattended: the `Makefile`. |
| `make test` | Vitest, once. |
| `make lint` | `tsc --noEmit` over the shipped code and the tests. |
| `make build` | Typecheck + esbuild bundle into `PiPOSS Extension/Resources/dist/`. |
| `make watch` | **Never exits.** Re-runs the tests on every source change. The inner loop. |
| `make app-build` | Rebuild `dist/`, then compile app + appex unsigned, no launch. What CI and agents call. |
| `make app` | **Owner only.** Apple Development build, then relaunch the container app. |
| `make app-signed CONFIRM=1` | **Owner only.** Developer ID build + relaunch. Expect a password dialog. |
| `make watch-bundle` | **Never exits.** esbuild `--watch`. Rarely useful — see below. |
| `make deps` | `pnpm install --frozen-lockfile`. Run unconditionally; pnpm no-ops in ~150 ms when nothing changed. |
| `make clean` | Empties `dist/` and runs `xcodebuild clean` (skipped if no project has been generated). |
| `make project` | Regenerates `PiPOSS.xcodeproj` from `project.yml`, unconditionally. |
| `make icons` | **Writes to your working tree.** Regenerates every icon from the two Figma exports in `design/icon/` — the `.icon` layer, the toolbar PNGs, the manifest icons and `Icon.png`. See [icon.md](icon.md). |
| `make doctor` | Prints the resolved Xcode, XcodeGen, pnpm, node, make, and the active `SIGN` mode. |

Variables worth knowing: `SIGN`, `CONFIG` (`Debug` by default, `Release` for the
gate), `CHECK_CONFIG`, `SCHEME`, `OPEN_FLAGS` (`make app OPEN_FLAGS=-g` launches
the app without stealing focus), `DERIVED_DATA` (empty means Xcode's shared
default; set it to give a run its own DerivedData, e.g.
`make check DERIVED_DATA=/tmp/piposs-dd-mine`), `DEVELOPER_DIR`, `PNPM`,
`XCODEGEN`.

The Makefile is a dispatcher, not a second build system. The extension bundle has
exactly one recipe — the pnpm scripts in
`PiPOSS Extension/Resources/package.json` — and the Xcode project runs those same
scripts in its "Run PNPM Build" phase. Do not teach the Makefile how to bundle.

### The project file is generated, so do not edit it

`PiPOSS.xcodeproj` is produced by `xcodegen` from `project.yml` and is gitignored.
The consequences, in the order they bite:

- **A build setting is changed in `project.yml`, never in Xcode.** A change made in
  Xcode's inspector lands in the generated bundle and the next `make` throws it
  away, silently.
- **Adding a Swift file, or a resource, means editing `project.yml`.** The target's
  `sources:` list names files one at a time on purpose: a directory would also
  sweep in `PiPOSS.entitlements` as a copied resource, and what ships should be
  written down. `test/manifest.test.ts` fails if a file the extension *references*
  is not listed under the extension target.
- `make project` forces a regeneration. Everything else regenerates only when
  `project.yml` is newer than the project, because rewriting `project.pbxproj`
  needlessly makes `xcodebuild` re-plan a build that has not changed.
- The `PiPOSS` **scheme is shared and declared in `project.yml`**. Before T12 it
  existed only in `xcuserdata`, which is gitignored, and `-scheme PiPOSS` worked
  purely because `xcodebuild` autocreates a scheme per target.

`project.yml` also sets `settingPresets: none`, so XcodeGen contributes none of its
own bundled defaults and every setting in the generated project is a line in
`project.yml`. That is what made the migration auditable — the effective settings
of all four target/configuration pairs were diffed against the hand-maintained
project and differed only in the signing keys and the version bump.

### The Xcode build phase and the stale bundle — fixed, and how to re-check it

Read this before you debug anything that looks like "my change did nothing".

Until T12 the "Run PNPM Build" phase declared the `src` **directory** as an
`inputPath` and the `dist` **directory** as its `outputPath`. A directory's mtime
does not change when a file inside it is edited, so **after a source-only edit
Xcode decided the phase was up to date and skipped it**, then copied the old
`dist/` into the `.appex` and printed `BUILD SUCCEEDED`. Reproduced immediately
before the fix: a `/*STALE*/` marker planted in `dist/content.js`, `src/content.ts`
touched, `xcodebuild` → exit 0, **zero** occurrences of
`Run PNPM Build phase started`, and the marker as the first line of
`dist/content.js` *inside the built `.appex`*.

`project.yml` fixes it at the root: every `src` file is an `inputFile` by name, the
three real bundles (`dist/content.js`, `dist/background.js`, `dist/options.js`) are
the `outputFiles`, and `pnpm-workspace.yaml` is an input too because without it
`pnpm install --frozen-lockfile` exits 1 and esbuild never runs (DECISIONS 14, 18).
The three directories stay in the input list *as well*, because they are what
notices a file being added or removed — which a list of filenames cannot. The same
run after the fix: phase ran once, marker gone from the `.appex`.

To re-check it yourself: plant a marker in `dist/content.js`, `touch` a file under
`src/`, build, and grep the `.appex`'s `dist/content.js`.

**Write the marker *in place*, or the experiment silently proves nothing.** The bug
is about a *directory* node's mtime, so `cp`/`>` over the existing file (same inode,
directory unchanged) reproduces it, while `mv` a rewritten copy over it — or any
editor that saves by rename, which many do — replaces the entry and changes `dist`
itself. The phase then re-runs *even on the pre-migration project*, and it looks as
though the bug never existed. That happened once during review. If a reproduction
comes back negative, check how the file was written before concluding anything.

`app-build` still depends on `build`, but for a smaller reason now: it puts `tsc`
output on your terminal before `xcodebuild` starts, so a typecheck failure reads as
a typecheck failure instead of being buried in a build log. One consequence: since
`build` runs `lint:ts` first, `make app-build` **fails while the TypeScript is red**,
mid-TDD included. That is deliberate — an `.appex` built around a bundle that does not
typecheck is the thing we are trying to stop shipping. If you specifically want a
Swift-only compile check while TS is broken, call `xcodebuild` directly with the flags
from `CLAUDE.md`.

### Why `make watch` runs tests and not esbuild

`pnpm run watch` (esbuild `--watch`, exposed as `make watch-bundle`) rebuilds `dist/` on
every keystroke, and that is almost never the feedback you want, for one reason: **a fresh
`dist/` changes nothing that Safari can see.** Safari loads the extension from the `.appex`
inside the built `.app`, and the resources are copied in at Xcode build time, so until you
re-run `make app` the running extension is the old bundle.

So the watcher that actually changes what you know is the test watcher, which is what
`make watch` is. Use `make watch-bundle` only when you are inspecting generated output
(bundle size, tree-shaking) rather than behaviour. Note what does **not** follow: running
`make build` before a build is not redundant — it is what puts a typecheck failure on your
terminal, which is why `app-build` now does it for you.

### Why `make app` relaunches, and why only you may run it

`make app` kills the running container app and launches the one it just built. It
does that on purpose, not as a convenience:

- Launching the app is how macOS registers the rebuilt `.appex` with Safari. A
  build alone leaves Safari looking at whatever was registered last.
- The container app's only job is to report whether the extension is enabled and
  to open Safari's settings, so seeing it is the point of the target.

Both of its side effects put it outside the unattended set: it signs (login keychain) and
it opens a window on a Mac somebody else may be using. The relaunch was deliberately *not*
moved into `app-build`, because a `SIGN=no` bundle has no sealed resources — launching that
would be theatre, and Safari would not load its extension anyway.

It does **not** touch Safari's process: `pkill -x PiPOSS` matches the container
app's exact executable name and nothing else. It does replace the `.appex` under
a Safari that may have the extension loaded, which is the intended effect. If you
want the relaunch without losing focus, `make app OPEN_FLAGS=-g`.

## The Safari steps only a human can do

These cannot be scripted, and no agent should claim them as done.

**Once per macOS install:**

1. Safari ▸ Settings ▸ **Advanced** ▸ *Show features for web developers* — this
   is what makes the **Develop** menu appear.

**Every time Safari starts:**

2. **Develop** ▸ *Allow Unsigned Extensions*.
   **This resets when Safari restarts.** It is not sticky, it is not a
   preference, and there is no defaults key for it. If a locally built extension
   "stopped working", this is the first thing to check — before reading any code.
   What `make app` builds is signed with *Apple Development*, not Developer ID,
   which is exactly why Safari insists on the toggle. What `make app-build`
   builds is not really signed at all: `codesign --verify` on it fails with
   *"code has no resources but signature indicates they must be present"*, so do
   not expect Safari to load it under any toggle. That target exists to prove the
   code compiles, nothing more — use `make app` for anything you want to see in
   Safari.

**Then, per build:**

3. `make app` — not `make app-build` — and in Safari ▸ Settings ▸ **Extensions**,
   enable *PiPOSS*. Enabling survives rebuilds; the *Allow Unsigned Extensions*
   toggle above does not.

## What an agent can verify, and what it cannot

Verifiable with no Safari, no keychain and no human — all of it inside
`make check`:

- typechecking, prettier, the Vitest suites (unit + jsdom fixture DOM tests), the
  esbuild bundle, and that both Xcode targets **compile**.
- **RRR §5.2's 12 KB budget on `dist/content.js`**, enforced since T13 by
  `SIZE_BUDGET_BYTES` in `esbuild.config.js` — `pnpm run build` exits 1 and prints how
  many bytes over. Only the content script is capped, because it is the one injected
  into every frame of every page; `dist/options.js` is uncapped by design.
- **The entitlement set of the signed product**, since T18: `make entitlements` dumps
  `codesign -d --entitlements` from an ad-hoc-signed build and fails unless the keys equal
  an allow-list of exactly `com.apple.security.app-sandbox` plus the `get-task-allow` that
  development signing adds and a deployment build strips. `test/entitlements.test.ts` covers
  the declarations in both project definitions and asserts that `make check` still runs the
  product-level half. The audit behind the allow-list is
  [`app-store.md`](app-store.md) §2.
- `manifest.json` content, and any grep-style gate over the sources — including, since
  T13, that the "Run PNPM Build" phase declares **every** `src/**/*.ts` as an input.
  That one is not tidiness: a directory input does not notice a file inside it being
  edited, so a source file missing from `project.yml`'s `inputFiles` has its edits
  silently skipped under `BUILD SUCCEEDED` (the section above explains the mechanism).

The one automatic criterion `make check` cannot answer is RRR §10.1.4's *zero warnings
introduced by us*, because warning counts are only meaningful off a **cold** build —
an incremental one caches the `appintentsmetadataprocessor` lines away and reports
fewer (DECISIONS 132, 149). Read them yourself with:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project PiPOSS.xcodeproj -scheme PiPOSS -configuration Release \
  -derivedDataPath /tmp/piposs-dd-cold \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" build \
  > /tmp/cold.log 2>&1; echo "EXIT=$?"
grep -c 'appintentsmetadataprocessor.*warning:' /tmp/cold.log   # 2 on Xcode 26.6
grep -c 'xcodebuild: WARNING:'                  /tmp/cold.log   # 1
grep -cE '\.swift:[0-9]+:[0-9]+: warning'       /tmp/cold.log   # 0 — this is ours
```

Only the third number is about our code; the first two are Apple's tooling. Delete
the DerivedData directory between runs or the numbers mean nothing. This is **not**
in CI: the runner image carries seven Xcodes and its default moves, so a pinned count
there would encode one version's noise as a requirement.

Not verifiable by an agent — the owner's list, kept in one place in
[RRR §10.2](../RRR.md) rather than restated here: enabling the extension in a real
Safari and exercising the hotkey, the toolbar button and the YouTube button;
Safari's *"Offers keyboard shortcuts"* field; how the all-sites permission reads
in Safari's UI; the icon on a real Dock; **verifying the signature on a signed
build** (§10.2.5); notarization secrets; and pushing.

Signing moved onto that list on 2026-07-27 for a measured reason: **the distribution
identity cannot be used from a non-interactive shell.**
`CODE_SIGN_IDENTITY="Developer ID Application" CODE_SIGN_STYLE=Manual` picks the right
identity — the log shows
`Signing Identity: "Developer ID Application: Arthur Ginzburg (R2294BC6J8)"` — and then
fails with `errSecInternalComponent`, because the private key wants keychain authorisation
only a logged-in GUI session can grant. From a session that *can* show the dialog, the same
command is what hung. Whether it completes once the dialog is answered is **unverified
here**; that is what `make app-signed CONFIRM=1` is for, and it is the owner's to run. So
RRR §10.1's old "`codesign -dv` shows a Developer ID authority" gate is not reachable by any
agent, and now lives in RRR §10.2 item 5.

(For contrast, *development* signing never prompted here: with the project's pinned
`CODE_SIGN_IDENTITY = "Apple Development"`, a plain `xcodebuild build` signed and
`codesign -dvvv` reported `Authority=Apple Development: Arthur Ginzburg (MA8T6SPDN2)` with
`flags=0x10000(runtime)`. It still reads the login keychain, which is why it is owner-only.)

## Environment facts that cost an hour if nobody tells you

- **`xcodebuild` needs `DEVELOPER_DIR`.** `xcode-select -p` on this machine
  prints `/Library/Developer/CommandLineTools`, which contains no `xcodebuild`, so
  a bare `xcodebuild` fails with *"tool 'xcodebuild' requires Xcode, but active
  developer directory … is a command line tools instance"*. The Makefile finds a
  directory that actually has `usr/bin/xcodebuild` and passes it as
  `DEVELOPER_DIR` itself, so `make` works with nothing exported — for a human and
  for an agent alike. Override the search with `make app DEVELOPER_DIR=…`.
  **A hand-run `xcodebuild` gets no such help: set `DEVELOPER_DIR=` on its command
  line yourself**, as `CLAUDE.md`'s canonical build command does.
  **Do not run `sudo xcode-select`** — it would make a human type a password to
  run `make`, and nothing here needs it.
- **`log` is a zsh builtin.** To read the system log — the only way to see what
  the container app or the extension's Swift handler printed — call it by
  absolute path. Predicate on the *process*, not on a subsystem: nothing in this
  project sets an `os_log` subsystem, so `subsystem CONTAINS "PiPOSS"` returns
  only launchd's own service-stub lines.
  ```sh
  /usr/bin/log show --last 10m --info \
    --predicate 'process == "PiPOSS" OR process == "PiPOSS Extension"'
  /usr/bin/log stream --info \
    --predicate 'process == "PiPOSS" OR process == "PiPOSS Extension"'
  ```
  Plain `log` silently does something else or complains about arguments.
- **`pnpm` arrives through corepack** (`/opt/homebrew/bin/pnpm` is a symlink into
  `corepack/dist/pnpm.js`), and the version is pinned by `packageManager` in
  `PiPOSS Extension/Resources/package.json`. The Makefile exports
  `COREPACK_ENABLE_DOWNLOAD_PROMPT=0` so an uncached version downloads instead of
  waiting at a prompt nobody sees.
- **`PiPOSS Extension/Resources/pnpm-workspace.yaml` is a required build input,
  not configuration.** It contains:
  ```yaml
  allowBuilds:
    esbuild: true
  ```
  Without it, pnpm 11 refuses to run esbuild's postinstall, `pnpm install` exits 1
  with `ERR_PNPM_IGNORED_BUILDS`, and the installed `esbuild` binary is a 9 351-byte
  JS shim instead of the real 9.8 MB native one — which is how a build can appear
  to succeed while shipping no content script at all. Neither
  `pnpm.onlyBuiltDependencies` in `package.json` (rejected with a warning) nor
  `onlyBuiltDependencies` in the workspace file (silently ineffective) is a
  substitute; this was measured, see DECISIONS 14 and 18. Never delete this file,
  and never wrap `pnpm install` in `2>/dev/null` or `|| pnpm install`.
- **A contributor on pnpm 10 or older reads none of the above** and hits the same
  `ERR_PNPM_IGNORED_BUILDS`. `packageManager: pnpm@11.17.0` is what stops that
  (DECISIONS 19).
- **Every app bundle on disk gets registered with LaunchServices, and duplicates break the
  app.** `make app` builds Debug while `make check` builds Release into the same
  DerivedData, so running both leaves two registered copies — and two is already enough for
  SafariServices to resolve the extension identifier to the wrong one. `make app` and
  `make app-signed` prune the strays themselves via the Makefile's `lsprune`; the check by
  hand, and the full explanation of why unregistering alone is not enough, are in the
  `Makefile`'s `lsprune` comment.
- Source maps are copied into the built `.appex` for both bundles, in Release too.
  Pre-existing, dead weight, and it exposes unminified source — DECISIONS 65.

## Release and notarization live in [`release.md`](release.md)

The owner's ordered release steps, the cask diff, the `sha256` routes, how to verify a
signed bundle without the keychain, and the `spctl` trap are all there. Two facts belong
here because they explain why this Makefile has **no release target**:

- **No agent can produce a Developer ID signed build on this machine at all** — see the
  previous section — so no agent can produce the input a release step would need.
  `make app-signed CONFIRM=1` is the closest thing that exists, and it stops at signing: it
  does not archive, notarize or staple.
- **Notarization credentials are not stored on this machine.** `xcrun notarytool history`
  exits 64 with *"Error: Must provide credentials."* (re-confirmed 2026-07-28). There is no
  keychain profile to pass to `--keychain-profile`.

So this file deliberately contains no notarization recipe. Writing the `notarytool submit`
incantation here would be writing instructions that have never been executed in this
repository, and the first person to trust them would debug our guesses instead of their
problem.

### Why `.github/workflows/` has a `ci.yml` and no `release.yml`

T13 added CI and deliberately stopped there. Same argument, one level up: a workflow is
code, and **committing a workflow whose steps have never run is committing a guess** —
worse than the doc form, because a workflow looks authoritative and runs unattended. None of
it can be exercised here: there is nothing to authenticate notarization with (above), and a
GitHub runner has neither identity in its keychain, so the archive-and-export half cannot be
tried locally *or* on a runner until the secrets exist. Adding those secrets is RRR §10.2
items 5–6 — the owner's, in the repository settings.

When the owner wants it, the shape is a `workflow_dispatch` + `push: tags: ['*']` job on
`macos-latest` that reuses this repository's own `make` targets for everything up to the
build, and then adds — in this order, each verified by hand first:

1. Import the Developer ID certificate into a **temporary** keychain created inside the
   job (`security create-keychain`, `import`, `set-key-partition-list`), from a
   base64-encoded `.p12` secret plus its password. This is the step that replaces
   `make app-signed`; a runner keychain has no dialog to raise, which is exactly why
   this is possible there and not here.
2. `xcodebuild archive` then `-exportArchive` with a Developer ID export options plist.
3. `xcrun notarytool submit --wait`, authenticated with an App Store Connect API key
   (`--key`, `--key-id`, `--issuer`) — a key is preferable to an app-specific password
   because it can be scoped and revoked.
4. `xcrun stapler staple`, then verify with `codesign -dv --verbose=4` and
   `xcrun stapler validate`. **Not `spctl`** — [`release.md`](release.md) §5 records why
   this machine's `spctl` accepts more readily than a user's Mac would.
5. Attach the zip to the release, and stop. The Homebrew cask lives in another
   repository and its edit is prepared by hand in [`release.md`](release.md); the cask
   `version` must equal the git tag because the cask's `url` interpolates
   `#{version}` (DECISIONS 215, 234).

Secrets it needs, so the owner can see the cost before agreeing to it:
`DEVELOPER_ID_P12_BASE64`, `DEVELOPER_ID_P12_PASSWORD`, `KEYCHAIN_PASSWORD`,
`APPSTORE_API_KEY_P8`, `APPSTORE_API_KEY_ID`, `APPSTORE_API_ISSUER_ID`.
