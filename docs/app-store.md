# PiPOSS and the Mac App Store

**Nothing here submits anything.** RRR §11 settles it: *prepare technically, do not
submit*. This file is the audit (T18) — what the entitlements actually are, whether the
App Store is even open to an app shaped like this one, what it would cost, and a
recommendation the owner can act on or ignore in one reading.

This file owns the **Mac App Store channel**. The Developer ID / notarized channel — the
release steps, the cask, verifying a signed bundle — is [`release.md`](release.md)'s; §6
is where the two meet.

Convention borrowed from `release.md`: **[ran]** marks a command whose real output is
quoted, **[read]** marks a claim that comes from a document rather than from a measurement,
and **[not established]** marks a question this file deliberately leaves open rather than
guessing at. Six platform claims in this project have already had to be retracted for being
stated as fact; the markers are the cheap way not to add a seventh.

---

## 1. The short version

| Question | Answer |
|---|---|
| Is the App Sandbox on? | **Yes — on both the app and the `.appex`, and it has been since release 1.0 in August 2022.** |
| So "App Sandbox enabled" was a deliverable? | **No — it was never one.** PLAN's *"Produces: App Sandbox enabled"* describes a property the project has had in every release it has ever shipped (§2.2). The audit is the value of this task; enabling the sandbox was not work. |
| Does the sandbox break the extension? | **No** — the sandboxed, notarized 1.0.3 in the Homebrew cask is the working product people have been downloading for nine months. |
| Is anything blocking a Mac App Store submission technically? | Nothing found. The remaining work is all account and metadata work, and all of it is the owner's. |
| What did T18 change? | Removed two entitlements nothing needs, made the deployment floor one number, pre-answered the encryption-export question, and built a **product-level** gate that asserts the signed entitlement set against an exact allow-list, so no future setting can add a grant silently. |
| Recommendation | §7. |

---

## 2. The entitlement set, measured

### 2.1 Where the entitlements come from, which is not where you would look

Both `PiPOSS/PiPOSS.entitlements` and `PiPOSS Extension/PiPOSS_Extension.entitlements`
are `<dict/>` — **empty**. Anyone auditing this app by opening those files concludes it
is unsandboxed. It is not.

What reaches the signature is computed from *build settings* — `ENABLE_APP_SANDBOX`,
`ENABLE_OUTGOING_NETWORK_CONNECTIONS`, `ENABLE_USER_SELECTED_FILES` and their
neighbours — by Xcode's own product-packaging step. The mapping is not folklore; it is
one table in one file of Apple's build system, `SWBCore/SpecImplementations/Tools/
ProductPackaging.swift`, which is present locally inside Xcode 26.6 **[ran]**:

```
$ strings -a /Applications/Xcode.app/Contents/SharedFrameworks/SwiftBuild.framework/…/SWBCore \
    | grep -n "com.apple.security" | head -3
com.apple.security.get-task-allow
com.apple.security.cs.allow-dyld-environment-variables
com.apple.security.cs.allow-jit
```

and open source, which is where the pairing is legible **[read]**
([swiftlang/swift-build, `ProductPackaging.swift`](https://github.com/swiftlang/swift-build/blob/main/Sources/SWBCore/SpecImplementations/Tools/ProductPackaging.swift)):

| Build setting | Entitlement it writes |
|---|---|
| `ENABLE_APP_SANDBOX` | `com.apple.security.app-sandbox` |
| `ENABLE_INCOMING_NETWORK_CONNECTIONS` | `com.apple.security.network.server` |
| `ENABLE_OUTGOING_NETWORK_CONNECTIONS` | `com.apple.security.network.client` |
| `ENABLE_USER_SELECTED_FILES` | `com.apple.security.files.user-selected.read-only` / `.read-write` |
| `ENABLE_RESOURCE_ACCESS_*`, `AUTOMATION_APPLE_EVENTS` | the matching `device.*` / `personal-information.*` / `print` / `automation.apple-events` key |
| `ENABLE_HARDENED_RUNTIME` | **none** — it sets the `runtime` code-signing flag, not an entitlement |

Two details that decide how to read the settings list, both from that source **[read]**:

- a setting evaluating to `NO` **omits** the key rather than writing `false`
  (`if cbc.scope.evaluate(buildSetting) { entitlementsDictionary[entitlement] = .plBool(true) }`).
  So the explicit `ENABLE_RESOURCE_ACCESS_CAMERA: NO`-style lines in `project.yml` grant
  nothing at all. They are documentation, and they are kept for that reason.
- `com.apple.security.get-task-allow` is *removed* for a deployment build, which is what
  makes a build notarizable.

### 2.2 The actual key sets, from real signatures

The entitlements are embedded by the **signing** step, and the default unattended build
here passes `CODE_SIGNING_ALLOWED=NO`, because *identity* signing reaches into the login
keychain and raises a dialog (CLAUDE.md). So the obvious check reads nothing at all
**[ran]**, on a `** BUILD SUCCEEDED **` `SIGN=no` Release build:

```
$ codesign -d --entitlements - --xml /tmp/piposs-dd-t18/Build/Products/Release/PiPOSS.app/Contents/MacOS/PiPOSS
Executable=/private/tmp/piposs-dd-t18/Build/Products/Release/PiPOSS.app/Contents/MacOS/PiPOSS
$ find /tmp/piposs-dd-t18 -name "*.xcent*"
```

Nothing after the `Executable=` line, and the `find` printed **no output** — no `.xcent`
anywhere in the derived data, so the product-packaging task never ran and the entitlements
were neither computed nor embedded. (`ENTITLEMENTS_REQUIRED=YES` does not change it:
tried, still no `.xcent`, still zero `codesign` invocations.)

**That is a property of `SIGN=no`, not a limit on what an agent can verify** — a correction
to an earlier draft, which claimed the entitlement set could not be read off anything an
agent builds. It can, by signing **ad-hoc**: `codesign --sign -` is special-cased to use no
identity, so it resolves nothing, opens no keychain and cannot raise a dialog.
`make entitlements` is that build, and it is what the gate now runs **[ran]**:

```
$ xcodebuild … CODE_SIGNING_ALLOWED=YES CODE_SIGNING_REQUIRED=YES \
    CODE_SIGN_IDENTITY="-" CODE_SIGN_STYLE=Manual PROVISIONING_PROFILE_SPECIFIER="" build
** BUILD SUCCEEDED **

# the signing command the build actually ran — note `--sign -`, and no identity to look up:
/usr/bin/codesign --force --sign - -o runtime --entitlements ….appex.xcent \
    --timestamp=none --generate-entitlement-der …/PiPOSS Extension.appex

$ codesign -d --entitlements - --xml …/Release/PiPOSS.app | plutil -p -
{
  "com.apple.security.app-sandbox" => true
  "com.apple.security.get-task-allow" => true
}
$ codesign -d --entitlements - --xml "…/PlugIns/PiPOSS Extension.appex" | plutil -p -
{
  "com.apple.security.app-sandbox" => true
  "com.apple.security.get-task-allow" => true
}
$ codesign -dv …/PiPOSS.app
CodeDirectory v=20500 … flags=0x10002(adhoc,runtime)
```

`ProcessProductPackaging` ran 4× and both `.xcent` files exist. Three things are now
verified in a *product* rather than in a declaration: the sandbox on both bundles, the
absence of every other `com.apple.security.*` grant, and — from `flags=…(runtime)` — the
hardened runtime that `ENABLE_HARDENED_RUNTIME` is supposed to produce.

Two cautions about that dump, both load-bearing. **`get-task-allow` is a
development-signing artefact**, not something this project asks for: Xcode adds it and
removes it again when `DEPLOYMENT_POSTPROCESSING` is on, which is what makes a build
notarizable, so it is in the allow-list and is *not* evidence about what ships. And an
ad-hoc bundle **must never be installed** — an ad-hoc-signed app is exactly what Safari
refuses to register an extension from (BF09,
[`research/safari-extension-signing-2026-07.md`](research/safari-extension-signing-2026-07.md)).
The Makefile says both of those out loud, and `test/entitlements.test.ts` asserts that
ad-hoc has not become a `SIGN` mode anyone can reach by accident.

For what **ships**, read the shipped thing. The 1.0.3 zip is still in Homebrew's download
cache, and `codesign -d` only *displays* a signature, so it needs no key and no keychain
**[ran]**:

```
$ ditto -x -k ~/Library/Caches/Homebrew/downloads/a672b069…--PiPOSS.zip /tmp/t18-shipped
$ codesign -d --entitlements - --xml /tmp/t18-shipped/PiPOSS.app | plutil -p -
{
  "com.apple.security.app-sandbox" => true
  "com.apple.security.files.user-selected.read-only" => true
  "com.apple.security.network.client" => true
}
$ codesign -d --entitlements - --xml "/tmp/t18-shipped/PiPOSS.app/Contents/PlugIns/PiPOSS Extension.appex" | plutil -p -
{
  "com.apple.security.app-sandbox" => true
  "com.apple.security.files.user-selected.read-only" => true
}
```

That is the shipped, Developer ID–signed, notarized, stapled product — same command
**[ran]** for the rest of its signature:

```
Authority=Developer ID Application: Arthur Ginzburg (R2294BC6J8)
flags=0x10000(runtime)
Notarization Ticket=stapled
Sealed Resources version=2 rules=13 files=11
```

**So the App Sandbox is not a change T18 had to make, not a risk it introduced, and not
new.** It has been on since **release 1.0**, 2022-08-27 — the entitlements *plists* carried
`com.apple.security.app-sandbox` from the initial commit onwards, on both bundles **[ran]**:

```
$ git show '1.0:PiPOSS/PiPOSS.entitlements'            → com.apple.security.app-sandbox true
$ git show '1.0:PiPOSS Extension/PiPOSS_Extension.entitlements' → the same
```

`c2a0459` (2025-10-04) did not enable anything; it moved the statement from the plists
into build settings, which is why the commit table in §2.3 counts *zero* `pbxproj`
declarations before then. And 1.0.3 — sandboxed, notarized, in the cask, in use — is the
proof that the sandbox does not break the extension.

### 2.3 What T18 removed, and why it was there

Two of those five keys are grants for capabilities this app does not have.

| Entitlement | Needed by anything here? |
|---|---|
| `com.apple.security.network.client` | **No.** No `URLSession` in either Swift target, no `fetch`/`XMLHttpRequest` in `src/`, and `otool -L` on the built binary links neither Network nor CFNetwork — SafariServices, Foundation, AppKit, Combine, SwiftUI and the Swift runtime, nothing else. **[ran]** |
| `com.apple.security.files.user-selected.read-only` | **No.** No `NSOpenPanel`, no `NSSavePanel`, no `fileImporter`; the options page's only `input`s are a read-only hotkey field and two checkboxes; the manifest's `permissions` are `activeTab`, `scripting`, `storage` and there is no `downloads`. **[ran]** |

Neither was a decision anybody made. They are Xcode template defaults, and the trail is
in this repository's own history **[ran]**. The 2022 initial commit's plist, straight out
of the template:

```
$ git show 100290f:PiPOSS/PiPOSS.entitlements      # Initial Commit, 2022-08-23
  com.apple.security.app-sandbox                   true
  com.apple.security.files.user-selected.read-only true
  com.apple.security.network.client                true
```

and then, counting **`project.pbxproj` build-setting declarations** at each commit that
changed them. Read the zeroes carefully: they mean the setting is not in the *project
file*, **not** that the grant was absent — until `c2a0459` the plists above were where the
entitlement set lived, so the 2023 row is a sandboxed app with nothing to declare.

| commit | date | `ENABLE_APP_SANDBOX` | `…OUTGOING_NETWORK…` | `…USER_SELECTED_FILES` | plists carry the grants? |
|---|---|---|---|---|---|
| `f3a6205` "Start making preferences" | 2023-04-19 | 0 | 0 | 0 | **yes** |
| `2c34a2d` "feat: TypeScript, ESBuild" | 2025-10-04 | 2 | **2** | 0 | yes |
| `1bc58d8` "chore: Bump version" | 2025-10-04 | 4 | 2 | **4** | yes |
| `c2a0459` "dev: Update to recommended project settings" | 2025-10-04 | 4 | 2 | 4 | **no — emptied** |

So the sequence was: the grants moved from the plists into *build settings* during the
October 2025 work (`2c34a2d` for the app, `1bc58d8` adding the appex and the file
grant), and then `c2a0459` — *"Update to recommended project settings"* — **emptied the
plists**, leaving the settings as the only statement of the entitlement set and no
visible trace of it in the file whose name says "entitlements". Nothing in that sequence
asked whether the app needs a network client; the answer was inherited from a template in
2022 and carried forward twice.

And the template still does it in Xcode 26.6 **[ran]**, on
`Templates/Project Templates/MultiPlatform/Application/macOS Safari Extension App.xctemplate/TemplateInfo.plist`:

```
ENABLE_APP_SANDBOX = YES
ENABLE_HARDENED_RUNTIME = YES
ENABLE_OUTGOING_NETWORK_CONNECTIONS = YES
ENABLE_USER_SELECTED_FILES = readonly
```

and on the `macOS Safari Extension.xctemplate` (the appex): `ENABLE_APP_SANDBOX`,
`ENABLE_HARDENED_RUNTIME`, `ENABLE_USER_SELECTED_FILES = readonly`. Two things follow.
First, the grants were template noise for the entire life of the project. Second —
and this is the useful half — **Apple's own current template sandboxes the Safari web
extension appex**, which is the answer to "does sandboxing the appex break something".

The set after T18, therefore — and the "after" column is measured in the ad-hoc-signed
product of §2.2, not merely declared:

| | before (shipped 1.0.3) | after |
|---|---|---|
| `PiPOSS.app` | `app-sandbox`, `files.user-selected.read-only`, `network.client` | **`app-sandbox`** (+ `get-task-allow`, which a deployment build strips) |
| `PiPOSS Extension.appex` | `app-sandbox`, `files.user-selected.read-only` | **`app-sandbox`** (+ the same artefact) |

One real entitlement each: the one the Mac App Store requires.

**How that is held, in two layers, because one of them is not enough.**
`test/entitlements.test.ts` asserts the *declarations* — it runs in milliseconds and reads
**every** project definition on disk, `project.yml` and the generated `project.pbxproj`,
per DECISIONS 231 — but it can only name settings somebody thought of. An earlier draft of
this document claimed that suite "fails if either target loses it or gains anything else",
and that was false: measured, flipping `ENABLE_RESOURCE_ACCESS_CAMERA` to `YES` shipped
`com.apple.security.device.camera` in the product with all eleven tests green, and
`ENABLE_INCOMING_NETWORK_CONNECTIONS` did the same with `network.server`. So `make check`
now also runs **`make entitlements`**, which dumps the ad-hoc-signed product and requires
the key set to *equal* the allow-list — a positive assertion over the whole set, which
catches settings Xcode has not invented yet. Both mutations now fail it **[ran]**:

```
FAIL PiPOSS.app: signed entitlements are not the allow-list.
  want:                                    got:
    com.apple.security.app-sandbox           com.apple.security.app-sandbox
    com.apple.security.get-task-allow        com.apple.security.device.camera
                                             com.apple.security.get-task-allow
```

`pnpm run test` on its own is therefore *not* full coverage of the entitlement set. Rather
than leave that as a comment nobody reads, the vitest suite asserts that `make check`
still depends on `entitlements` and that the allow-list is still exactly those two keys —
so deleting the product-level half turns the fast half red.

**[not established], and it is the one thing worth a glance in Safari:** that removing
`files.user-selected.read-only` from the appex changes nothing at runtime. It cannot be
established here — observing Safari needs a GUI, which an autonomous phase must not open
(CLAUDE.md). The reasoning is that nothing in the extension opens a file, the failure
mode of a missing sandbox grant is loud (a denial in the system log, not silent
misbehaviour), and reverting is a one-line change. It is listed in §5 as an owner check.

---

## 3. Is the Mac App Store open to an app shaped like this?

Nothing found that closes it.

**Safari extensions are an App Store product category, in Apple's words** **[read]**
([Distributing your Safari web extension](https://developer.apple.com/documentation/safariservices/distributing-your-safari-web-extension)):
it carries a section headed *"Distribute your extension in the App Store"* — archive the
containing app, upload, submit for review — and another headed *"Distribute your Developer
ID–signed and notarized extension outside the Mac App Store"*. Two channels, described as
alternatives, both supported, and a macOS containing app is one of the accepted shapes.

**The sandbox is a hard requirement, and it is already met** **[read]**
([App Review Guidelines 2.4.5](https://developer.apple.com/app-store/review/guidelines/)):

> 2.4.5 Apps distributed via the Mac App Store have some additional requirements to keep
> in mind: (i) They must be appropriately sandboxed […]

The rest of 2.4.5 is worth reading once against this app, because six of its nine items —
(ii) through (vii) — are about behaviours PiPOSS does not have (no third-party installer,
no auto-launch, no downloaded code, no root escalation, no license screen, no self-updater)
and one of those six is a real constraint on the *other* channel — **(vii) "They must use the Mac App Store to
distribute updates"**, which is what makes the cask and a MAS build two products rather
than one (§6).

**The SafariServices API surface is three calls, none of them entitlement-gated**
**[ran]** — the whole of what either target uses:

| Call | Used in | Note |
|---|---|---|
| `SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier:completionHandler:)` | `ContentView.swift` | reads whether the extension is enabled |
| `SFSafariApplication.showPreferencesForExtension(withIdentifier:completionHandler:)` | `ContentView.swift` | opens Safari's Extensions settings |
| `SFSafariApplication.dispatchMessage(withName:toExtensionWithIdentifier:userInfo:completionHandler:)` | `ContentView.swift` | app → extension message |

plus `NSExtensionRequestHandling` in the appex. None of these requires a
`com.apple.developer.*` entitlement, and the shipped sandboxed 1.0.3 exercises all three
in the product people use — which is stronger evidence than any document, since it is the
same API set under the same sandbox. **[not established]:** whether App Review has any
policy about `host_permissions: *://*/*` plus an all-sites content script beyond asking
what it is for. It is not a rule anybody could cite; it is a question to be ready to
answer, and the answer is the product — a video element can be on any page.

---

## 4. The checklist — repo items

These live in this repository, which means an agent can do them and a gate can hold them.

### 4.1 Done

| Item | Where | Evidence |
|---|---|---|
| App Sandbox, app **and** appex | `project.yml` `ENABLE_APP_SANDBOX: YES` ×2 — **and since release 1.0, never off** | dumped from the ad-hoc-signed product *and* from shipped 1.0.3 (§2.2) **[ran]**; held by `make entitlements` and `test/entitlements.test.ts` |
| No entitlement the app does not need | `project.yml` | §2.3. The product dump carries `app-sandbox` and nothing else **[ran]**, and `make entitlements` fails on *any* extra key — not only on the two that were removed |
| Entitlements plists stay empty, and are never copied into a bundle | `PiPOSS/*.entitlements`, `buildPhase: none` | gate; `find PiPOSS.app -name '*.entitlements'` prints nothing **[ran]** — the empty output is the evidence, since `find` exits 0 either way |
| Hardened runtime, app **and** appex | `ENABLE_HARDENED_RUNTIME: YES` ×2 | required by the notarized channel; `flags=0x10000(runtime)` on 1.0.3 and `flags=0x10002(adhoc,runtime)` on the verification build, so it is asserted on the product by `make entitlements` **[ran]**. **[not established]** whether MAS requires it — it is kept because the Developer ID channel does, and one configuration is simpler than two |
| `LSApplicationCategoryType` | `INFOPLIST_KEY_LSApplicationCategoryType: public.app-category.productivity` | in the built `Info.plist` **[ran]**. A macOS upload is reported to fail validation without it (ITMS-90242, [Apple Developer Forums 737134](https://developer.apple.com/forums/thread/737134)) **[read]** — moot here, it is set. Whether *productivity* is the best category for discovery is the owner's marketing call |
| `NSHumanReadableCopyright` | `INFOPLIST_KEY_NSHumanReadableCopyright` | `Copyright © 2022 Art Ginzburg. All rights reserved.` in the built plist **[ran]** |
| Version and build string, app and appex agreeing | `MARKETING_VERSION: 2.0.0`, `CURRENT_PROJECT_VERSION: 5` on both targets | built plists read `CFBundleShortVersionString 2.0.0` / `CFBundleVersion 5` for **both** bundles **[ran]** |
| Bundle ids, appex prefixed by the app's | `org.artginzburg.PiPOSS`, `org.artginzburg.PiPOSS.Extension` | RRR §2 pins them; §11 forbids renaming in v2 |
| Encryption export declaration | `INFOPLIST_KEY_ITSAppUsesNonExemptEncryption: NO` — **added by T18** | lands as a real Boolean, not a string: `"ITSAppUsesNonExemptEncryption" => false` in the built plist **[ran]**. Correct because the app performs no encryption at all — it makes no network request (§2.3). Without the key, App Store Connect asks the export-compliance question on **every** upload. The key is **inert outside App Store Connect** — it changes nothing about the app, the cask build or Gatekeeper — and it does not discharge the obligation: the owner still confirms export compliance at upload, and must revisit the declaration if PiPOSS ever gains networking |
| One deployment floor | `MACOSX_DEPLOYMENT_TARGET: 11.0` everywhere — **fixed by T18** | was 12.3 at project level; see §4.3 |
| No third-party SDKs | — | the app links system frameworks only **[ran]**; the extension bundles nothing but its own TypeScript |

### 4.2 Remaining, and deliberately not done

- **A privacy manifest (`PrivacyInfo.xcprivacy`) — not added.** Apple's requirement is
  scoped **[read]**
  ([Privacy manifest files](https://developer.apple.com/documentation/bundleresources/privacy-manifest-files)):
  required-reason API declarations are needed *"on iOS, iPadOS, tvOS, visionOS, and
  watchOS"* — macOS is **not** in that list — and the data-collection section is needed
  *"on all platforms"*. PiPOSS uses no required-reason API on any platform anyway (it has
  no `UserDefaults`, no `@AppStorage`, no file-timestamp, disk-space, boot-time or
  active-keyboard call **[ran]**) and collects nothing. The data-collection answer that
  App Review actually consumes is the App Store Connect privacy questionnaire, which is
  §5's and cannot be committed here. So the file would duplicate an owner action and add
  a bundle resource for no verifiable gain. If the owner wants it anyway, this is the whole
  file:

  ```xml
  <?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
  <plist version="1.0">
  <dict>
      <key>NSPrivacyTracking</key>          <false/>
      <key>NSPrivacyTrackingDomains</key>   <array/>
      <key>NSPrivacyCollectedDataTypes</key><array/>
      <key>NSPrivacyAccessedAPITypes</key>  <array/>
  </dict>
  </plist>
  ```

  It goes in the app target's `sources:` as a copied resource, and the same file in the
  appex if the extension is ever declared separately.

- **No MAS build configuration, and no `make` target for one.** A MAS archive must be
  signed with *Mac App Distribution* and carry a Mac App Store provisioning profile
  (§6), which means the login keychain, which means a password dialog at a sleeping
  owner. CLAUDE.md forbids it and no agent can test it, so writing one would be an
  unverifiable instruction dressed as infrastructure — the mistake `release.md` §4
  already refuses to make. The owner's commands are in §5.

- **All four version strings agree** — `MARKETING_VERSION`, `CURRENT_PROJECT_VERSION`,
  `manifest.json` and `package.json`. They did not while this audit was written: T12 bumped
  the project and left the two JSON files at `1.0.3`, so the extension would have introduced
  itself to the user as the old version. Fixed since, and a gate in
  `test/entitlements.test.ts` now fails if they drift apart again.
  **[not established]** which string Safari's Extensions pane displays for an extension,
  the manifest's or the containing app's.

### 4.3 The deployment floor, and why a dead setting was worth a change

`project.yml` said `MACOSX_DEPLOYMENT_TARGET: 12.3` at project level and `11.0` on both
targets. The targets win, so 12.3 decided nothing — T12 kept it deliberately, under a
criterion that nothing may change. **[ran]**, before the change, on the real project:

```
$ xcodebuild -target PiPOSS           -showBuildSettings | grep MACOSX_DEPLOYMENT_TARGET
    MACOSX_DEPLOYMENT_TARGET = 11.0
$ xcodebuild -target "PiPOSS Extension" -showBuildSettings | grep MACOSX_DEPLOYMENT_TARGET
    MACOSX_DEPLOYMENT_TARGET = 11.0
```

Inert — until a third target exists. **[ran]**, on an isolated XcodeGen spec with the
same shape (project level 12.3, one target overriding to 11.0, one target added without
an override):

```
--- Pinned ---
    MACOSX_DEPLOYMENT_TARGET = 11.0
--- AddedLater ---
    MACOSX_DEPLOYMENT_TARGET = 12.3
```

The new target ships a floor 1.3 releases above what RRR §2 pins, DECISIONS 223 leans on
and the README promises out loud ("Needs macOS 11 or later"), and nothing fails. So the
project level now says 11.0 too, the gate asserts every definition on disk states exactly
one floor, and the change was verified inert rather than assumed to be **[ran]** — both
products' `LC_BUILD_VERSION` still read `minos 11.0`, all four architecture slices.

---

## 5. The checklist — owner only

None of this can be done, or claimed as done, by an agent. It is RRR §10.2 territory:
certificates need the login keychain, App Store Connect needs a login, and review needs a
human to answer questions.

**Account and signing**

1. **Nothing to pay.** The Apple Developer Program membership is already active — the
   *Developer ID Application: Arthur Ginzburg (R2294BC6J8)* authority on the shipped
   1.0.3 **[ran]** is only issuable to an enrolled team, and notarization needs the same
   membership. **The $99/yr is a sunk cost, not a cost of the App Store.**
2. Create the two distribution certificates, whose exact names are **[read]**
   ([Certificates overview](https://developer.apple.com/support/certificates/)):
   **Mac App Distribution** ("sign a Mac app before submitting it to the Mac App Store")
   and **Mac Installer Distribution** ("sign and submit a Mac Installer Package"). Only
   an Account Holder or Admin can create them. These are *additional* to the Developer ID
   certificates the cask channel uses — one per team, they do not replace anything.
3. Register the App IDs and create a **Mac App Store provisioning profile** for **both**
   bundle ids — `org.artginzburg.PiPOSS` *and* `org.artginzburg.PiPOSS.Extension`. The
   appex is signed separately (that is why `project.yml` names signing settings on both
   targets), so it needs its own profile.

**App Store Connect metadata** — all of it lives in ASC, none of it in this repository

4. Create the app record. The ASC **name** is display metadata and need not equal the
   bundle name, so `docs/naming.md`'s shortlist is usable here without renaming anything
   — which keeps RRR §11 intact.
5. Category, price (free), age rating.
6. Screenshots (the App Store requires macOS screenshots at Apple's fixed sizes) and a
   description. **[not established]** the current required pixel sizes — read them off
   ASC at the time, they change.
7. **Privacy questionnaire** — the "nutrition label". The honest answer for PiPOSS is
   *Data Not Collected*: no telemetry (RRR §11), no network client entitlement any more,
   settings in `browser.storage.local` only.
8. A privacy policy URL and a support URL. **[not established]** which of the two App
   Store Connect currently refuses to publish without — read the form. The repository's
   README and issue tracker can serve as support; the privacy policy is a page the owner
   has to publish somewhere either way.
9. Export compliance: already pre-answered by `ITSAppUsesNonExemptEncryption` (§4.1), so
   ASC should stop asking. Confirm on the first upload.

**Build, upload, review**

10. Archive with the MAS identity and profile, then export with the App Store method and
    upload (Xcode's Organizer, or Transporter). **[not established]** as commands,
    deliberately: an agent cannot run a signed archive here, and `release.md` §4 is the
    precedent for not committing build recipes nobody could test.
11. **Do not notarize a MAS build.** Notarization is the *other* channel's step (§6).
12. Submit for review, and answer the all-sites-permission question if it comes (§3).
13. **Look at Safari once** after installing a build with the reduced entitlements: the
    extension appears in Safari ▸ Settings ▸ Extensions, the toolbar button toggles PiP,
    the options page saves. This is the §2.3 open question, and it is two minutes. It is
    the **only** item on this list that exists because of T18's change.

*Deliberately no longer on this list:* "dump the entitlements of a signed build". An
earlier draft asked the owner for it, on the false premise that no agent could. `make
entitlements` does it on every `make check` by signing ad-hoc, which resolves no identity
and so needs no keychain (§2.2). What is still worth one look on a **Mac App Store**
archive specifically: whether the embedded provisioning profile adds identity keys such as
`com.apple.application-identifier` and `com.apple.developer.team-identifier`.
**[not established]** here, so do not read those two as a regression — read any extra
`com.apple.security.*` key as one.

---

## 6. The cask and the App Store are two products, not two buttons

This is the part that needs a decision rather than a checklist.

**The signatures are different and mutually exclusive per build** **[read]**
([Certificates overview](https://developer.apple.com/support/certificates/)): Mac App
Distribution is "before submitting it to the Mac App Store"; Developer ID Application is
"before distributing it outside the Mac App Store". A MAS-signed build also carries an
embedded provisioning profile and is not notarized by the developer; a notarized
Developer ID build is not acceptable as an App Store upload. **One archive cannot be
both.** Shipping both channels therefore means two archives per release, from the same
source, signed twice — the Developer ID one exactly as [`release.md`](release.md)
describes, plus §5 items 10–13 for this one.

**One bundle id or two.** RRR §11 forbids renaming in v2, and there is a stronger reason
than process to keep one: a Safari web extension's storage is keyed to the extension's
identity, so a second bundle id would be a *different* extension to Safari — separate
`browser.storage.local`, a second row in Safari's Extensions list, and a user's hotkey
and toggles left behind in the old one. **[not established]** by measurement here, but it
follows from what `storage.local` is. The cost of keeping one id is small and bounded: a
user who installs *both* the cask and the App Store copy has two apps with the same
bundle id, which macOS handles badly. The mitigation is a sentence in the README telling
people to pick one channel, not a rename.

**Version numbers can be shared.** `MARKETING_VERSION` is free to be the same string on
both channels — and DECISIONS 234 already forces project, git tag and cask to agree.
`CFBundleVersion` is what App Store Connect uses to tell uploads apart: *"the build
string is used to uniquely identify the build throughout the system"* **[read]**
([Upload builds](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/)),
so a re-upload of the same marketing version needs a new build number. The cask does not
care about the build number at all. So: same `2.0.0` on both, and `CURRENT_PROJECT_VERSION`
increments for every ASC upload, including rejected ones.

**One rule constrains the pair**: 2.4.5(vii) — *"They must use the Mac App Store to
distribute updates; other update mechanisms are not allowed."* **[read]**. PiPOSS has no
in-app updater, so this is satisfied by accident. It does mean the App Store copy must
not advertise `brew upgrade` as the way to get new versions; the cask stays the
non-App-Store channel's mechanism and is invisible from inside the App Store build.

**Recurring cost of the second channel:** one extra archive and upload per release, plus
App Review latency on **every** update — including a one-line bug fix, which today ships
whenever the owner decides to tag it. That is the real price, and it is paid per release
forever, not once.

---

## 7. Recommendation

RRR §1 already reasons about this and reaches a conclusion; nothing below replaces it,
only prices it.

**The case for going.** Apple's own support documentation says where users look **[read]**
([Get extensions to customize Safari on Mac](https://support.apple.com/guide/safari/get-extensions-sfri32508/mac)):

> The Mac App Store is the safest and easiest way to discover and install extensions.

and the discovery path is a menu item — *Safari ▸ Safari Extensions* opens the store's
extensions page. PiPOSS is not in that path at all. Today it is found by people who read
GitHub, and [`metrics.md`](metrics.md) §7's dated baseline says what that is worth: **127
zip downloads across four releases since 2022, 5 Homebrew installs in 365 days, 1 in the
last 30**. That is the measured ceiling of the current channel, not a guess. Against that,
this audit found the technical cost of getting there to be approximately zero: the sandbox
was already on, the entitlements now consist of the one key the store requires, the
metadata keys are all present, and the fee is already paid.

**The case for caution, from the same measurements.** The store already lists **23 PiP
apps, 13 of them free; 11 are Safari PiP and at least 5 of those free** (`metrics.md` §5,
RRR §1) — including `PiPer`, open source, Safari, same purpose. So App Store presence is a
*distribution channel, not an advantage*: being on the store is not being found on it. And
`metrics.md` §9 is explicit that at one to five installs a month **no incremental change is
measurable** — so the submission cannot be judged by its numbers afterwards, only by
whether the channel exists.

**The recommendation, in one sentence: prepare fully and submit once, after v2 ships on
the existing channel — the technical cost is now zero, the money cost is zero, the
recurring cost is review latency on each update, and the thing being bought is presence
in the one discovery path Apple's own documentation points users down, not a measurable
lift.**

Concretely, in order: ship v2 as a notarized Developer ID release and a cask update the
way [`release.md`](release.md) describes; then do §5 items 1–3 once; then submit the *same*
2.0.0 source as a MAS build with a higher `CURRENT_PROJECT_VERSION`; keep both channels and
one bundle id; and if review asks about the all-sites permission, the answer is that a video
can be on any page.

What would change this recommendation: if App Review pushes back on the all-sites content
script in a way that requires narrowing the product, the cask channel is unaffected and
the submission should simply be abandoned rather than the product reshaped for it. That
is the owner's line to hold, and it is why nothing here submits anything.
