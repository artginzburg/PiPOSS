# Safari, code signing, and whether the extension appears at all — 2026-07-28

Captured after a **regression that reached the owner**: T12 removed the signing
settings from the Xcode project, every default build became ad-hoc-signed, and
*"the extension no longer gets added to Safari when I run the project"*. This file
exists so nobody re-derives it from memory — five stated-as-fact platform claims
have already had to be corrected in this project.

Read this before changing anything about signing in
[`project.yml`](../../project.yml).

## The claim, and how much of it is established

**Claim:** a Safari web extension is not registered by Safari when its host app is
ad-hoc-signed, and a real signature (Apple Development is enough) is required.

- **Established by measurement:** what an unsigned build actually produces (below).
- **Established by citation from Safari itself:** Safari has an explicit,
  authorization-gated *"Allow unsigned extensions"* capability (below). A platform
  does not gate a capability behind Touch ID unless the default is to refuse.
- **Observation, not measurement:** the owner's report that the extension stopped
  appearing after T12 and worked before it, on builds differing only in signing.
- **Registration, not operation — and the distinction cuts the dangerous way.** An
  extension Safari has *already* registered from a properly signed build keeps working
  when the bundle underneath it is replaced by an ad-hoc one: Safari's record lives in its
  own container, and overwriting the app on disk does not withdraw it. Measured by
  accident on 2026-07-29, when an unsigned `SIGN=no` build overwrote the owner's working
  copy and his extension went on working — and I wrongly told him it was broken.
  **This makes the failure worse for users, not milder.** A developer who has ever had a
  signed build installed cannot reproduce it, while a user installing an ad-hoc build gets
  an app whose extension never appears in Safari's list at all — no error, no entry,
  nothing to search for. That is exactly how BF09 reached the owner: *"where did you put
  the extension? it no longer gets added to Safari."*
- **NOT established:** *why* Safari refuses — whether it is the absent Team
  Identifier, the absent sealed resources, PlugInKit declining to register the
  appex, or something else. **The mechanism is unestablished.** Do not write it
  down as if it were known. An agent cannot close this: producing the signed
  build to compare against needs the login keychain, and observing Safari's
  extension list needs a GUI (RRR §10.2, CLAUDE.md).

**The release path cannot ship this.** `scripts/release.sh` reads the exported bundle's
signature *before* submitting anything to Apple and exits non-zero unless it finds
`Authority=Developer ID Application` and the hardened runtime flag. A comment would not
have been enough — T12 removed the signing settings, every gate stayed green, and the
owner found the result in Safari.

## What an unsigned build produces — measured 2026-07-28

The canonical unattended build (`CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO
CODE_SIGN_IDENTITY=""`, Release), then `codesign -dv --verbose=4` on the product.
`codesign -d` only *displays* a signature, so it needs no key and no keychain.

```
PiPOSS.app
  Identifier=PiPOSS
  CodeDirectory v=20400 size=3039 flags=0x20002(adhoc,linker-signed) hashes=92+0
  Signature=adhoc
  TeamIdentifier=not set
  Sealed Resources=none

PiPOSS Extension.appex
  Identifier=PiPOSS Extension
  CodeDirectory v=20400 size=713 flags=0x20002(adhoc,linker-signed) hashes=19+0
  Signature=adhoc
  TeamIdentifier=not set
  Sealed Resources=none
```

Neither bundle has a `_CodeSignature` directory.

**The consequence worth understanding, because it is bigger than "not signed":**
`Sealed Resources=none` means the signature covers only the Mach-O executable. A
Safari web extension is almost entirely *resources* — `manifest.json`,
`dist/content.js`, `dist/background.js`, `dist/options.js`, `_locales/`, `images/`,
`options.html`, `options.css`. In a linker-signed bundle **none of the extension's
actual code is covered by any signature at all.** Whatever Safari's specific check
is, there is nothing here for it to validate.

This is also why `docs/development.md` and the `Makefile` have always said a `SIGN=no`
product proves the code compiles and is **not** something to install.

## Safari's own strings — cited 2026-07-28

Same method as DECISIONS 219 (read Safari's shipped resources rather than
remembering its UI). `/System/Library/PrivateFrameworks/Safari.framework/Versions/A/Resources/en.lproj/Localizable.strings`
is an Apple binary property list; `plutil -p` renders 2682 entries, four of which
match `unsigned`, verbatim:

```
"Allow unsigned extensions"
"Safari is trying to allow unsigned extensions."
"%@ is trying to allow unsigned extensions."
"Touch ID to allow unsigned extensions."
```

Two things follow, and only two:

1. The capability exists and is spelled in **sentence case** — "Allow unsigned
   extensions". (An earlier Makefile comment wrote it title-cased. Harmless, but
   this is the shipped spelling.)
2. It is behind an **authorization prompt** — the `is trying to` and `Touch ID`
   forms are the macOS authorization-request wording. So enabling it is a
   deliberate, privileged act, which is only coherent if the default is refusal.

What these strings do **not** tell you: whether "unsigned" in Safari's sense
includes ad-hoc/linker-signed, or where the toggle lives in the UI. Both would be
guesses. Safari's preference domain was deliberately **not** read: its container is
TCC-protected and probing it can raise a Full Disk Access dialog (DECISIONS 216,
CLAUDE.md).

## The practical rule

| Build path | Signature | Safari registers the extension? |
|---|---|---|
| `make app-build`, `make check`, CLAUDE.md's canonical command, CI | ad-hoc, linker-signed | **no** — compile check only |
| a bare `xcodebuild`, or Build from Xcode's UI | Apple Development, from the project's own settings | yes (this is what the owner relies on) |
| `make app` (`SIGN=dev`) | Apple Development, named on the command line | yes |
| `make app-signed CONFIRM=1` (`SIGN=devid`) | Developer ID Application | yes, and this is the distributable one |

So the project **must** keep `CODE_SIGN_IDENTITY = "Apple Development"`,
`CODE_SIGN_STYLE = Automatic` and `DEVELOPMENT_TEAM` — on **both** targets, since
the appex is signed separately from the app — and unattended builds must keep
passing the unsigned overrides. Those two facts are not in tension: an override on
the `xcodebuild` command line beats the project, measured every time in this repo.

## The reasoning error this file exists to prevent

T12's first pass removed the three signing settings, arguing that a project naming
no identity cannot reach the login keychain by accident. The premise about the
keychain is true; the conclusion was wrong, because it optimised one requirement
(no dialog for agents) into a default that broke the other (a human's build must be
loadable by Safari), and nobody asked what Safari requires of an extension host.

The incident that motivated it (DECISIONS 74) was caused by an **acceptance
criterion demanding a signed build**, not by the project declaring an identity.
The project had declared `"Apple Development"` for four releases while every
agent build in this repository passed the unsigned overrides and never once
touched the keychain. The fix for a bad criterion is to fix the criterion — which
RRR §10.1.4 already did.

Worth noting for its own sake: the answer was **already written down** in this
repository before the regression. The Makefile's own `SIGN=dev` comment said
Apple Development signing "is what Safari needs before it will load the extension
at all", and `docs/development.md` said a `SIGN=no` product is "not something to
install". Both were read during T12 and neither was reconciled with the change.
The failure was not missing knowledge.
