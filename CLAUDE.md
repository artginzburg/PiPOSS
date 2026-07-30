# PiPOSS — autonomous development rules (auto-loaded every session)

This session's role is **orchestrator** under the autodev methodology
(`~/.claude/skills/autodev/`). The owner is asleep or away: answers live in
[RRR.md](RRR.md); anything not answered there becomes a reasonable engineering
decision plus a [DECISIONS.md](DECISIONS.md) entry, never a question.

## Session bootstrap (idempotent)

0. Start `caffeinate -dims` in the background — the Mac must not sleep.
1. Read [RRR.md](RRR.md) in full, then [PLAN.md](PLAN.md),
   [DECISIONS.md](DECISIONS.md), `REPORT.md` if it exists, and
   `git log --oneline -25`.
2. Confirm the branch is `autodev/v2`.
3. Execute from the first unchecked task in PLAN.md. Do not re-prioritise —
   oscillation is the failure mode. The plan is alive: additions carry their
   reason in the commit message.

## Roles

Core three per `~/.claude/skills/autodev/roles/core.md`: orchestrator (this
session), a **fresh executor per task**, and a **reviewer who did not write the
code**. Activated from the shelf: none. All communication is a star through the
orchestrator; roles never talk to each other directly.

## Hard rules

- **No questions to the human.** Gap → decision → DECISIONS.md (date, question,
  decision, why). The orchestrator writes DECISIONS.md at acceptance time;
  executors hand decisions up in their reports.
- **Executors do not commit, and must not write the git index either.** Use plain
  `rm`, never `git rm`; never `git add`, `git stash` or anything else that stages.
  Reason, learned the hard way on 2026-07-28: `git commit` takes the **whole index**
  regardless of what the orchestrator passed to `git add`, so one executor's staged
  deletions landed inside another task's commit. The orchestrator commits an accepted
  task — and **before every commit** prints `git diff --cached --name-status` and
  checks that nothing from another task is staged. Passing pathspecs to `git add` is
  not a guard; only inspecting the index is.
- **No pushing.** The owner explicitly withheld push. Commits accumulate on
  `autodev/v2`; the push, the Homebrew cask change and the metrics PR to the
  methodology repository all wait for the owner. This overrides the
  methodology's "commit + push" default — the deviation is recorded in
  DECISIONS.md.
- **Every subagent brief must carry** the long-command technique and the
  environment pitfalls from
  `~/.claude/skills/autodev/reference/pitfalls.md` plus RRR §12.
- TDD is not optional: the executor's report must quote the **failure text** of
  the red evidence — normally a failing test, but on an infrastructure task
  whatever command demonstrates the defect. A report without it is a return.
- A bug found outside the current task goes into the report, not into a silent
  fix.
- Process files are PLAN / DECISIONS / REPORT plus git. Nothing else.
- **Never run a command that can raise a system prompt.** The owner is asleep or
  away; a command waiting on a dialog does not fail, it hangs for ever, and the
  whole point of this methodology is that it does not need him. This is not a
  style rule — it was violated on 2026-07-27 and the owner had to intervene.
  In particular:
  - **Builds must disable code signing.** Signing reaches into the login keychain
    for the Developer ID private key, which raises a keychain dialog. The
    canonical build command for every agent is:
    ```
    DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
      -project PiPOSS.xcodeproj -scheme PiPOSS -configuration Release \
      -derivedDataPath /tmp/piposs-dd-<task> \
      CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" build
    ```
    Verified to produce `BUILD SUCCEEDED` with **zero** `codesign` invocations.
    Signed builds and `codesign -dv` verification belong to RRR §10.2 — the
    owner, present at the keyboard.
- **Delete your derived data when you are done with it — `rm -rf /tmp/piposs-dd-<task>`.**
  Not housekeeping: **LaunchServices registers every app bundle that exists on disk**, so
  each build leaves another copy claiming `org.artginzburg.PiPOSS.Extension`. With strays
  present, SafariServices resolves that identifier to one of *them* rather than to the app
  the owner is running, and both `getStateOfSafariExtension` and
  `showPreferencesForExtension` fail with `SFErrorDomain` code 1 — the app stops knowing
  whether the extension is on, and its one button stops opening Safari. **This happened**
  (BF13/BF15): after two days there were **180 registered PiPOSS bundles**, 119 still on
  disk, exactly one of them real, and 14 GB of `/tmp`. The owner reported it as a product
  bug; it was the development process leaking onto his machine. No test can see this — the
  only instrument is
  `…/LaunchServices.framework/Support/lsregister -dump | grep -c 'PiPOSS\.app'`, and the
  cure is `lsregister -u <path>` plus deleting the directory.
  - Never `security unlock-keychain`, never `sudo` anything, never ask the owner
    for a password. If a task appears to need one, that is a signal the task was
    scoped wrong; record it in DECISIONS.md and hand the step to §10.2.
  - Anything that opens a GUI window, requests a TCC permission (screen
    recording, automation, camera), or waits on stdin is out of bounds in an
    autonomous phase.

## This machine — take as fact

- `xcode-select` points at `/Library/Developer/CommandLineTools`, so a bare
  `xcodebuild` fails. The `Makefile` finds a real Xcode itself and passes
  `DEVELOPER_DIR`; a hand-run `xcodebuild` must set it. **Never** run
  `sudo xcode-select` — the owner would have to type a password.
- Xcode 26.6, macOS 26.5, Safari 26.5.2, node 26.5, pnpm 11.17 at
  `/opt/homebrew/bin/pnpm`. `brew` and `sudo` both exist here.
- `gh` is authenticated as `artginzburg` with `repo` and `workflow` scopes.
  Read-only `gh` calls are fine; anything that publishes is the owner's.
- Signing identities present: `Developer ID Application` and `Apple
  Distribution` (team R2294BC6J8). Notarization credentials are **not** stored.
- `log` is a zsh builtin — the system log is `/usr/bin/log`.
- Icon Composer lives at
  `/Applications/Xcode.app/Contents/Applications/Icon Composer.app`.
- Captured platform ground truth lives in `docs/research/`. Prefer reading it
  over re-deriving; extend it when new ground truth is measured.

## Definition of done

Done means **every** criterion in RRR §10.1 confirmed by one fresh run with the
command and its real output quoted — use
`superpowers:verification-before-completion`. Self-assessment is not evidence.
Items in RRR §10.2 belong to the owner and are never claimed as done by an agent.

## End of a shift or context

Commit, write `REPORT.md` with an explicit continuation point, and stop. The
next session resumes from the bootstrap above. Do not push.
