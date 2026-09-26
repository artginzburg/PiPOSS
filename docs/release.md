# Releasing PiPOSS

This file owns the **Developer ID / notarized channel**: the owner's ordered steps, the
Homebrew cask edit, and how to verify a signed bundle. The Mac App Store channel is
[`app-store.md`](app-store.md)'s, and the two are compared in its §6.

Everything here that an agent could verify has been verified, on this machine, on
2026-07-28. Every command is marked **[ran]** or **[not run here]** with the reason. That
distinction is the point of this file: two earlier documents in this project shipped
commands that did not work.

The Homebrew cask lives in **a different repository** —
[`artginzburg/homebrew-tap`](https://github.com/artginzburg/homebrew-tap), file
`Casks/piposs.rb`. Nothing in this repository can change it. **Editing, committing and
pushing that file is the owner's action.** This file only prepares the exact edit.

---

## 1. What the owner must do, in order

**Steps 2 to 5 are one command now.** They used to be four manual ones, and this file used
to call the channel blocked because notarization credentials are not on this machine. That
framing was wrong: the credential is an **App Store Connect API key**, it is issued **per
team**, and team R2294BC6J8 already has one — the same key WheelClick's release uses. There
is nothing to create in the developer portal, no provisioning profile (PiPOSS's
entitlements are `app-sandbox`, `files.user-selected.read-only` and `network.client`, none
of which demands one), and nothing durable left on the Mac.

1. **Check the version.** It lives in [`project.yml`](../project.yml) only:
   `grep -E 'MARKETING_VERSION|CURRENT_PROJECT_VERSION' project.yml`. `PiPOSS.xcodeproj` is
   generated and gitignored, so never edit the version in Xcode's inspector — the next
   `make` discards it. A committed test asserts `project.yml`, `manifest.json` and
   `package.json` agree, so bumping one and not the others fails `make check`.

2. **Build, notarize, staple, and get the hash:**

   ```bash
   make release CONFIRM=1
   ```

   Archives Release with Developer ID, exports, checks the signature *before* spending
   Apple's time, builds `build/release/PiPOSS.dmg`, submits it to the notary service,
   waits, staples, validates the staple, prints the `sha256`, and withdraws the app copies
   it created from LaunchServices (§7). `CONFIRM=1` is required because signing reads the
   login keychain and a keychain dialog hangs a build rather than failing it.

   One-time setup, if `ASC_PRIVATE_KEY_PATH` is not exported in the shell:

   ```bash
   xcrun notarytool store-credentials piposs-notary \
     --key <AuthKey_XXXXXXXXXX.p8> --key-id <KEY_ID> --issuer <ISSUER_ID>
   ```

   That stores it in the login keychain, where it is deletable like any other item. The
   `.p8` itself does not need to stay on disk afterwards.

3. **Or one click** — Actions → Release → **Run workflow**, with a box for release notes.
   [`.github/workflows/release.yml`](../.github/workflows/release.yml) then does everything
   above and publishes: gates, signed build, notarization, staple, the tag, and the GitHub
   release with the dmg attached. **Nothing is typed** — the tag is derived from
   `MARKETING_VERSION`, and the run refuses to start if that version is already released
   rather than discovering it after a notarization round trip. Leave the notes box empty and
   GitHub generates them from the commits.

   `gh release create` creates the tag itself from the built commit, so a failed build never
   leaves a tag pointing at an unreleased state. Pushing a bare-version tag by hand also
   works and skips that step.

   **The tag is a bare version, no `v` prefix** — §2.1's convention, and load-bearing rather
   than cosmetic: the cask's `url` interpolates `#{version}` straight into the download path,
   so a `v` prefix makes the cask 404. The first 2.0.0 release went out tagged `v2.0.0` and
   `brew audit --cask --online` caught it before the cask was pushed; the tag was renamed and
   the workflow now derives and validates the bare form.

   Five secrets, all per-team and reusable from any other app of team R2294BC6J8:
   `APPLE_CERTIFICATES_P12`, `APPLE_CERTIFICATES_PASSWORD`, `ASC_KEY_ID`, `ASC_ISSUER_ID`,
   `ASC_PRIVATE_KEY`. The certificates go into a throwaway keychain in `RUNNER_TEMP` that
   dies with the runner, and the API key into a file beside it.

   Release notes reach the shell through `env`, never inline `${{ … }}`: an input
   interpolates textually, so backticks or `$(…)` in the notes would **execute on the
   runner**. The sibling project's v1.0.1 notes ran a command that way.

4. **Apply the cask diff** in §2 to `artginzburg/homebrew-tap` — the one manual step left,
   because the cask is in a different repository this workflow has no token for. The run
   summary prints the three lines to paste, including the `url`, since the asset is a dmg
   now and every release up to 1.0.3 shipped `PiPOSS.zip`. Then `brew audit --cask --online
   piposs` in the tap, and push it there.

   Automating it needs a PAT with write access to the tap; deliberately not done, so no
   token in this repository can write to another.

5. **Confirm the round trip:** `brew update && brew install --cask artginzburg/tap/piposs`.
   On *this* machine prefer a fresh install to an upgrade — per §5 the recorded 1.0.3
   install points at an app that has been deleted, so an upgrade or uninstall path would
   try to remove an `/Applications/PiPOSS.app` that is not there. `brew uninstall --cask
   piposs` first if it complains.

6. **Record a metrics reading.** Baseline to subtract from: [`metrics.md`](metrics.md) §7 —
   2026-07-27: **127** cumulative GitHub downloads across four releases (1.0.3 alone: 22),
   **5** Homebrew installs in 365 d, **1** in 30 d. The counters are cumulative and move
   under you, so a release without a dated reading on both sides of it cannot be measured.

### The asset is a dmg now, not a zip

All four previous releases shipped `PiPOSS.zip`. `scripts/release.sh` produces
`PiPOSS.dmg` — a plain volume holding the app and a symlink to `/Applications`, no
background image and no AppleScript to place icons. Two consequences:

- **The cask's `url` asset name changes** with the version and hash. §2's diff covers it.
- **The dmg is what gets notarized**, not the app inside it. That is deliberate: Gatekeeper
  assesses the container a user downloads, and since February 2020 notarization is required
  for all Developer ID software, disk images included. Signing the dmg without notarizing
  it would not be enough.

### What is still verified, and what is not

Everything in this file that an agent could check has been checked on this machine and is
marked **[ran]** or **[not run here]** with the reason. Two things in the new path are
necessarily **[not run here]**: the notarization upload itself, because the key lives in
CI, and the export step, because Developer ID signing needs the login keychain. Everything
around them — the archive, the dmg's shape and mountability, the version check the workflow
performs, the LaunchServices cleanup — was run.

---

## 2. The cask diff

### 2.1 Version

Releases in this repo are tagged with a **bare version, no `v` prefix**, and the
asset is always `PiPOSS.zip`.

**[ran]** `gh api repos/artginzburg/PiPOSS/releases --jq '.[] | "\(.tag_name)\t\(.assets[].name)\t\(.assets[].size)"'`

```
1.0.3	PiPOSS.zip	957264
1.0.2	PiPOSS.zip	956428
1.0.1	PiPOSS.zip	4296632
1.0	PiPOSS.zip	3746059
```

The diff below uses **`2.0.0`**. Nothing in RRR or PLAN pins the number, so this
is a decision, not a fact: v2 is a full rewrite of both halves and it raises the
effective Safari floor to 15.4, which is user-visible breakage for someone on an
old Safari — that is a major bump under semver. **The one hard constraint is that
the string must equal the git tag**, because `url` interpolates `#{version}`. If
the owner tags `1.1.0` instead, only that one line changes.

### 2.2 The diff

Against `Casks/piposs.rb` at tap commit `077aa0e` (fetched read-only —
**[ran]** `gh api repos/artginzburg/homebrew-tap/contents/Casks/piposs.rb --jq
'.content' | base64 -d`).

```diff
 cask "piposs" do
-  version "1.0.3"
-  sha256 "f940e6d512d80e9e2541268e22c4914f8d67ba0c9e0b83064b9cb3d7a7cab5d6"
+  version "2.0.0"
+  sha256 "<64 hex digits from §3 — do not guess this value>"

   url "https://github.com/artginzburg/PiPOSS/releases/download/#{version}/PiPOSS.zip"
   name "PiPOSS"
-  desc "Brings Picture in Picture shortcut and custom button to any video"
+  desc "Picture in Picture for any Safari video, by hotkey or toolbar button"
   homepage "https://github.com/artginzburg/PiPOSS"

   depends_on :macos

   app "PiPOSS.app"

   uninstall trash: [
     "~/Library/Application Scripts/org.artginzburg.PiPOSS",
     "~/Library/Application Scripts/org.artginzburg.PiPOSS.Extension",
     "~/Library/Containers/org.artginzburg.PiPOSS",
     "~/Library/Containers/org.artginzburg.PiPOSS.Extension",
   ]
+
+  caveats <<~EOS
+    The Safari extension needs Safari 15.4 or later, which Homebrew cannot check.
+    On an older Safari the app still installs and opens, but if PiPOSS does not
+    turn up in Safari > Settings > Extensions, check your Safari version before
+    concluding the app is broken. Software Update offers Safari 15.4 or later on
+    every macOS this cask installs on.
+  EOS
 end
```

Three lines change (`version`, `sha256`, `desc`) and a seven-line `caveats`
stanza is added. Everything else is already correct and is deliberately left
alone.

The diff has no `---`/`+++`/`@@` headers, so it is meant to be applied by hand in the tap
repo — `git apply` will reject it. The 13 context lines and 3 removals are verbatim from
the live cask at `077aa0e`, so it is unambiguous where each hunk goes.

### 2.2.1 The proposed cask passes Homebrew's own checks

All three **[ran]**, on the file exactly as printed above, placeholder `sha256`
included. Homebrew will not lint a cask outside a tap, so it was placed in a
throwaway local tap; see §2.2.2 for how that was set up and torn down.

```
$ ruby -c <tap>/Casks/piposs.rb
Syntax OK
$ brew style --cask <tap>/Casks/piposs.rb
1 file inspected, no offenses detected     # exit 0
$ brew audit --cask piposs-audittest/tmp/piposs
Error: 1 problem in 1 cask detected.
audit for piposs: failed
 - sha256 string must be of 64 hexadecimal characters     # exit 1
```

That single audit finding **is the placeholder doing its job**. Substituting a real 64-hex
value (the 1.0.3 hash, purely to satisfy the format) makes the audit silent:

```
$ brew audit --cask piposs-audittest/tmp/piposs
$ echo $?
0
```

No output, exit 0: **the proposed cask is offline-audit-clean**. The only outstanding check
is the one that needs the published artifact — run `brew audit --cask --online piposs` in
the tap repo after pushing, which additionally verifies the `url` resolves and the hash
matches what GitHub serves.

`brew info` also loads it, which is how the caveats text was proof-read as the
user will actually see it:

```
$ brew info --cask piposs-audittest/tmp/piposs
==> piposs (PiPOSS): 2.0.0
Picture in Picture for any Safari video, by hotkey or toolbar button
...
==> Requirements
Required: macOS >= 11
==> Artifacts
PiPOSS.app (App)
==> Caveats
The Safari extension needs Safari 15.4 or later, which Homebrew cannot check.
On an older Safari the app still installs and opens, but if PiPOSS does not
turn up in Safari > Settings > Extensions, check your Safari version before
concluding the app is broken. Software Update offers Safari 15.4 or later on
every macOS this cask installs on.
```

Rendering it was not ceremony: the first draft's `caveats` reached this output as
`check Safari"'s version`, a shell-quoting artifact that both `ruby -c` and
`brew style` passed happily because it is valid Ruby. **Free text in a cask has to be
*read* rendered, not linted.**

### 2.2.2 Reproducing the lint, and two traps in it

```sh
TD=/opt/homebrew/Library/Taps/piposs-audittest/homebrew-tmp
mkdir -p "$TD/Casks" && (cd "$TD" && git init -q .)
cp piposs.rb "$TD/Casks/piposs.rb"
brew style --cask "$TD/Casks/piposs.rb"      # by path
brew audit --cask piposs-audittest/tmp/piposs # by NAME
rm -rf /opt/homebrew/Library/Taps/piposs-audittest
```

- **`brew audit` must be called by name, `brew style` by path.** By path, audit
  refuses outright: `Error: Calling brew audit [path ...] is disabled! Use brew
  audit [name ...] instead.` An earlier draft generalised that refusal — and a separate
  by-path `Refusing to load cask … from untrusted tap` from `brew info` — into "audit and
  info cannot be run without `brew trust`". Both run fine **by name** in an untrusted
  throwaway tap; no `brew trust` is needed, and no persistent Homebrew configuration was
  changed.
- **`brew untap` cannot clean this up.** Because the throwaway cask is also named
  `piposs`, it collides with the installed one and untap declines:
  `Error: Refusing to untap piposs-audittest/tmp because it contains the
  following installed casks`, then `==> Would untap … after uninstalling …`.
  Nothing is removed. Use `rm -rf` on the tap directory, as above. Verified
  afterwards: `/opt/homebrew/Library/Taps/` is back to `artginzburg jmslau`, and
  the real tap checkout is `git status`-clean at `077aa0e`. The same collision is
  why `brew info` on the throwaway reports the *real* `Installed (on request) …
  1.0.3` line — ignore it.

### 2.3 Why the macOS floor does not change

The v2 extension is Manifest V3 and therefore needs **Safari 15.4+** (RRR §2). That is not
the same constraint as the app's, and Homebrew has no `depends_on` key for a Safari version.

Raising the floor was considered and rejected on evidence. Safari 15.4 is
available *on Big Sur*, so a Big Sur user is not excluded by capability, only
possibly by not having updated:

> "Safari 15.4 is available for macOS Monterey 12.3, macOS Big Sur, macOS
> Catalina, iPadOS 15.4, and iOS 15.4."
> — <https://webkit.org/blog/12445/new-webkit-features-in-safari-15-4/>

*(Web-sourced, quoted verbatim, not measurable from this machine. The macOS ↔
Safari mapping is the one claim in this section that was not verified locally.)*

Note the direction: the app's floor (macOS 11) is **stricter** than Safari 15.4's
floor (macOS 10.15), so on every system this cask will install on, Safari 15.4 or
later is obtainable through Software Update. The problem is never "your Mac
can't", it is only "your Safari is old" — which is why the caveat's remedy is
always valid, and why `:monterey` would exclude working users for nothing.

Since 2026-09 the cask says `depends_on :macos` instead of `macos: :big_sur`:
Homebrew no longer supports anything older than Big Sur, and its
`Homebrew/OSDependsOn` style rule rejects a minimum equal to its own as
redundant, failing `brew test-bot` for the whole tap. The floor is the same
Big Sur; only the spelling changed.

### 2.4 Why a `caveats` line, and not the alternatives

- **`caveats` (chosen).** Homebrew prints caveats at the end of `brew install
  --cask` and in `brew info`, i.e. at the exact moment a user has just installed
  and is about to look for the extension in Safari. It is the only place in the
  cask that can carry a sentence at all. **[ran]** confirmation that the DSL
  accepts it: `grep -n "def caveats" /opt/homebrew/Library/Homebrew/cask/dsl.rb`
  → `711:    def caveats(*strings, &block)`.
- **`desc` (rejected as the *place* for it).** `desc` is one short searchable
  line; stuffing a version requirement into it would crowd out the words people
  search for and would still not be shown at install time. `desc` does change
  here, but for a different reason — see §2.5.
- **A conditional caveat** — `caveats` takes a block, so Ruby could read
  `/Applications/Safari.app/Contents/Info.plist` and warn only when Safari is
  old. Rejected: cleverness in someone else's repository, and it could not be
  tested from here.
- **Nothing (rejected).** Leaving it silent is the one option that is actually
  wrong. It ships a cask that installs cleanly onto a system where the extension
  never loads, and the user's only evidence is an app that seems to do nothing —
  the exact failure DECISIONS 115 identified in the README and fixed there.

**The caveat states the floor and hedges the symptom, deliberately.** An earlier draft
asserted "PiPOSS will not appear in Safari > Settings > Extensions" — the claim DECISIONS
115 *demoted to a reader-tested conditional* in the README, on the ground that how Safari
fails on a manifest it cannot parse is not something an agent can measure. The cask now
mirrors the README's hedge, which matters more here because the cask's text is printed to
every user by `brew install`. So README and cask agree on the **floor** — Safari 15.4, a
capability fact about MV3 — and both decline to assert the **symptom**, which neither has
measured.

### 2.5 Why `desc` changes

The current `desc` says "custom button". DECISIONS 114 established that this is
false twice over: on YouTube PiPOSS un-hides **YouTube's own** button, and RRR
§11 forbids custom buttons anywhere else. T15 removed that claim from the README
and from `_locales/en/messages.json`; the cask is the third copy of it, and
`brew search` / `brew info` show it. The replacement is true, keeps the searchable
words ("Picture in Picture", "Safari", "video") and describes both triggers that
actually exist.

### 2.6 The `uninstall trash:` list is correct — nothing to add or remove

Verified three ways, not assumed.

1. **The paths exist on disk, and no others do.** **[ran]**
   `find ~/Library -maxdepth 4 -iname "*piposs*"` returns 8 lines:

   ```
   ~/Library/Application Scripts/org.artginzburg.PiPOSS.Extension
   ~/Library/Application Scripts/org.artginzburg.PiPOSS
   ~/Library/Containers/org.artginzburg.PiPOSS.Extension
   ~/Library/Containers/org.artginzburg.PiPOSS
   ~/Library/Developer/Xcode/DerivedData/PiPOSS-afatnkhwjbincfcbebylcgmxgpuu
   ~/Library/Caches/claude-cli-nodejs/-Users-artginzburg-Repos-PiPOSS
   ~/Library/Caches/Homebrew/Cask/piposs--1.0.3.zip
   ~/Library/Caches/Homebrew/downloads/…--PiPOSS.zip
   ```

   The last four are not user data: a developer DerivedData directory, an agent
   tool's own cache, and Homebrew's own download cache (`brew cleanup` owns those;
   a cask must not). All four are artifacts of *this* machine being a development
   machine and would not exist on a user's.
   **[ran]** a per-directory sweep of `~/Library/Preferences`, `Caches`,
   `HTTPStorages`, `Saved Application State`, `WebKit`, `Group Containers`,
   `Application Support` and `Logs` — zero PiPOSS entries in any of them. The app
   is sandboxed, so everything lands in its container; there is no stray
   `org.artginzburg.PiPOSS.plist` to add.

2. **Homebrew's own install receipt names the same four.** **[ran]**
   `cat /opt/homebrew/Caskroom/piposs/.metadata/INSTALL_RECEIPT.json` →
   `uninstall_artifacts` lists precisely those four `trash` paths (plus the `app`
   artifact), from tap head `077aa0e…`.

3. **The bundle ids they are named after are unchanged.** **[ran]**
   `grep PRODUCT_BUNDLE_IDENTIFIER PiPOSS.xcodeproj/project.pbxproj` →
   `org.artginzburg.PiPOSS` and `org.artginzburg.PiPOSS.Extension`, matching RRR
   §2's "**unchanged**" row. If a future release ever renames a bundle id, all
   four strings move with it — that is the coupling to remember.

Two things deliberately *not* done:

- **Extension settings were not located.** v2 keeps settings in
  `browser.storage.local`, which Safari manages; it is not visible under the four
  paths above. Reading inside `~/Library/Containers/com.apple.Safari` can raise a
  Full Disk Access prompt, and CLAUDE.md forbids anything that can raise a system
  dialog during an autonomous phase, so it was not probed. **This does not affect
  the diff**: wherever Safari keeps it, a cask has no business deleting files
  inside Safari's container. Marked unverified.
- **The list was not moved to `zap trash:`.** Strict Homebrew convention says
  `uninstall` should only undo what installing did, and per-user containers are
  more of a `zap` concern. Rejected: it changes uninstall behaviour for existing
  users, has nothing to do with v2, and the current form works. Orthogonal
  cleanup, someone else's call, in the tap repo.

---

## 3. Getting the `sha256`

The hash is of the zip **as uploaded**. It cannot exist before the upload, so the
diff carries a visibly-fake placeholder rather than a plausible 64-hex string.
**Never invent it.**

Pick either route.

**A — hash the artifact you are about to upload (or just uploaded):**

```sh
shasum -a 256 /path/to/PiPOSS.zip
```

**[ran]** — proved end to end against the real 1.0.3 asset. The GitHub API
reports the 1.0.3 `PiPOSS.zip` as **957264 bytes** (§2.1); Homebrew's cached copy
of that download is 957264 bytes; and:

```
$ shasum -a 256 ~/Library/Caches/Homebrew/downloads/a672b06…--PiPOSS.zip
f940e6d512d80e9e2541268e22c4914f8d67ba0c9e0b83064b9cb3d7a7cab5d6
```

which is **byte-identical to the `sha256` pinned in the live cask**. So this
command, on this asset, reproduces exactly the value the cask needs.

**B — let Homebrew hash the published URL:**

```sh
brew fetch --cask artginzburg/tap/piposs   # prints the SHA-256 of what it downloaded
```

**[not run here]** — it would re-download the ~935 KB release asset, and an agent
does not download files unasked. Route A was run instead and matched, which is
the stronger evidence anyway. Use B as the cross-check after pushing: it hashes
what GitHub actually serves, catching a bad or re-cut upload.

A third form, `curl -fsSL "<release url>" | shasum -a 256`, also works and writes
nothing to disk. **[not run here]**, same reason.

---

## 4. What is automatable, and what is not

| Step | Automatable? | Evidence |
|---|---|---|
| Version bump, commit, tag | yes | ordinary git |
| Unsigned Release build | yes, already is | RRR §10.1.4; `make check` |
| **Signed** build (Developer ID, hardened runtime) | **no, not here** | signing reads the Developer ID private key from the login keychain → password dialog. CLAUDE.md forbids it; it hung once, on 2026-07-27 |
| **Notarize + staple** | **no, not here** | credentials are not stored on this machine |
| Verify a signed bundle | **yes** — no keychain needed | §5 |
| Zip + GitHub release | yes (`gh release create`) | `gh` is authenticated with `repo` scope; **[not run here]** — publishing is the owner's |
| Cask edit | prepared here; **push is the owner's** | different repository |

**[ran]** the notarization-credentials claim, rather than repeating RRR §7 from
memory:

```
$ xcrun notarytool history
Error: Must provide credentials.

See the 'store-credentials' command, App Store Connect API arguments for Team Keys
(--key, --key-id, --issuer), and Individual Keys (--key, --key-id), or app-specific
password arguments (--apple-id, --password, --team-id).
$ echo $?
64
```

So a GitHub Actions release workflow that notarizes needs an App Store Connect key, the
Developer ID identity as a base64 `.p12`, and its password, as repository secrets. **Only
the owner can add those** (RRR §10.2 item 6). No such workflow is committed, because an
agent cannot test it — writing one would be exactly the unverifiable instruction this file
exists to avoid. The shape it would take, when the owner wants it, is in
[`development.md`](development.md).

---

## 5. Verifying a signed build without the keychain

Both of these read the ticket stapled into the bundle; neither touches the
keychain, so the owner can run them right after notarizing, and so could an agent
if a signed bundle existed locally.

```sh
codesign -dv --verbose=2 /Applications/PiPOSS.app
xcrun stapler validate  /Applications/PiPOSS.app
```

Expect, from `codesign` (this is what 1.0.3 reported when it was checked —
DECISIONS 112):

- `Authority=Developer ID Application: Arthur Ginzburg (R2294BC6J8)`
- `flags=0x10000(runtime)` — hardened runtime
- `Notarization Ticket=stapled`

and `stapler validate` must pass.

**[not run here], and this is worth being precise about.** The brew-installed
1.0.3 that DECISIONS 112 checked **is gone from this machine**. `brew info --cask
artginzburg/tap/piposs` still says "Installed (on request) … 1.0.3 (0B)", but
`/opt/homebrew/Caskroom/piposs/1.0.3/PiPOSS.app` is a symlink to
`/Applications/PiPOSS.app`, which no longer exists. **[ran]** to establish that:

```
$ ls -ld /Applications/PiPOSS.app
ls: /Applications/PiPOSS.app: No such file or directory
$ codesign -dv --verbose=2 /opt/homebrew/Caskroom/piposs/1.0.3/PiPOSS.app
/opt/homebrew/Caskroom/piposs/1.0.3/PiPOSS.app: No such file or directory
$ xcrun stapler validate /opt/homebrew/Caskroom/piposs/1.0.3/PiPOSS.app
Processing: /opt/homebrew/Caskroom/piposs/1.0.3/PiPOSS.app
Stapler is incapable of working with Alias files.
```

So the two commands above are the *right* commands and were confirmed against
1.0.3 on 2026-07-27 (DECISIONS 112), but they could not be re-run on 2026-07-28.
Run them against the new bundle before uploading.

### The `spctl` trap

**Do not use `spctl` as evidence on this machine.** **[ran]**:

```
$ spctl --status
assessments disabled
```

With assessments disabled, `spctl -a -t exec` prints `accepted` together with
`override=security disabled` — it accepts more readily than a user's Mac would,
so a pass here proves nothing (DECISIONS 113, RRR §10.2 item 5). `codesign -dv`
and `stapler validate` read the stapled ticket instead of asking the local policy
engine, which is why they are the machine-independent evidence. If the `spctl`
check is wanted too, re-enable assessments first — and then it is a real check.

---

## 6. Deliberately not run, with the reason

Every command that *was* run is quoted with its output in the section that uses it. This
list is the other half — the scope audit:

- a signed `xcodebuild`, and therefore the export step — login keychain → password dialog
  (CLAUDE.md). This is why `make release` demands `CONFIRM=1`.
- `xcrun notarytool submit` / `stapler staple` — the App Store Connect key lives in CI, not
  on this machine. **Not a blocker**, and this list used to imply it was: the key is
  per-team and already exists, so the owner runs one command. §1.
- `brew fetch --cask` and the `curl | shasum` form — would download the asset
- `brew audit --cask --online` — needs the artifact published at the `url`
- `gh release create`, any push to either repository — the owner's
- reading `~/Library/Containers/com.apple.Safari` — can raise a Full Disk Access
  prompt
