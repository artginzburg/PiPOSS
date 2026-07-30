# REPORT.md — handover

**Branch:** `main`, one squashed commit, **nothing pushed**. The 46-commit history is on
`autodev/v2`; read that if you want a decision at a time.

**Automatic gates:** `make check` → exit 0. Formatting, lint, 472 tests, the 12 KB content
bundle, the signed product's entitlement set against an allow-list, and an unsigned Release
build with 0 Swift warnings.

## What only a human can confirm, and its status

Everything on this list has been run by the owner and works: the toolbar button, the
hotkey and `⌘⇧P`, the YouTube button, the options page, auto-PiP on tab switch, the access
guide, and restoring the site's own fullscreen on leaving PiP.

Two things remain unverifiable rather than unverified, and are recorded as such:

- **Whether Safari coalesces `webkitpresentationmodechanged`** when two transitions land in
  one turn. If it does, the intermediate mode is lost and the restore target is the earlier
  one. Degrades to inline, never to a wedge.
- **Which version string Safari's Extensions pane displays.** Marked `[not established]` in
  `docs/app-store.md`; all four version strings now agree, so it does not matter today.

## What is left to ship

1. **Push** — held for the owner's word.
2. **Release:** Developer ID build, notarize, staple. Notarization credentials are not
   stored on this machine; this is the only hard blocker. Steps in
   [docs/release.md](docs/release.md).
3. **Homebrew cask** in `artginzburg/homebrew-tap` — version, `sha256`, and
   `--no-quarantine` gone. Part of the release, not a separate step.
4. Optional, not for shipping: the Mac App Store. Technically ready, fee already sunk, and
   at one to five installs a month the effect will not be measurable —
   [docs/app-store.md](docs/app-store.md) says so at length rather than selling it.

Three known defects remain, none of them shipping-critical and none currently reachable by
a user: [PLAN.md](PLAN.md) has each with its cost.

## Two things this project learned that outlive it

- **An unestablished claim inherits the validity of the environment it was tested in.**
  "Could not establish whether the app can open its extension's settings page" was recorded
  as a finding while *every* SafariServices call on that machine was failing for an
  unrelated reason. It took four tasks to notice. Record what would have invalidated the
  attempt, not only the attempt.
- **A test whose setup skips the branch it names is indistinguishable from one that passes.**
  Mutation testing caught what a green suite hid six times. The two failure shapes and their
  remedies are in [ARCHITECTURE.md](ARCHITECTURE.md)'s closing section, where the next
  contributor will meet them.

Full reasoning for every call made without the owner: [DECISIONS.md](DECISIONS.md).
